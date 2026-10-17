import test from 'node:test';
import assert from 'node:assert/strict';
import {CONTEXT,DEFAULT_PROFILE,type SourceInput} from '../packages/contracts/index.js';
import {BoxAdapter,type BoxMetadata} from '../services/providers/box.js';
import {createBoxSourceProvider,BoxSourceChangedError} from '../services/providers/normalize-box.js';
import type {PdfSnapshot} from '../services/providers/pdf.js';
import {createProductionRuntime} from '../services/runtime/production.js';
import {MemoryStore} from '../services/storage/store.js';
import type {LiveWorkerEnvelope} from '../services/worker/live-worker.js';
import {DomainError} from '../services/worker/core.js';

// Synthetic snapshots and in-memory adapters only. No credential lookup or transport is used.
const env={LIVE_PROVIDERS_ENABLED:'true',TALLY_APPROVED_LIVE_FLOW:'true',TALLY_EXECUTION_MODE:'aws',TALLY_TABLE_NAME:'tally-offline-state',TALLY_QUEUE_URL:'https://sqs.us-east-1.amazonaws.com/123456789012/tally-offline',BOX_INPUT_FOLDER_ID:'12',BOX_WEBHOOK_ID:'34',TALLY_DEMO_TENANT_ID:CONTEXT.business_id,TALLY_TAX_YEAR:'2025',TALLY_RULE_SET_ID:CONTEXT.rule_set_id,AWS_REGION:'us-east-1',TALLY_EXPLANATION_ADAPTER:'openrouter',OPENROUTER_MODEL_ID:'openai/gpt-6-luna'};
const pdf:PdfSnapshot={sha256:'a'.repeat(64),sha1:'b'.repeat(40),pageCount:2,pages:[
 'Initial business records\nPayment ledger excerpt\nJuniper Lane Bakery LLC | Historical demonstration: June 2025\nCurrency: USD. Amounts are recorded in US dollars.\nDate Description Category Amount (USD)\n2025-06-05 Health insurance payment Insurance $1,200.00 USD',
 'Partial payroll register\nPayroll detail\nJuniper Lane Bakery LLC | Pay period: June 1–15, 2025\nCurrency: USD. Amounts are recorded in US dollars.\nPayroll period start: 2025-06-01. Payroll period end: 2025-06-15.\nWorker Hours Wages (USD)\nWorker 01 60 $1,200.00 USD\nWorker 02 55 $1,100.00 USD\nWorker 03 45 $900.00 USD\nWorker 04 40 $800.00 USD\nTotal 200 $4,000.00 USD'
]};
const metadata:BoxMetadata={id:'100',type:'file',name:'synthetic-local-text.pdf',size:100,sha1:pdf.sha1,file_version:{id:'7'},parent:{id:'12'}};
const raw={answer:{business_name:'Juniper Lane Bakery LLC',currency:'USD',payment_date:'2025-06-05',recorded_payment_amount:1200,payroll_period_start:'2025-06-01',payroll_period_end:'2025-06-15',reported_gross_wages:4000,reported_hours:200},reference:{},confidence_score:{},completion_reason:'done'};
class OfflineBox extends BoxAdapter{
 extracts=0;metadataReads=0;changeAt=Infinity;
 constructor(){super('synthetic-unused-token','12',(async()=>{throw new Error('NETWORK_MUST_NOT_RUN');}) as typeof fetch);}
 async identity(){return '10';}
 async metadata(){this.metadataReads++;return {...structuredClone(metadata),file_version:{id:this.metadataReads>=this.changeAt?'8':'7'}};}
 async downloadVersion(){return structuredClone(pdf);}
 async extractFields(){this.extracts++;return structuredClone(raw);}
 async listInbox(){return ['100'];}
}

test('unknown source-verification selectors fail before any secret, source, queue or model access',()=>{
 for(const selector of ['', 'local_pdf_text', 'LOCAL_PDF_TEXT_MATCH', 'https://example.invalid']){
  let accesses=0;
  assert.throws(()=>createProductionRuntime({...env,BOX_SOURCE_VERIFICATION:selector},{store:new MemoryStore(),secrets:{getWebhookKeys:async()=>{accesses++;throw new Error('unused');},getBoxCredentials:async()=>{accesses++;throw new Error('unused');}},send:async()=>{accesses++;},explain:async()=>{accesses++;throw new Error('unused');}}),error=>error instanceof DomainError&&error.code==='SOURCE_VERIFICATION_CONFIGURATION_INVALID');
  assert.equal(accesses,0);
 }
});

test('normalizer injection runs only after extraction and unchanged-version checks; default keeps native proof policy',async()=>{
 const adapter=new OfflineBox();let normalized=0;
 const result:SourceInput={business_name:null,file_id:'100',file_version_id:'7',name:metadata.name,sha256:pdf.sha256,folder_id:'12',source_url:'https://app.box.com/file/100',facts:[]};
 const provider=createBoxSourceProvider(adapter,{normalize:(input,m,p)=>{normalized++;assert.deepEqual(input,raw);assert.deepEqual(m,metadata);assert.deepEqual(p,pdf);return result;}});
 const observed=await provider.prepare('100');assert.equal(normalized,0);assert.equal(adapter.extracts,0);assert.deepEqual(await provider.extract(observed),result);assert.equal(normalized,1);assert.equal(adapter.extracts,1);
 const changed=new OfflineBox();changed.changeAt=4;let changedNormalizations=0;
 const changedProvider=createBoxSourceProvider(changed,{normalize:()=>{changedNormalizations++;return result;}}),before=await changedProvider.prepare('100');
 await assert.rejects(changedProvider.extract(before),error=>error instanceof BoxSourceChangedError);assert.equal(changedNormalizations,0);assert.equal(changed.extracts,1);
 const native=createBoxSourceProvider(new OfflineBox()),nativeObservation=await native.prepare('100'),nativeSource=await native.extract(nativeObservation);
 assert.equal(nativeSource.business_name,null);assert.equal(nativeSource.facts.filter(f=>f.verification_state==='source_supported').length,0);assert.ok(nativeSource.facts.every(f=>f.source.verification_method!=='local_pdf_text_match'));
});

test('explicit local PDF verification settles API/INGEST/EVALUATE while preserving provenance and unknown annual checks',async()=>{
 const store=new MemoryStore(),queue:LiveWorkerEnvelope[]=[],adapter=new OfflineBox();let explanations=0;
 const runtime=createProductionRuntime({...env,BOX_SOURCE_VERIFICATION:'local_pdf_text_match'},{store,send:async message=>{queue.push(message);},secrets:{getWebhookKeys:async()=>{throw new Error('NO_SIGNING_KEY_READ');},getBoxCredentials:async()=>({kind:'access_token',access_token:'synthetic-unused-token',expected_user_id:'10'})},boxAdapterFactory:()=>adapter,explain:async opportunity=>{explanations++;return {mode:'deterministic_fallback',explanation:{summary:opportunity.summary,what_changed:'',fact_ids:opportunity.fact_ids.slice(0,16),rule_ids:['annual_fte']},usage:{inputTokens:null,outputTokens:null,totalTokens:null}};}});
 assert.equal((await runtime.api({method:'PUT',path:'/api/profile',rawBody:JSON.stringify({expected_profile_rev:0,profile:DEFAULT_PROFILE})})).status,201);
 assert.equal((await runtime.api({method:'POST',path:'/api/demo/analyze',rawBody:JSON.stringify({file_ids:['100']})})).status,202);assert.equal(adapter.extracts,0,'API acknowledgment never extracts');
 let deliveries=0;while(queue.length){assert.ok(++deliveries<=8);await runtime.worker.handle(queue.shift()!);}
 const state=await store.read(),supported=state.facts.filter(f=>f.verification_state==='source_supported');
 assert.equal(adapter.extracts,1);assert.equal(explanations,1);assert.equal(supported.length,8);assert.ok(supported.every(f=>f.source.verification_method==='local_pdf_text_match'&&f.source.file_id==='100'&&f.source.file_version_id==='7'&&f.source.sha256===pdf.sha256&&f.source.locator.kind==='verified_page'&&f.source.excerpt_validation==='matched'));
 assert.equal(state.opportunity?.stage,'needs_coverage_statement');assert.equal(state.opportunity?.annual_requirements.length,8);assert.ok(state.opportunity?.annual_requirements.every(check=>check.result==='unknown'));assert.equal(state.opportunity?.evidence_checks.find(check=>check.requirement_id==='payment_to_coverage_match')?.result,'unknown');assert.equal(state.opportunity?.estimate.amount_cents,null);assert.equal(state.opportunity?.reported_employer_share_basis_points,null);assert.equal(state.execution.explanation_mode,'deterministic_fallback');assert.equal(state.pending_evaluation,null);assert.ok(state.jobs.every(job=>job.status==='completed'));
});
