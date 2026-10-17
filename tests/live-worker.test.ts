import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { CONTEXT, DEFAULT_PROFILE, type SourceInput } from '../packages/contracts/index.js';
import { fixtureSource } from '../fixtures/sources.js';
import { MemoryStore } from '../services/storage/store.js';
import { DomainError, TallyEngine } from '../services/worker/core.js';
import { LiveWorker, type LiveSourceProvider, type LiveWorkerEnvelope } from '../services/worker/live-worker.js';
const message=(file_id='123'):LiveWorkerEnvelope=>({kind:'INGEST',business_id:CONTEXT.business_id,file_id,intake_mode:'webhook'});
const evaluation:LiveWorkerEnvelope={kind:'EVALUATE',business_id:CONTEXT.business_id};
function source(id='123',version='1',changed=false,fixtureId:'fixture-A'|'fixture-B'='fixture-A'):SourceInput{
  const fixture=fixtureSource(fixtureId);fixture.file_id=id;fixture.file_version_id=version;fixture.folder_id='12345';fixture.source_url=`https://app.box.com/file/${id}`;
  if(changed)fixture.sha256=createHash('sha256').update(`${id}:${version}:different bytes`).digest('hex');
  for(const fact of fixture.facts){fact.fact_id=`${id}:${version}:${fact.fact_type}`;fact.source.kind='box_document';fact.source.file_id=id;fact.source.file_version_id=version;fact.source.sha256=fixture.sha256;}
  return fixture;
}
const observation=(value:SourceInput):SourceInput=>({...structuredClone(value),business_name:null,facts:[]});
const gateError=(code:string)=>Object.assign(new Error('Private provider detail must never persist'),{code});
async function setup(provider?:LiveSourceProvider){
  const store=new MemoryStore();await new TallyEngine(store).saveProfile(DEFAULT_PROFILE,0);const queue:LiveWorkerEnvelope[]=[];
  const worker=new LiveWorker(store,{sourceProvider:provider??{prepare:async id=>observation(source(id)),extract:async item=>source(item.file_id,item.file_version_id)},enqueue:async item=>{queue.push(item);}});
  return {store,worker,queue};
}

test('worker prepares without AI, claims before extract, commits and hands evaluation to a separate message',async()=>{
  const calls:string[]=[];let store!:MemoryStore;const setupResult=await setup({prepare:async id=>{calls.push('prepare');return observation(source(id));},extract:async item=>{calls.push('extract');const state=await store.read();assert.equal(state.jobs.find(job=>job.file_version_id==='1')?.status,'extracting');assert.equal(state.jobs.find(job=>job.file_version_id==='1')?.attempts,1);return source(item.file_id);}});store=setupResult.store;
  assert.equal((await setupResult.worker.handle(message())).status,'completed');assert.deepEqual(calls,['prepare','extract']);assert.equal((await store.read()).opportunity,null);assert.equal(setupResult.queue[0].kind,'EVALUATE');await setupResult.worker.handle(evaluation);const state=await store.read();assert.equal(state.opportunity?.stage,'needs_coverage_statement');assert.equal(state.execution.extraction_mode,'live_box_ai');assert.equal(state.execution.intake_mode,'webhook');assert.equal(state.execution.explanation_mode,'deterministic_fallback');
});
test('API-style metadata preparation/analyze does not call AI until a worker lease is won',async()=>{
  let ai=0;const store=new MemoryStore();const engine=new TallyEngine(store,{resolveSource:async id=>observation(source(id)),extractSource:async item=>{ai++;return source(item.file_id);},extractionMode:'live_box_ai'});await engine.saveProfile(DEFAULT_PROFILE,0);await engine.analyze(['123']);assert.equal(ai,0);assert.equal((await store.read()).facts.length,0);await engine.processAll();assert.equal(ai,1);assert.equal((await store.read()).opportunity?.revision,1);
});
test('committed crash/handoff failure resumes by queueing evaluation with zero repeated extraction',async()=>{
  const store=new MemoryStore();await new TallyEngine(store).saveProfile(DEFAULT_PROFILE,0);let ai=0,fail=true;const queue:LiveWorkerEnvelope[]=[];const options={sourceProvider:{prepare:async id=>observation(source(id)),extract:async item=>{ai++;return source(item.file_id);}} satisfies LiveSourceProvider,enqueue:async(item:LiveWorkerEnvelope)=>{if(fail)throw new Error('secret queue failure');queue.push(item);}};
  const worker=new LiveWorker(store,options);await assert.rejects(worker.handle(message()),error=>error instanceof DomainError && error.code==='QUEUE_HANDOFF_FAILED' && error.retryable);let state=await store.read();assert.equal(ai,1);assert.equal(state.facts.length,5);assert.ok(state.pending_evaluation);assert.equal(state.jobs.find(job=>job.kind==='INGEST')?.committed,true);
  fail=false;await new LiveWorker(store,options).handle(message());assert.equal(ai,1);assert.equal(queue.length,1);await worker.handle(evaluation);state=await store.read();assert.equal(state.opportunity?.revision,1);assert.equal(state.facts.length,5);
});
test('concurrent deliveries invoke extraction once and the losing lease delivery requests retry',async()=>{
  let ai=0;let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});const {store,worker}=await setup({prepare:async id=>observation(source(id)),extract:async item=>{ai++;await gate;return source(item.file_id);}});
  const first=worker.handle(message());await new Promise<void>(resolve=>setImmediate(resolve));await assert.rejects(worker.handle(message()),error=>error instanceof DomainError && error.code==='INGEST_LEASE_ACTIVE' && error.retryable);release();await first;assert.equal(ai,1);assert.equal((await store.read()).jobs.find(job=>job.kind==='INGEST')?.attempts,1);
});
test('retryable Box failures release leases for a later delivery, bound attempts, and persist safe codes only',async()=>{
  let ai=0;const {store,worker}=await setup({prepare:async id=>observation(source(id)),extract:async()=>{ai++;throw gateError('BOX_HTTP_429');}});
  for(let attempt=0;attempt<2;attempt++){await assert.rejects(worker.handle(message()),error=>error instanceof DomainError && error.retryable && error.code==='BOX_HTTP_429');assert.equal((await store.read()).jobs[0].status,'queued');}
  const result=await worker.handle(message());assert.equal(result.status,'needs_review');assert.equal(result.code,'INGEST_ATTEMPTS_EXHAUSTED');assert.equal(ai,3);assert.equal((await store.read()).jobs[0].status,'failed');assert.doesNotMatch(JSON.stringify(await store.read()),/Private provider/);await worker.handle(message());assert.equal(ai,3);
});
test('permanent extraction failures are acknowledged for review and do not retry AI',async()=>{
  let ai=0;const {worker,store}=await setup({prepare:async id=>observation(source(id)),extract:async()=>{ai++;throw gateError('BOX_RESPONSE_SHAPE');}});const result=await worker.handle(message());assert.equal(result.status,'needs_review');assert.equal(result.code,'BOX_RESPONSE_SHAPE');assert.equal((await store.read()).facts.length,0);await worker.handle(message());assert.equal(ai,1);
});
test('changed-source extraction queues fresh observed bytes without attaching stale extraction facts',async()=>{
  const v1=source(),v2=source('123','2',true);let current=v1,ai=0;const queue:LiveWorkerEnvelope[]=[];const store=new MemoryStore();await new TallyEngine(store).saveProfile(DEFAULT_PROFILE,0);const worker=new LiveWorker(store,{sourceProvider:{prepare:async()=>observation(current),extract:async()=>{ai++;if(ai===1){current=v2;throw Object.assign(gateError('BOX_SOURCE_CHANGED'),{currentObservation:observation(v2)});}return v2;}},enqueue:async item=>{queue.push(item);}});
  const result=await worker.handle(message());assert.equal(result.code,'SOURCE_CHANGED_REQUEUED');assert.equal((await store.read()).facts.length,0);assert.equal((await store.read()).documents[0].file_version_id,'2');assert.equal(queue[0].kind,'INGEST');assert.equal(ai,1);await worker.handle(queue.shift()!);assert.equal(ai,2);assert.ok((await store.read()).facts.every(fact=>fact.source.file_version_id==='2'));
});
test('changed source without a fresh observation retries metadata before another AI call',async()=>{
  let ai=0;const {store,worker}=await setup({prepare:async id=>observation(source(id)),extract:async()=>{ai++;throw gateError('BOX_SOURCE_CHANGED');}});await assert.rejects(worker.handle(message()),error=>error instanceof DomainError && error.code==='BOX_SOURCE_CHANGED' && error.retryable);assert.equal(ai,1);assert.equal((await store.read()).jobs[0].status,'queued');assert.equal((await store.read()).facts.length,0);
});
test('duplicate bytes under another file ID attach aliases without another provider extraction or card revision',async()=>{
  let ai=0;const {worker,store}=await setup({prepare:async id=>observation(source(id)),extract:async item=>{ai++;return source(item.file_id);}});await worker.handle(message('123'));await worker.handle(evaluation);await worker.handle(message('456'));assert.equal(ai,1);const state=await store.read();assert.equal(state.facts.length,5);assert.equal(state.opportunity?.revision,1);assert.ok(state.documents.find(doc=>doc.file_id==='123')?.aliases.includes('456'));
});
test('missing profile leaves observed work durable and retryable without calling AI',async()=>{
  const store=new MemoryStore();let ai=0;const worker=new LiveWorker(store,{sourceProvider:{prepare:async id=>observation(source(id)),extract:async item=>{ai++;return source(item.file_id);}},enqueue:async()=>{}});await assert.rejects(worker.handle(message()),error=>error instanceof DomainError && error.code==='PROFILE_REQUIRED' && error.retryable);assert.equal(ai,0);assert.equal((await store.read()).jobs[0].status,'queued');await new TallyEngine(store).saveProfile(DEFAULT_PROFILE,0);await worker.handle(message());assert.equal(ai,1);
});
test('EVALUATE messages never prepare or extract sources and duplicate current evaluations are skipped',async()=>{
  let prepare=0,ai=0;const {worker}=await setup({prepare:async id=>{prepare++;return observation(source(id));},extract:async item=>{ai++;return source(item.file_id);}});await worker.handle(message());await worker.handle(evaluation);await worker.handle(evaluation);assert.equal(prepare,1);assert.equal(ai,1);
});
test('permanent prepare failure terminalizes intake stubs while transient prepare failure leaves queued work',async()=>{
  for(const code of ['BOX_HTTP_403','BOX_HTTP_503']){const {worker,store}=await setup({prepare:async()=>{throw gateError(code);},extract:async()=>{throw new Error('not allowed');}});await store.transact(state=>{state.jobs.push({job_id:'INTAKE:test',kind:'INGEST',file_id:'123',file_version_id:null,status:'queued',attempts:0,lease_until:null,error:null,committed:false});});if(code.endsWith('503')){await assert.rejects(worker.handle(message()),error=>error instanceof DomainError && error.retryable);assert.equal((await store.read()).jobs[0].status,'queued');}else{assert.equal((await worker.handle(message())).status,'needs_review');assert.equal((await store.read()).jobs[0].status,'needs_review');}}
});
test('older preparation cannot complete a newer queued source or invoke extraction against it',async()=>{
  const store=new MemoryStore();await new TallyEngine(store).saveProfile(DEFAULT_PROFILE,0);const v2=source('123','2',true);await new TallyEngine(store).observeSource(observation(v2));let ai=0;const worker=new LiveWorker(store,{sourceProvider:{prepare:async()=>observation(source()),extract:async()=>{ai++;return source();}},enqueue:async()=>{}});await assert.rejects(worker.handle(message()),error=>error instanceof DomainError && error.code==='STALE_SOURCE_OBSERVATION' && error.retryable);const state=await store.read();assert.equal(ai,0);assert.equal(state.documents[0].file_version_id,'2');assert.equal(state.jobs.find(job=>job.file_version_id==='2')?.committed,false);assert.equal(state.jobs.find(job=>job.file_version_id==='2')?.status,'queued');
});
test('repeated changed-source errors without a fresh snapshot stop after the bounded attempt limit',async()=>{
  let ai=0;const {store,worker}=await setup({prepare:async id=>observation(source(id)),extract:async()=>{ai++;throw gateError('BOX_SOURCE_CHANGED');}});for(let attempt=0;attempt<2;attempt++)await assert.rejects(worker.handle(message()),error=>error instanceof DomainError && error.retryable);assert.equal((await worker.handle(message())).code,'SOURCE_CHANGED_RETRY_EXHAUSTED');assert.equal(ai,3);assert.equal((await store.read()).jobs[0].status,'failed');await worker.handle(message());assert.equal(ai,3);
});

test('permanent preparation failure durably withdraws accepted support without inventing a new source identity or calling AI',async()=>{
  const accepted=source('123','1',false,'fixture-B');let unavailable=false,ai=0,explanations=0;
  const store=new MemoryStore();await new TallyEngine(store).saveProfile(DEFAULT_PROFILE,0);const queue:LiveWorkerEnvelope[]=[];
  const worker=new LiveWorker(store,{sourceProvider:{prepare:async()=>{if(unavailable)throw gateError('BOX_PDF_TOO_MANY_PAGES');return observation(accepted);},extract:async()=>{ai++;return accepted;}},enqueue:async item=>{queue.push(item);},explain:async()=>{explanations++;throw new Error('offline fallback');}});
  await worker.handle(message());await worker.handle(evaluation);const before=await store.read();assert.equal(before.opportunity?.reported_employer_share_basis_points,8000);assert.equal(before.opportunity?.stage,'evidence_updated');
  unavailable=true;queue.length=0;const result=await worker.handle(message());const state=await store.read();
  assert.deepEqual(result,{status:'needs_review',code:'BOX_PDF_TOO_MANY_PAGES'});assert.equal(ai,1);assert.equal(explanations,1);
  assert.deepEqual(state.documents.map(doc=>[doc.file_version_id,doc.sha256,doc.accepted_version]),before.documents.map(doc=>[doc.file_version_id,doc.sha256,doc.accepted_version]));
  assert.equal(state.documents[0].status,'needs_review');assert.equal(state.documents[0].error,'BOX_PDF_TOO_MANY_PAGES');
  assert.ok(state.facts.filter(fact=>fact.source.file_id==='123').every(fact=>fact.verification_state==='needs_review'));assert.equal(state.facts.find(fact=>fact.fact_type==='reported_employer_share_basis_points')?.verification_state,'superseded');
  assert.equal(state.ledger_rev,before.ledger_rev+1);assert.equal(state.pending_evaluation?.ledger_rev,state.ledger_rev);assert.notEqual(state.opportunity?.ledger_rev,state.ledger_rev);assert.deepEqual(queue,[evaluation]);
  assert.ok(state.jobs.some(job=>job.job_id.startsWith('PREPARE:') && job.file_version_id===null && job.status==='needs_review' && !job.committed));assert.doesNotMatch(JSON.stringify(state),/Private provider detail/);
  await worker.handle(evaluation);const reviewed=(await store.read()).opportunity!;assert.equal(reviewed.stage,'needs_review');assert.equal(reviewed.reported_employer_share_basis_points,null);assert.ok(reviewed.evidence_checks.every(check=>check.result==='unknown'));assert.ok(reviewed.annual_requirements.every(check=>check.result==='unknown'));
});
test('preparation failure preserves canonical support when an unchanged accepted alias remains available',async()=>{
  let failed=false,ai=0;const {store,worker,queue}=await setup({prepare:async id=>{if(failed&&id==='123')throw gateError('BOX_HTTP_403');return observation(source(id,'1',false,'fixture-B'));},extract:async item=>{ai++;return source(item.file_id,'1',false,'fixture-B');}});
  await worker.handle(message());await worker.handle(evaluation);await worker.handle(message('456'));const before=await store.read();queue.length=0;failed=true;await worker.handle(message());const state=await store.read();
  assert.equal(ai,1);assert.equal(state.documents.find(doc=>doc.file_id==='123')?.status,'needs_review');assert.equal(state.documents.find(doc=>doc.file_id==='456')?.status,'completed');
  assert.ok(state.facts.filter(fact=>fact.source.kind==='box_document').every(fact=>fact.verification_state==='source_supported'));assert.equal(state.opportunity?.reported_employer_share_basis_points,8000);assert.equal(state.ledger_rev,before.ledger_rev);assert.equal(state.pending_evaluation,null);assert.equal(queue.length,0);
});
test('fresh preparation of the same accepted bytes recovers retired facts without another extraction or duplicate amounts',async()=>{
  let failed=false,ai=0;const accepted=source('123','1',false,'fixture-B');const {store,worker}=await setup({prepare:async()=>{if(failed)throw gateError('BOX_PDF_PARSE_FAILED');return observation(accepted);},extract:async()=>{ai++;return accepted;}});
  await worker.handle(message());await worker.handle(evaluation);const before=await store.read();failed=true;await worker.handle(message());await worker.handle(evaluation);const retired=await store.read();await worker.handle(message());assert.equal((await store.read()).ledger_rev,retired.ledger_rev);
  failed=false;await worker.handle(message());await worker.handle(evaluation);const recovered=await store.read();
  assert.equal(ai,1);assert.equal(recovered.facts.length,before.facts.length);assert.deepEqual(recovered.facts.map(fact=>fact.fact_id),before.facts.map(fact=>fact.fact_id));assert.equal(recovered.documents[0].status,'completed');assert.equal(recovered.documents[0].error,null);
  assert.ok(recovered.jobs.filter(job=>job.job_id.startsWith('PREPARE:')).every(job=>job.committed && job.status==='completed' && job.error===null));assert.equal(recovered.opportunity?.opportunity_id,before.opportunity?.opportunity_id);assert.equal(recovered.opportunity?.stage,'evidence_updated');assert.equal(recovered.opportunity?.reported_employer_share_basis_points,8000);assert.ok(recovered.opportunity?.annual_requirements.every(check=>check.result==='unknown'));
});
test('failed evaluator handoff after preparation invalidation retries from durable state without repeating AI or ledger revisions',async()=>{
  let failed=false,queueFailed=false,ai=0;const accepted=source();const store=new MemoryStore();await new TallyEngine(store).saveProfile(DEFAULT_PROFILE,0);const queue:LiveWorkerEnvelope[]=[];
  const worker=new LiveWorker(store,{sourceProvider:{prepare:async()=>{if(failed)throw gateError('BOX_PDF_TOO_MANY_PAGES');return observation(accepted);},extract:async()=>{ai++;return accepted;}},enqueue:async item=>{if(queueFailed)throw new Error('Private queue detail');queue.push(item);}});
  await worker.handle(message());await worker.handle(evaluation);failed=true;queueFailed=true;queue.length=0;
  await assert.rejects(worker.handle(message()),error=>error instanceof DomainError && error.code==='QUEUE_HANDOFF_FAILED' && error.retryable);const invalidated=await store.read();assert.ok(invalidated.pending_evaluation);assert.equal(invalidated.documents[0].status,'needs_review');assert.ok(invalidated.facts.every(fact=>fact.verification_state==='needs_review'));assert.notEqual(invalidated.opportunity?.ledger_rev,invalidated.ledger_rev);assert.doesNotMatch(JSON.stringify(invalidated),/Private (?:queue|provider) detail/);
  queueFailed=false;assert.equal((await worker.handle(message())).status,'needs_review');assert.equal((await store.read()).ledger_rev,invalidated.ledger_rev);assert.equal(ai,1);assert.deepEqual(queue,[evaluation]);await worker.handle(queue[0]);assert.equal((await store.read()).opportunity?.stage,'needs_review');
});
test('transient preparation failure preserves a previously accepted source and current assessment',async()=>{
  let failed=false,ai=0;const {store,worker}=await setup({prepare:async()=>{if(failed)throw gateError('BOX_HTTP_503');return observation(source());},extract:async()=>{ai++;return source();}});
  await worker.handle(message());await worker.handle(evaluation);const before=await store.read();failed=true;
  await assert.rejects(worker.handle(message()),error=>error instanceof DomainError && error.code==='BOX_HTTP_503' && error.retryable);assert.deepEqual(await store.read(),before);assert.equal(ai,1);
});
test('preparation invalidation blocks an older extraction already in flight until a fresh observation arrives',async()=>{
  const v1=source(),v2=source('123','2',true);let current=v1,failed=false,ai=0;let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  const {store,worker}=await setup({prepare:async()=>{if(failed)throw gateError('BOX_PDF_PARSE_FAILED');return observation(current);},extract:async item=>{ai++;if(item.file_version_id==='2')await gate;return current;}});
  await worker.handle(message());await worker.handle(evaluation);current=v2;const inFlight=worker.handle(message());await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(ai,2);failed=true;await worker.handle(message());release();await inFlight;const state=await store.read();
  assert.equal(state.documents[0].status,'needs_review');assert.equal(state.documents[0].accepted_version,'1');assert.ok(state.facts.every(fact=>fact.source.file_version_id==='1' && fact.verification_state==='needs_review'));assert.ok(state.pending_evaluation);assert.ok(state.jobs.some(job=>job.job_id.startsWith('PREPARE:') && !job.committed));
});

test('an older observation cannot clear a durable preparation failure or restore stale evidence',async()=>{
  let current=source('123','2',true),failed=false;const {store,worker}=await setup({prepare:async()=>{if(failed)throw gateError('BOX_PDF_PARSE_FAILED');return observation(current);},extract:async()=>current});
  await worker.handle(message());await worker.handle(evaluation);failed=true;await worker.handle(message());const failedState=await store.read();failed=false;current=source();await worker.handle(message());const state=await store.read();
  assert.equal(state.documents[0].file_version_id,'2');assert.equal(state.documents[0].status,'needs_review');assert.equal(state.ledger_rev,failedState.ledger_rev);assert.ok(state.jobs.some(job=>job.job_id.startsWith('PREPARE:') && !job.committed));assert.ok(state.facts.every(fact=>fact.verification_state==='needs_review'));
});

test('same-version recovery preserves an active extraction lease through preparation invalidation',async()=>{
  const v1=source(),v2=source('123','2',true,'fixture-B');let current=v1,failed=false,v2Calls=0;
  let release!:()=>void,started!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),extracting=new Promise<void>(resolve=>{started=resolve;});
  const {store,worker}=await setup({prepare:async()=>{if(failed)throw gateError('BOX_PDF_PARSE_FAILED');return observation(current);},extract:async item=>{if(item.file_version_id==='2'){v2Calls++;if(v2Calls>1)throw gateError('SECOND_EXTRACTION_MUST_NOT_RUN');started();await gate;return v2;}return v1;}});
  await worker.handle(message());await worker.handle(evaluation);const before=await store.read();current=v2;
  const inFlight=worker.handle(message());await extracting;const lease=(await store.read()).jobs.find(job=>job.file_version_id==='2')!.lease_until;
  try{
    failed=true;await new LiveWorker(store,worker.options).handle(message());const invalidated=await store.read();
    assert.equal(invalidated.documents[0].status,'needs_review');assert.ok(invalidated.facts.every(fact=>fact.source.file_version_id==='1' && fact.verification_state==='needs_review'));assert.notEqual(invalidated.opportunity?.ledger_rev,invalidated.ledger_rev);
    assert.equal(invalidated.jobs.find(job=>job.file_version_id==='2')?.lease_until,lease);assert.equal(invalidated.jobs.find(job=>job.file_version_id==='2')?.status,'extracting');
    failed=false;await assert.rejects(new LiveWorker(store,worker.options).handle(message()),error=>error instanceof DomainError && error.code==='INGEST_LEASE_ACTIVE' && error.retryable);
    const recovering=await store.read(),job=recovering.jobs.find(job=>job.file_version_id==='2')!;
    assert.equal(v2Calls,1);assert.equal(job.attempts,1);assert.equal(job.lease_until,lease);assert.equal(job.status,'extracting');assert.ok(recovering.facts.every(fact=>fact.verification_state==='needs_review'));assert.ok(recovering.jobs.find(job=>job.job_id.startsWith('PREPARE:'))?.committed);
  }finally{release();await inFlight;}
  await worker.handle(evaluation);const recovered=await store.read();assert.equal(v2Calls,1);assert.equal(recovered.documents[0].accepted_version,'2');assert.equal(recovered.documents[0].status,'completed');assert.ok(recovered.facts.filter(fact=>fact.source.file_version_id==='1').every(fact=>fact.verification_state==='superseded'));assert.ok(recovered.facts.filter(fact=>fact.source.file_version_id==='2').every(fact=>fact.verification_state==='source_supported'));
  assert.equal(recovered.opportunity?.opportunity_id,before.opportunity?.opportunity_id);assert.equal(recovered.opportunity?.reported_employer_share_basis_points,8000);assert.ok(recovered.opportunity?.annual_requirements.every(check=>check.result==='unknown'));await worker.handle(message());assert.equal(v2Calls,1);
});
