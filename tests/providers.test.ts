import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { MODEL } from '../packages/contracts/model.js';
import { ANNUAL_IDS, CONTEXT, DEFAULT_PROFILE, type Fact, type Opportunity } from '../packages/contracts/index.js';
import { parseBoxUploadEvent, verifyBoxSignature } from '../services/api/box-signature.js';
import { assertLiveGate } from '../services/providers/gates.js';
import { BOX_SMOKE_FIELDS, BoxAdapter, buildBoxExtractRequest } from '../services/providers/box.js';
import { deterministicExplanation, parseCompleteExplanation, validateExplanation, type ExplanationContext } from '../services/providers/explanation.js';
import { explainWithStrands, BEDROCK_CONFIG, type StrandsResult } from '../services/providers/strands.js';
import { DynamoStore, type DynamoTransport } from '../services/storage/dynamo-store.js';

const env={TALLY_DEMO_TENANT_ID:CONTEXT.business_id,TALLY_TAX_YEAR:'2025',TALLY_RULE_SET_ID:CONTEXT.rule_set_id,AWS_REGION:MODEL.region,BEDROCK_MODEL_ID:MODEL.model_id,TALLY_EXPLANATION_ADAPTER:'strands'};
const now=Date.parse('2026-10-17T06:30:00Z');
const event=JSON.stringify({id:'event-1',type:'webhook_event',trigger:'FILE.UPLOADED',webhook:{id:'42'},source:{id:'100',type:'file',parent:{id:'12'},file_version:{id:'1'}}});
function signed(body=event,timestamp=new Date(now).toISOString(),key='primary',header='box-signature-primary'){
  return {'box-delivery-timestamp':timestamp,'box-signature-version':'1','box-signature-algorithm':'HmacSHA256',[header]:createHmac('sha256',key).update(body).update(timestamp).digest('base64')};
}
const signatureConfig={primaryKey:'primary',secondaryKey:'secondary',now};

test('webhook verifies original bytes and correctly pairs each key with its header',()=>{
  assert(verifyBoxSignature(event,signed(),signatureConfig));
  assert(verifyBoxSignature(Buffer.from(event),signed(event,undefined,'secondary','box-signature-secondary'),signatureConfig));
  assert(!verifyBoxSignature(event,signed(event,undefined,'secondary','box-signature-primary'),signatureConfig));
  assert(!verifyBoxSignature(event,signed(event,undefined,'primary','box-signature-secondary'),signatureConfig));
  assert(!verifyBoxSignature(event+' ',signed(),signatureConfig));
  assert(verifyBoxSignature(event,Object.fromEntries(Object.entries(signed()).map(([k,v])=>[k.toUpperCase(),v])),signatureConfig));
});
test('webhook rejects expired, future, malformed, unsupported signatures without dispatch',()=>{
  for(const offset of [-600_000,-900_000,60_001])assert(!verifyBoxSignature(event,signed(event,new Date(now+offset).toISOString()),signatureConfig));
  assert(!verifyBoxSignature(event,{...signed(),'box-delivery-timestamp':'garbage'},signatureConfig));
  assert(!verifyBoxSignature(event,{...signed(),'box-signature-algorithm':'sha256'},signatureConfig));
  assert(!verifyBoxSignature(event,{...signed(),'box-signature-version':'2'},signatureConfig));
  assert(!verifyBoxSignature(event,{...signed(),'box-signature-primary':'AAAA'},signatureConfig));
  assert.equal(parseBoxUploadEvent(event,{webhookId:'wrong',folderId:'12'}),null);
  assert.equal(parseBoxUploadEvent(event.replace('FILE.UPLOADED','FILE.DELETED'),{webhookId:'42',folderId:'12'}),null);
  assert.equal(parseBoxUploadEvent(event,{webhookId:'42',folderId:'wrong'}),null);
  assert.deepEqual(parseBoxUploadEvent(event,{webhookId:'42',folderId:'12'}),{eventId:'event-1',fileId:'100',fileVersionId:'1'});
});
test('live smoke gate requires flag and fixed demo/model targets before a call',()=>{
  assert.throws(()=>assertLiveGate('strands',[],env),/EXPLICIT_APPROVAL/);
  assert.throws(()=>assertLiveGate('strands',['--approved-live-call'],{...env,AWS_REGION:'us-west-2'}),/MODEL_TARGET/);
  assert.throws(()=>assertLiveGate('strands',['--approved-live-call'],{...env,TALLY_DEMO_TENANT_ID:'other'}),/DEMO_TARGET/);
  assert.doesNotThrow(()=>assertLiveGate('strands',['--approved-live-call'],env));
  assert.equal(BEDROCK_CONFIG.stream,false);assert.equal(BEDROCK_CONFIG.clientConfig.maxAttempts,1);assert.equal(BEDROCK_CONFIG.requestTimeout,20_000);
});
const metadata={id:'100',type:'file',name:'fixture-a.pdf',size:1000,sha1:'sha1-a',file_version:{id:'1'},parent:{id:'12'}};
function mockBox(sequence:unknown[]){const requests:{url:string;body:unknown}[]=[];const fetcher=(async(url:unknown,init:RequestInit)=>{requests.push({url:String(url),body:init.body?JSON.parse(String(init.body)):null});if(!sequence.length)throw new Error('UNEXPECTED_EXTRA_REQUEST');return new Response(JSON.stringify(sequence.shift()),{status:200,headers:{'content-type':'application/json'}});}) as typeof fetch;return {adapter:new BoxAdapter('never-logged-token','12',fetcher),requests};}
test('Box issues one three-field extraction without items.content between stable metadata checks',async()=>{
  const mock=mockBox([metadata,{answer:{business_name:'Bakery'},reference:{business_name:{}},confidence_score:{business_name:0.9}},metadata]);
  const result=await mock.adapter.extractChecked('100',BOX_SMOKE_FIELDS);
  assert.equal(mock.requests.length,3);
  const request=mock.requests[1]!.body as ReturnType<typeof buildBoxExtractRequest>;
  assert.equal(request.fields.length,3);assert.deepEqual(request.items,[{type:'file',id:'100'}]);
  assert.equal(request.include_reference,true);assert.equal(request.include_confidence_score,true);
  assert.equal(result.metadata.file_version.id,'1');
});
test('Box rejects version/folder changes and never retries extraction',async()=>{
  const changed=mockBox([metadata,{answer:{}},{...metadata,file_version:{id:'2'}}]);
  await assert.rejects(changed.adapter.extractChecked('100'),/CHANGED_DURING/);assert.equal(changed.requests.length,3);
  const moved=mockBox([{...metadata,parent:{id:'13'}}]);await assert.rejects(moved.adapter.extractChecked('100'),/FOLDER_MISMATCH/);assert.equal(moved.requests.length,1);
});
const opportunity:Opportunity={opportunity_id:CONTEXT.opportunity_id,business_id:CONTEXT.business_id,tax_year:2025,rule_set_id:CONTEXT.rule_set_id,revision:1,ledger_rev:1,profile_rev:1,evaluation_key:'1:1',assessment:'potential_opportunity',stage:'evidence_updated',annual_readiness:'annual_requirements_unresolved',synthetic_data:true,historical_demo:true,evidence_checks:[],annual_requirements:ANNUAL_IDS.map(requirement_id=>({requirement_id,result:'unknown',fact_ids:[],source_ids:[],reason:'Unresolved'})),estimate:{status:'unavailable',amount_cents:null,reason:'Annual requirements unresolved'},next_action:{id:'review_remaining_requirements',label:'Review remaining requirements'},reported_employer_share_basis_points:8000,summary:'Potential opportunity. Annual requirements remain unresolved.',fact_ids:['f1'],rule_source_ids:['irs-45r'],execution:{synthetic_data:true,intake_mode:'fixture',extraction_mode:'fixture',explanation_mode:'not_run'}};
const context:ExplanationContext={opportunity,facts:[]};
const explanation={summary:'Reported employer share is 80%. Annual requirements remain unresolved.',what_changed:'',fact_ids:['f1'],rule_ids:['coverage_period']};
test('explanation requires exact fields and schema bounds, unique allowlisted refs, supported numbers',()=>{
  assert.deepEqual(validateExplanation(explanation,context),explanation);
  assert.throws(()=>validateExplanation({...explanation,extra:true},context),/FIELDS/);
  assert.throws(()=>validateExplanation({...explanation,summary:'x'.repeat(601)},context),/TEXT/);
  assert.throws(()=>validateExplanation({...explanation,what_changed:'x'.repeat(351)},context),/TEXT/);
  assert.throws(()=>validateExplanation({...explanation,summary:''},context),/TEXT/);
  assert.throws(()=>validateExplanation({...explanation,fact_ids:['unknown']},context),/REFERENCE/);
  assert.throws(()=>validateExplanation({...explanation,fact_ids:['f1','f1']},context),/REFERENCE/);
  assert.throws(()=>validateExplanation({...explanation,rule_ids:['irs-45r']},context),/REFERENCE/);
  assert.throws(()=>validateExplanation({...explanation,rule_ids:[...ANNUAL_IDS,'coverage_period']},context),/REFERENCE/);
  assert.throws(()=>validateExplanation({...explanation,summary:'Employer share is 81%.'},context),/NUMBER/);
  assert.throws(()=>validateExplanation({...explanation,summary:'You are eligible for a tax refund.'},context),/CLAIM/);
  assert.throws(()=>validateExplanation({...explanation,summary:'Payment matches the coverage statement.'},context),/CLAIM/);
  assert.throws(()=>validateExplanation({...explanation,summary:'Annual requirements are resolved.'},context),/CLAIM/);
  assert.throws(()=>validateExplanation({...explanation,summary:'The credit is 80 dollars.'},context),/CLAIM/);
  assert.throws(()=>parseCompleteExplanation('```json\n'+JSON.stringify(explanation)+'\n```',context));
  assert.throws(()=>parseCompleteExplanation(JSON.stringify(explanation)+' trailing',context));
  const fallback=deterministicExplanation(context);assert.doesNotThrow(()=>validateExplanation(fallback,context));
});
test('model invalid stop/output returns deterministic fallback preserving usage with one invocation',async()=>{
  let calls=0;
  const result:StrandsResult={stopReason:'maxTokens',lastMessage:{content:[{type:'text',text:JSON.stringify(explanation)}]},metrics:{accumulatedUsage:{inputTokens:20,outputTokens:350,totalTokens:370}}};
  const receipt=await explainWithStrands(context,{approvedLiveCall:true,env,invoke:async()=>{calls++;return result;}});
  assert.equal(calls,1);assert.equal(receipt.mode,'deterministic_fallback');assert.equal(receipt.usage.outputTokens,350);assert.equal(receipt.reason,'EXPLANATION_NOT_END_TURN');
  const valid=await explainWithStrands(context,{approvedLiveCall:true,env,invoke:async()=>({...result,stopReason:'endTurn'})});assert.equal(valid.mode,'live_bedrock');
  await assert.rejects(explainWithStrands(context,{approvedLiveCall:false,env,invoke:async()=>{throw new Error('must not call');}}),/EXPLICIT_APPROVAL/);
});
function fakeDynamo(){let item:Record<string,unknown>|undefined;let conflicts=0;const send:DynamoTransport=async command=>{
  if(command instanceof GetCommand)return {Item:item?structuredClone(item):undefined};
  const input=(command as PutCommand).input;
  if(input.ConditionExpression==='attribute_not_exists(pk)'?!!item:item?.revision!==input.ExpressionAttributeValues?.[':expected']){conflicts++;const error=new Error('conditional conflict');error.name='ConditionalCheckFailedException';throw error;}
  item=structuredClone(input.Item);return {};
};return {send,get item(){return item;},get conflicts(){return conflicts;}};}
test('Dynamo aggregate CAS retries conflicts without losing independent concurrent state changes',async()=>{
  const fake=fakeDynamo(),a=new DynamoStore('test-table',CONTEXT.business_id,fake.send),b=new DynamoStore('test-table',CONTEXT.business_id,fake.send);
  await Promise.all([a.transact(state=>{state.profile_rev++;}),b.transact(state=>{state.ledger_rev++;})]);
  const state=await a.read();assert.equal(state.profile_rev,1);assert.equal(state.ledger_rev,1);assert.equal(fake.item?.revision,2);assert.equal(fake.conflicts,1);
});
test('Dynamo rejects oversized history/state atomically rather than truncating',async()=>{
  const fake=fakeDynamo(),store=new DynamoStore('test-table',CONTEXT.business_id,fake.send);
  await store.transact(state=>{state.profile=structuredClone(DEFAULT_PROFILE);});
  await assert.rejects(store.transact(state=>{state.profile!.display_name='x'.repeat(310*1024);}),/CAPACITY_EXCEEDED/);
  assert.equal((await store.read()).profile?.display_name,DEFAULT_PROFILE.display_name);assert.equal(fake.item?.revision,1);
});
