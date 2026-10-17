import {test} from 'node:test';import assert from 'node:assert/strict';import {createHmac} from 'node:crypto';
import {CONTEXT,DEFAULT_PROFILE,type SourceInput} from '../packages/contracts/index.js';import {MODEL} from '../packages/contracts/model.js';
import {BoxAdapter} from '../services/providers/box.js';
import {MemoryStore} from '../services/storage/store.js';import {fixtureSource} from '../fixtures/sources.js';
import {createProductionRuntime} from '../services/runtime/production.js';import {createApiLambda} from '../services/api/handler.js';import {createWorkerLambda} from '../services/worker/handler.js';
import type {LiveWorkerEnvelope} from '../services/worker/live-worker.js';
import {DomainError} from '../services/worker/core.js';
const env={LIVE_PROVIDERS_ENABLED:'true',TALLY_APPROVED_LIVE_FLOW:'true',TALLY_EXECUTION_MODE:'aws',TALLY_TABLE_NAME:'tally-test-state',TALLY_QUEUE_URL:'https://sqs.us-east-1.amazonaws.com/123456789012/tally-test',BOX_INPUT_FOLDER_ID:'12',BOX_WEBHOOK_ID:'34',TALLY_DEMO_TENANT_ID:CONTEXT.business_id,TALLY_TAX_YEAR:'2025',TALLY_RULE_SET_ID:CONTEXT.rule_set_id,AWS_REGION:MODEL.region,BEDROCK_MODEL_ID:MODEL.model_id,TALLY_EXPLANATION_ADAPTER:'strands'};
const source=(id:string):SourceInput=>{const s=fixtureSource(id==='100'?'fixture-A':'fixture-B');return {...s,file_id:id,folder_id:'12',source_url:`https://app.box.com/file/${id}`,facts:s.facts.map(f=>({...f,fact_id:`box-${id}:${f.fact_id}`,source:{...f.source,kind:'box_document',file_id:id}}))};};
function setup(){const store=new MemoryStore(),messages:LiveWorkerEnvelope[]=[];let keyReads=0,boxReads=0,extracts=0,explanations=0;let failSend=false;
 const sources={prepare:async(id:string)=>({...source(id),business_name:null,facts:[]}),extract:async(observation:SourceInput)=>{extracts++;return source(observation.file_id);}};
 const runtime=createProductionRuntime(env,{store,send:async m=>{if(failSend)throw new Error('private queue diagnostics');messages.push(m);},secrets:{getWebhookKeys:async()=>{keyReads++;return {primaryKey:'test-signing-key'};},getBoxCredentials:async()=>{throw new Error('Unexpected credential read');}},box:async()=>{boxReads++;return {listInbox:async()=>['100','200'],metadata:async id=>({id,type:'file',name:'fixture.pdf',size:1,sha1:'test',file_version:{id:'1'},parent:{id:id==='999'?'other':'12'}})};},sourceProvider:sources,explain:async opportunity=>{explanations++;return {mode:'deterministic_fallback',explanation:{summary:opportunity.summary,what_changed:'',fact_ids:opportunity.fact_ids.slice(0,16),rule_ids:['annual_fte']},usage:{inputTokens:null,outputTokens:null,totalTokens:null}};}});
 return {store,runtime,messages,counts:()=>({keyReads,boxReads,extracts}),explanationCount:()=>explanations,setFail:(value:boolean)=>{failSend=value;}};
}
test('production construction and state reads touch no secrets, tokens, Box, queue, or model',async()=>{
 const s=setup();assert.deepEqual(s.counts(),{keyReads:0,boxReads:0,extracts:0});
 const state=await s.runtime.api({method:'GET',path:'/api/state'});assert.equal(state.status,200);assert.equal((state.body as any).upload_url,'https://app.box.com/folder/12');assert.equal((state.body as any).execution.intake_mode,'manual');assert.deepEqual(s.counts(),{keyReads:0,boxReads:0,extracts:0});assert.equal(s.messages.length,0);
 assert.throws(()=>createProductionRuntime({...env,TALLY_APPROVED_LIVE_FLOW:'false'}),/requires explicit approval/);
 assert.throws(()=>createProductionRuntime({...env,TALLY_QUEUE_URL:'https://evil.example/queue'}),/persistence targets/);
});
test('valid webhook loads only signing keys, persists queued intake, awaits SQS, and worker alone extracts',async()=>{
 const s=setup();await s.runtime.api({method:'PUT',path:'/api/profile',rawBody:JSON.stringify({expected_profile_rev:0,profile:DEFAULT_PROFILE})});
 const raw=JSON.stringify({type:'webhook_event',id:'event-1',trigger:'FILE.UPLOADED',webhook:{id:'34'},source:{id:'100',type:'file',parent:{id:'12'}}}),timestamp=new Date().toISOString();
 const headers={'box-signature-version':'1','box-signature-algorithm':'HmacSHA256','box-delivery-timestamp':timestamp,'box-signature-primary':createHmac('sha256','test-signing-key').update(raw).update(timestamp).digest('base64')};
 s.setFail(true);assert.equal((await s.runtime.api({method:'POST',path:'/webhooks/box',rawBody:raw,headers})).status,503);assert.equal(s.counts().extracts,0);assert.equal(s.counts().boxReads,0);assert.equal((await s.store.read()).jobs[0].committed,false);
 s.setFail(false);assert.equal((await s.runtime.api({method:'POST',path:'/webhooks/box',rawBody:raw,headers})).status,202);assert.equal(s.counts().extracts,0);
 await s.runtime.worker.handle(s.messages.shift()!);assert.equal(s.counts().extracts,1);assert.equal(s.messages[0].kind,'EVALUATE');
 // Leave EVALUATE queued here to isolate the ledger handoff; the end-to-end tests drain it through the injected synthetic fallback.
 const state=await s.store.read();assert.ok(state.facts.length>0);assert.equal(state.execution.extraction_mode,'live_box_ai');assert.equal(state.opportunity,null);
});
test('invalid signature or unavailable keys cannot queue or write ingestion state',async()=>{
 const s=setup();const bad=await s.runtime.api({method:'POST',path:'/webhooks/box',rawBody:'{}',headers:{}});assert.equal(bad.status,403);assert.equal((await s.store.read()).jobs.length,0);assert.equal(s.messages.length,0);assert.equal(s.counts().boxReads,0);
 const broken=createProductionRuntime(env,{store:s.store,send:async()=>{throw new Error('must not send');},secrets:{getWebhookKeys:async()=>{throw new Error('secret value must never leak');},getBoxCredentials:async()=>{throw new Error('unused');}}});const result=await broken.api({method:'POST',path:'/webhooks/box',rawBody:'{}'});assert.equal(result.status,503);assert.doesNotMatch(JSON.stringify(result),/secret value/);
});
test('manual analysis preflights all direct folder members and reconcile repairs a failed queue handoff',async()=>{
 const s=setup();await s.runtime.api({method:'PUT',path:'/api/profile',rawBody:JSON.stringify({expected_profile_rev:0,profile:DEFAULT_PROFILE})});
 assert.equal((await s.runtime.api({method:'POST',path:'/api/demo/analyze',rawBody:JSON.stringify({file_ids:['100','999']})})).status,403);assert.equal(s.messages.length,0);
 s.setFail(true);assert.equal((await s.runtime.api({method:'POST',path:'/api/demo/analyze',rawBody:JSON.stringify({file_ids:['100','200']})})).status,503);assert.equal(s.counts().extracts,0);assert.equal((await s.store.read()).jobs.filter(j=>j.job_id.startsWith('INTAKE:')).length,2,'Both batch intentions survive an initial queue failure');s.setFail(false);
 assert.equal((await s.runtime.api({method:'POST',path:'/api/demo/reconcile',rawBody:'{}'})).status,200);assert.equal(s.messages[0].kind,'INGEST');assert.equal(s.messages.length,2);
 await s.store.transact(state=>{for(const job of state.jobs)job.status='needs_review';});s.messages.length=0;await s.runtime.api({method:'POST',path:'/api/demo/reconcile',rawBody:'{}'});assert.equal(s.messages.length,0,'Reconcile does not automatically repeat permanent preflight failures');
});
test('Lambda factories remain gated before runtime construction and report per-message failures',async()=>{
 let constructed=0;const blocked=createApiLambda({env:{},runtimeFactory:()=>{constructed++;throw new Error('unused');}});assert.equal((await blocked({rawPath:'/api/state'})).statusCode,503);assert.equal(constructed,0);
 const worker=createWorkerLambda({env,runtimeFactory:()=>({worker:{handle:async envelope=>{if(envelope.kind==='INGEST')throw new Error('retry');return {status:'completed'};}}})});
 const result=await worker({Records:[{messageId:'ok',body:JSON.stringify({kind:'EVALUATE',business_id:CONTEXT.business_id})},{messageId:'retry',body:JSON.stringify({kind:'INGEST',business_id:CONTEXT.business_id,file_id:'100',intake_mode:'manual'})},{messageId:'foreign',body:JSON.stringify({kind:'EVALUATE',business_id:'other'})}]});assert.deepEqual(result.batchItemFailures,[{itemIdentifier:'retry'},{itemIdentifier:'foreign'}]);
});


test('mocked live manual A then B reaches the same guarded card through separate INGEST/EVALUATE queue deliveries',async()=>{
 const s=setup();await s.runtime.api({method:'PUT',path:'/api/profile',rawBody:JSON.stringify({expected_profile_rev:0,profile:DEFAULT_PROFILE})});
 const run=async(id:string)=>{assert.equal((await s.runtime.api({method:'POST',path:'/api/demo/analyze',rawBody:JSON.stringify({file_ids:[id]})})).status,202);while(s.messages.length)await s.runtime.worker.handle(s.messages.shift()!);return s.store.read();};
 const a=await run('100'),b=await run('200');assert.equal(a.opportunity?.stage,'needs_coverage_statement');assert.equal(b.opportunity?.stage,'evidence_updated');assert.equal(b.opportunity?.opportunity_id,a.opportunity?.opportunity_id);assert.ok(b.opportunity!.revision>a.opportunity!.revision);assert.equal(b.opportunity?.reported_employer_share_basis_points,8000);assert.ok(b.opportunity?.annual_requirements.every(check=>check.result==='unknown'));assert.equal(b.opportunity?.estimate.amount_cents,null);assert.equal(s.counts().extracts,2);assert.equal(b.execution.explanation_mode,'deterministic_fallback');assert.ok(b.jobs.every(job=>!['queued','extracting','evaluating','ledger_committed'].includes(job.status)));
});

test('a changed expected service-account identity cannot reuse a previously accepted token cache',async()=>{
 let expected='10',identityReads=0,metadataReads=0;const store=new MemoryStore();
 const fetcher=(async(input:unknown)=>{const url=String(input);if(url.includes('/users/me')){identityReads++;return new Response(JSON.stringify({id:'10'}));}metadataReads++;return new Response(JSON.stringify({id:'100',type:'file',name:'test.pdf',size:1,sha1:'test',file_version:{id:'1'},parent:{id:'12'}}));}) as typeof fetch;
 const runtime=createProductionRuntime(env,{store,send:async()=>{},secrets:{getWebhookKeys:async()=>({primaryKey:'unused'}),getBoxCredentials:async()=>({kind:'access_token',access_token:'same-synthetic-token',expected_user_id:expected})},boxAdapterFactory:(token,folder)=>new BoxAdapter(token,folder,fetcher)});
 await runtime.api({method:'PUT',path:'/api/profile',rawBody:JSON.stringify({expected_profile_rev:0,profile:DEFAULT_PROFILE})});const analyze=()=>runtime.api({method:'POST',path:'/api/demo/analyze',rawBody:JSON.stringify({file_ids:['100']})});assert.equal((await analyze()).status,202);expected='20';const denied=await analyze();assert.equal(denied.status,503);assert.equal(identityReads,2);assert.equal(metadataReads,1,'Updated identity must pass before any file access');assert.doesNotMatch(JSON.stringify(denied),/same-synthetic-token/);
});


// Synthetic signing input and injected providers only; no Box/AWS client or credential lookup is used.
function signedNotification(fileId:string,eventId:string){
 const raw=JSON.stringify({type:'webhook_event',id:eventId,trigger:'FILE.UPLOADED',webhook:{id:'34'},source:{id:fileId,type:'file',parent:{id:'12'}}});
 const timestamp=new Date().toISOString();
 return {method:'POST',path:'/webhooks/box',rawBody:raw,headers:{'box-signature-version':'1','box-signature-algorithm':'HmacSHA256','box-delivery-timestamp':timestamp,'box-signature-primary':createHmac('sha256','test-signing-key').update(raw).update(timestamp).digest('base64')}};
}
async function drainLocalQueue(s:ReturnType<typeof setup>){
 let deliveries=0;
 while(s.messages.length){assert.ok(++deliveries<=24,'The local queue must terminate instead of repeatedly rescheduling work');await s.runtime.worker.handle(s.messages.shift()!);}
}

test('manual A and notified B converge; duplicate notifications and manual retries add no extraction, explanation, facts or card effects',async()=>{
 const s=setup();await s.runtime.api({method:'PUT',path:'/api/profile',rawBody:JSON.stringify({expected_profile_rev:0,profile:DEFAULT_PROFILE})});
 assert.equal((await s.runtime.api({method:'POST',path:'/api/demo/analyze',rawBody:JSON.stringify({file_ids:['100']})})).status,202);
 assert.equal(s.counts().extracts,0,'Manual acknowledgment performs no extraction');await drainLocalQueue(s);const a=await s.store.read();assert.equal(a.opportunity?.stage,'needs_coverage_statement');
 assert.equal((await s.runtime.api(signedNotification('200','coverage-upload'))).status,202);
 assert.equal(s.counts().extracts,1,'Notification acknowledgment performs no extraction');await drainLocalQueue(s);const b=await s.store.read();
 assert.equal(b.opportunity?.opportunity_id,a.opportunity?.opportunity_id);assert.equal(b.opportunity?.stage,'evidence_updated');assert.equal(b.opportunity?.reported_employer_share_basis_points,8000);assert.equal(s.counts().extracts,2);assert.equal(s.explanationCount(),2);
 for(const [fileId,eventId]of [['200','coverage-upload'],['200','coverage-upload-repeated'],['100','initial-upload-repeated']])assert.equal((await s.runtime.api(signedNotification(fileId,eventId))).status,202);
 assert.equal((await s.runtime.api({method:'POST',path:'/api/demo/analyze',rawBody:JSON.stringify({file_ids:['100','200']})})).status,202);
 assert.equal(s.counts().extracts,2);await drainLocalQueue(s);const duplicate=await s.store.read();
 assert.equal(s.counts().extracts,2);assert.equal(s.explanationCount(),2);assert.equal(duplicate.ledger_rev,b.ledger_rev);assert.equal(duplicate.profile_rev,b.profile_rev);
 assert.deepEqual(duplicate.facts,b.facts);assert.deepEqual(duplicate.opportunity,b.opportunity);assert.deepEqual(duplicate.history,b.history);assert.deepEqual(duplicate.documents,b.documents);
 assert.equal(duplicate.facts.find(fact=>fact.fact_type==='recorded_payment_amount')?.value,120000);assert.equal(duplicate.facts.find(fact=>fact.fact_type==='stated_employer_contribution')?.value,120000);assert.ok(!duplicate.facts.some(fact=>fact.unit==='USD_cents'&&fact.value===240000));
 assert.equal(duplicate.opportunity?.evidence_checks.find(check=>check.requirement_id==='payment_to_coverage_match')?.result,'unknown');assert.ok(duplicate.opportunity?.annual_requirements.every(check=>check.result==='unknown'));assert.equal(duplicate.opportunity?.estimate.amount_cents,null);
 assert.ok(duplicate.jobs.every(job=>job.committed&&job.status==='completed'),'Current and duplicate intake jobs all terminate');assert.equal(duplicate.pending_evaluation,null);
});

test('manual inbox discovery is profile-gated and invalid selections cannot leave partial work before a valid two-file batch',async()=>{
 const s=setup();const analyze=(body:unknown)=>s.runtime.api({method:'POST',path:'/api/demo/analyze',rawBody:JSON.stringify(body)});
 const missing=await analyze({});assert.equal(missing.status,409);assert.equal((missing.body as {code:string}).code,'PROFILE_REQUIRED');assert.equal(s.counts().boxReads,0);assert.equal(s.messages.length,0);
 await s.runtime.api({method:'PUT',path:'/api/profile',rawBody:JSON.stringify({expected_profile_rev:0,profile:DEFAULT_PROFILE})});const before=await s.store.read();
 assert.equal((await analyze({file_ids:['100','100']})).status,422);assert.equal((await analyze({file_ids:['100','999']})).status,403);assert.equal((await analyze({file_ids:['100'],tax_year:2026})).status,422);
 assert.deepEqual(await s.store.read(),before,'Invalid batches must not queue or write a partially accepted first file');assert.equal(s.messages.length,0);assert.equal(s.counts().extracts,0);assert.equal(s.explanationCount(),0);
 assert.equal((await analyze({})).status,202);assert.equal(s.messages.length,2);assert.ok(s.messages.every(message=>message.kind==='INGEST'&&message.intake_mode==='manual'));assert.equal((await s.store.read()).facts.length,0);assert.equal(s.counts().extracts,0);
 await drainLocalQueue(s);const state=await s.store.read();assert.equal(s.counts().extracts,2);assert.equal(state.documents.length,2);assert.equal(state.opportunity?.stage,'evidence_updated');assert.equal(state.opportunity?.reported_employer_share_basis_points,8000);assert.ok(state.opportunity?.annual_requirements.every(check=>check.result==='unknown'));assert.ok(state.jobs.every(job=>job.committed&&job.status==='completed'));
});

test('a notification before profile setup remains retryable and recovers after profile save without premature or repeated extraction',async()=>{
 const s=setup();assert.equal((await s.runtime.api(signedNotification('100','before-profile'))).status,202);assert.equal(s.counts().extracts,0);const delivery=s.messages.shift()!;
 await assert.rejects(s.runtime.worker.handle(delivery),error=>error instanceof DomainError&&error.code==='PROFILE_REQUIRED'&&error.retryable);
 const pending=await s.store.read();assert.equal(pending.profile,null);assert.equal(pending.facts.length,0);assert.equal(pending.opportunity,null);assert.equal(s.counts().extracts,0);assert.equal(s.explanationCount(),0);assert.ok(pending.jobs.some(job=>job.status==='queued'&&!job.committed));
 assert.equal((await s.runtime.api({method:'PUT',path:'/api/profile',rawBody:JSON.stringify({expected_profile_rev:0,profile:DEFAULT_PROFILE})})).status,201);await drainLocalQueue(s);const settled=await s.store.read();
 assert.equal(settled.opportunity?.stage,'needs_coverage_statement');assert.equal(s.counts().extracts,1);assert.equal(s.explanationCount(),1);assert.ok(settled.jobs.every(job=>job.committed&&job.status==='completed'));assert.equal(settled.pending_evaluation,null);
 assert.equal((await s.runtime.worker.handle(delivery)).status,'duplicate');await drainLocalQueue(s);const retried=await s.store.read();assert.deepEqual(retried.facts,settled.facts);assert.deepEqual(retried.opportunity,settled.opportunity);assert.deepEqual(retried.history,settled.history);assert.equal(s.counts().extracts,1);assert.equal(s.explanationCount(),1);
});
