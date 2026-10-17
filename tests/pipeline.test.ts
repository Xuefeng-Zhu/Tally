import { createHash } from 'node:crypto';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_PROFILE, type Opportunity, type SourceInput } from '../packages/contracts/index.js';
import { fixtureSource } from '../fixtures/sources.js';
import { DomainError, TallyEngine, evaluateSnapshot } from '../services/worker/core.js';
import { FileStore, MemoryStore } from '../services/storage/store.js';
const setup=async(options:ConstructorParameters<typeof TallyEngine>[1]={})=>{const store=new MemoryStore();const engine=new TallyEngine(store,options);await engine.saveProfile(DEFAULT_PROFILE,0);return {store,engine};};
const ingest=async(engine:TallyEngine,...ids:string[])=>{await engine.analyze(ids);await engine.processAll();return engine.state();};
function changed(input:SourceInput,version:string,mutate?:(source:SourceInput)=>void):SourceInput{
  const source=structuredClone(input);source.file_version_id=version;source.sha256=createHash('sha256').update(`changed-${source.file_id}-${version}`).digest('hex');
  for(const fact of source.facts){fact.fact_id=`${source.file_id}:${version}:${fact.fact_type}`;fact.source.file_version_id=version;fact.source.sha256=source.sha256;}
  mutate?.(source);return source;
}
function alias(input:SourceInput,id:string):SourceInput{const source=structuredClone(input);source.file_id=id;for(const fact of source.facts){fact.fact_id=`${id}:1:${fact.fact_type}`;fact.source.file_id=id;}return source;}
function cardContent(card:Opportunity|null){assert.ok(card);const {revision,ledger_rev,profile_rev,evaluation_key,...content}=card;return content;}

test('profile alone stores no facts, card, evaluation or explanation; optimistic revision protects edits',async()=>{
  let explanations=0;const {engine}=await setup({explain:async()=>{explanations++;throw new Error('unexpected');}});
  await engine.processAll();const state=await engine.state();assert.equal(state.opportunity,null);assert.equal(state.facts.length,0);assert.equal(state.jobs.length,0);assert.equal(explanations,0);
  await assert.rejects(engine.saveProfile({...DEFAULT_PROFILE,display_name:'Stale'},0),error=>error instanceof DomainError && error.status===409);
});
test('A then B updates one card, separates payment/contribution, never annualizes or confirms payment match',async()=>{
  const {engine}=await setup();const a=await ingest(engine,'fixture-A');assert.equal(a.opportunity?.stage,'needs_coverage_statement');assert.equal(a.opportunity?.reported_employer_share_basis_points,null);
  const b=await ingest(engine,'fixture-B');assert.equal(b.opportunity?.opportunity_id,a.opportunity?.opportunity_id);assert.equal(b.opportunity?.stage,'evidence_updated');assert.equal(b.opportunity?.reported_employer_share_basis_points,8000);assert.equal(b.history.length,1);
  assert.equal(b.opportunity?.evidence_checks.find(item=>item.requirement_id==='payment_to_coverage_match')?.result,'unknown');assert.ok(b.opportunity?.annual_requirements.every(item=>item.result==='unknown'));assert.equal(b.opportunity?.estimate.amount_cents,null);
  assert.equal(b.facts.filter(item=>item.fact_type==='recorded_payment_amount')[0].value,120000);assert.equal(b.facts.filter(item=>item.fact_type==='stated_employer_contribution')[0].value,120000);assert.ok(!b.facts.some(item=>item.value===240000));
  assert.ok(b.facts.filter(item=>item.fact_type.startsWith('payroll_')).every(item=>item.relevant_period.scope==='partial_period'));
});
test('B first has usable coverage and share; both intake orders converge on identical evidence content',async()=>{
  const first=await setup();const b=await ingest(first.engine,'fixture-B');assert.equal(b.opportunity?.stage,'evidence_updated');assert.equal(b.opportunity?.next_action.id,'review_remaining_requirements');assert.equal(b.opportunity?.reported_employer_share_basis_points,8000);
  for(const id of ['recorded_insurance_payment','partial_payroll','payment_to_coverage_match'])assert.equal(b.opportunity?.evidence_checks.find(item=>item.requirement_id===id)?.result,'unknown');
  const ba=await ingest(first.engine,'fixture-A');const second=await setup();await ingest(second.engine,'fixture-A');const ab=await ingest(second.engine,'fixture-B');assert.deepEqual(cardContent(ba.opportunity),cardContent(ab.opportunity));
});
test('duplicate deliveries and current evaluations produce no facts, card history or explanation effect',async()=>{
  let explanations=0;const {engine}=await setup({explain:async(card)=>{explanations++;return{summary:card.summary,what_changed:'Synthetic fixture',fact_ids:card.fact_ids,rule_ids:card.evidence_checks.map(item=>item.requirement_id)};}});
  const first=await ingest(engine,'fixture-A');await ingest(engine,'fixture-A');await engine.reconcile();await engine.processAll();const state=await engine.state();assert.equal(state.facts.length,first.facts.length);assert.equal(state.opportunity?.revision,1);assert.equal(state.history.length,0);assert.equal(explanations,1);
});
test('an extraction completed before observing v2 cannot commit after the newer observation',async()=>{
  const {engine}=await setup();const v1=fixtureSource('fixture-A');const v2=changed(v1,'2');await engine.observeSource(v1);
  // v1 extraction has returned, but its database transaction is delayed until after v2 is observed.
  const completedOldExtraction=structuredClone(v1);await engine.observeSource(v2);assert.equal((await engine.commitIngest(completedOldExtraction)).committed,false);await engine.commitIngest(v2);await engine.processAll();const state=await engine.state();assert.ok(state.facts.every(fact=>fact.source.file_version_id==='2'));assert.equal(state.documents[0].accepted_version,'2');
  assert.equal(await engine.observeSource(v1),false);
});
test('concurrent identical bytes atomically claim one canonical fact set and record an alias',async()=>{
  const {engine}=await setup();const a=fixtureSource('fixture-A');const duplicate=alias(a,'same-bytes-second-id');await Promise.all([engine.observeSource(a),engine.observeSource(duplicate)]);const results=await Promise.all([engine.commitIngest(a),engine.commitIngest(duplicate)]);await engine.processAll();const state=await engine.state();assert.equal(results.filter(item=>item.alias).length,1);assert.equal(state.facts.length,a.facts.length);assert.equal(state.documents.length,2);assert.ok(state.documents[0].aliases.includes('same-bytes-second-id'));assert.equal(state.ledger_rev,1);assert.equal(state.opportunity?.revision,1);
});
test('changed source failure preserves history and marks affected evidence stale while unrelated failed upload preserves current sources',async()=>{
  const {engine}=await setup();await ingest(engine,'fixture-A');const previous=(await engine.state()).opportunity!;const broken=changed(fixtureSource('fixture-A'),'2');await engine.observeSource(broken);await engine.failIngest(broken.file_id,'2','Synthetic extraction failure');await engine.processAll();let state=await engine.state();assert.ok(state.facts.every(fact=>fact.verification_state==='needs_review'));assert.equal(state.opportunity?.stage,'needs_review');assert.equal(state.history[0].evaluation_key,previous.evaluation_key);
  const healthy=await setup();await ingest(healthy.engine,'fixture-A');const unrelated=alias(fixtureSource('fixture-B'),'unrelated-new-file');await healthy.engine.observeSource(unrelated);await healthy.engine.failIngest(unrelated.file_id,'1','Synthetic extraction failure');await healthy.engine.processAll();state=await healthy.engine.state();assert.ok(state.facts.every(fact=>fact.verification_state==='source_supported'));assert.equal(state.opportunity?.stage,'needs_coverage_statement');assert.equal(state.opportunity?.revision,1);
});
test('new source versions supersede prior facts and invalidate older evaluation publications',async()=>{
  const {engine}=await setup();await ingest(engine,'fixture-A');await engine.saveProfile({...DEFAULT_PROFILE,activity:'Bakery and cafe'},1);const old=await engine.prepareEvaluation();assert.ok(old);
  const v2=changed(fixtureSource('fixture-A'),'2');await engine.observeSource(v2);await engine.commitIngest(v2);assert.equal(await engine.publishEvaluation(old,evaluateSnapshot(old)),false);await engine.processAll();const state=await engine.state();assert.equal(state.opportunity?.profile_rev,2);assert.ok(state.facts.filter(fact=>fact.source.file_version_id==='1').every(fact=>fact.verification_state==='superseded'));assert.ok(state.facts.filter(fact=>fact.source.file_version_id==='2').every(fact=>fact.verification_state==='source_supported'));
});
test('source support gates candidate/high-confidence facts, and conflicting component amounts/dates do not derive share',async()=>{
  const {engine}=await setup();const candidate=fixtureSource('fixture-A');candidate.facts.forEach(fact=>{fact.verification_state='candidate';fact.raw_provider_confidence=1;});await engine.observeSource(candidate);await engine.commitIngest(candidate);await engine.processAll();assert.equal((await engine.state()).opportunity,null);
  for(const kind of ['amount','date']){const sample=await setup();const bad=fixtureSource('fixture-B');if(kind==='amount')bad.facts.find(fact=>fact.fact_type==='stated_employee_contribution')!.value=40000;else bad.facts.find(fact=>fact.fact_type==='coverage_end')!.value='2025-05-31';await sample.engine.observeSource(bad);await sample.engine.commitIngest(bad);await sample.engine.processAll();const state=await sample.engine.state();assert.equal(state.opportunity?.stage,'needs_review');assert.equal(state.opportunity?.reported_employer_share_basis_points,null);assert.ok(!state.facts.some(fact=>fact.verification_state==='derived'));}
});
test('ledger commit and enqueue survive a crash; a new FileStore/worker resumes once without duplicate facts',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'tally-pipeline-'));const path=join(directory,'state.json');const first=new TallyEngine(new FileStore(path),{afterLedgerCommit:async()=>{throw new Error('SIMULATED_PROCESS_DEATH');}});await first.saveProfile(DEFAULT_PROFILE,0);await first.analyze(['fixture-A']);await assert.rejects(first.processAll(),/SIMULATED_PROCESS_DEATH/);const disk=JSON.parse(await readFile(path,'utf8'));assert.equal(disk.facts.length,5);assert.ok(disk.pending_evaluation);assert.ok(disk.jobs.some((job:JobLike)=>job.kind==='EVALUATE' && job.status==='queued'));
  const restarted=new TallyEngine(new FileStore(path));await restarted.processAll();const state=await restarted.state();assert.equal(state.facts.length,5);assert.equal(state.opportunity?.revision,1);assert.equal(state.pending_evaluation,null);await restarted.processAll();assert.equal((await restarted.state()).opportunity?.revision,1);
});
type JobLike={kind:string;status:string};
test('expired worker lease is reclaimed after restart, transactions roll back on failure, and reads cannot mutate state',async()=>{
  const {engine,store}=await setup();await engine.analyze(['fixture-A']);await store.transact(state=>{state.jobs[0].status='extracting';state.jobs[0].lease_until=0;});await new TallyEngine(store).processAll();assert.equal((await store.read()).opportunity?.revision,1);await assert.rejects(store.transact(state=>{state.profile_rev=100;throw new Error('abort');}));const state=await store.read();assert.equal(state.profile_rev,1);state.facts.length=0;assert.equal((await store.read()).facts.length,5);
});
test('unavailable or unsupported explanations fall back deterministically without changing evidence',async()=>{
  const {engine}=await setup({explain:async()=>({summary:'Unsupported claim',what_changed:'',fact_ids:['invented-fact'],rule_ids:[]})});const state=await ingest(engine,'fixture-A');assert.equal(state.opportunity?.execution.explanation_mode,'deterministic_fallback');assert.match(state.opportunity!.summary,/potential opportunity/);assert.ok(state.opportunity?.annual_requirements.every(item=>item.result==='unknown'));
});
test('identical profile retry succeeds across its original revision; missing profile reconcile and unknown files have explicit API errors',async()=>{
  const empty=new TallyEngine(new MemoryStore());await assert.rejects(empty.reconcile(),error=>error instanceof DomainError && error.code==='PROFILE_REQUIRED' && error.status===409);
  const {engine}=await setup();await engine.saveProfile(DEFAULT_PROFILE,0);assert.equal((await engine.state()).profile_rev,1);await assert.rejects(engine.analyze(['not-a-fixture']),error=>error instanceof DomainError && error.code==='UNSUPPORTED_DOCUMENT' && error.status===422);await assert.rejects(engine.analyze(['fixture-A','fixture-B','third']),error=>error instanceof DomainError && error.status===422);
});
test('malformed envelopes are rejected atomically, including high-confidence candidates and unsupported business names',async()=>{
  const cases:Array<(source:SourceInput)=>void>=[
    source=>{source.facts[0].value=120000.5;source.facts[0].verification_state='candidate';source.facts[0].raw_provider_confidence=1;},
    source=>{source.facts[0].value=Number.MAX_SAFE_INTEGER+1;},
    source=>{source.facts[0].unit='hours';},
    source=>{source.facts[0].relevant_period.start='2024-06-01';},
    source=>{source.facts[0].relevant_period.start='2025-02-30';},
    source=>{source.facts[0].relevant_period.start='2025-06-30';},
    source=>{source.facts[0].value_state='unknown';},
    source=>{source.facts[0].source.locator.page=0;},
    source=>{source.facts[0].source.excerpt='';},
    source=>{source.business_name='Some Other Business LLC';},
  ];
  for(const mutate of cases){const {engine}=await setup();const invalid=fixtureSource('fixture-A');mutate(invalid);await engine.observeSource(invalid);await assert.rejects(engine.commitIngest(invalid),error=>error instanceof DomainError && error.status===422);const state=await engine.state();assert.equal(state.facts.length,0);assert.equal(state.documents[0].accepted_version,null);assert.equal(state.ledger_rev,0);}
  const {engine}=await setup();const uncorresponded=fixtureSource('fixture-A');uncorresponded.business_name=null;await engine.observeSource(uncorresponded);await engine.commitIngest(uncorresponded);await engine.processAll();const state=await engine.state();assert.ok(state.facts.every(fact=>fact.verification_state==='candidate'));assert.equal(state.opportunity,null);
});
test('a changed canonical source does not retire unchanged content still available through an alias',async()=>{
  const {engine}=await setup();const initial=fixtureSource('fixture-A');const second=alias(initial,'preserved-alias');await engine.observeSource(initial);await engine.commitIngest(initial);await engine.observeSource(second);await engine.commitIngest(second);await engine.processAll();const v2=changed(initial,'2');await engine.observeSource(v2);await engine.failIngest(initial.file_id,'2','Changed source failed');await engine.processAll();const state=await engine.state();assert.ok(state.facts.every(fact=>fact.verification_state==='source_supported'));assert.equal(state.opportunity?.stage,'needs_coverage_statement');assert.equal(state.opportunity?.revision,1);
});
test('adding an alias to an already current card completes every document/job without another evaluation',async()=>{
  const {engine}=await setup();await ingest(engine,'fixture-A');const duplicate=alias(fixtureSource('fixture-A'),'later-alias');await engine.observeSource(duplicate);await engine.processAll();const state=await engine.state();assert.equal(state.opportunity?.revision,1);assert.equal(state.ledger_rev,1);assert.ok(state.documents.every(doc=>doc.status==='completed'));assert.ok(state.jobs.every(job=>job.status==='completed'));assert.equal(state.pending_evaluation,null);
});
test('concurrent workers claim the current evaluation once before invoking explanation',async()=>{
  const store=new MemoryStore();let calls=0;let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});const options={explain:async(card:Opportunity)=>{calls++;await gate;return{summary:card.summary,what_changed:'',fact_ids:card.fact_ids,rule_ids:[]};}};
  const first=new TallyEngine(store,options);const second=new TallyEngine(store,options);await first.saveProfile(DEFAULT_PROFILE,0);await first.analyze(['fixture-A']);const one=first.processAll();const two=second.processAll();await new Promise<void>(resolve=>setImmediate(resolve));release();await Promise.all([one,two]);assert.equal(calls,1);assert.equal((await store.read()).opportunity?.revision,1);
});
test('an empty changed-source extraction preserves history but cannot leave obsolete supported evidence current',async()=>{
  let resolved=fixtureSource('fixture-A');const {engine}=await setup({resolveSource:()=>resolved});await ingest(engine,'fixture-A');resolved=changed(resolved,'2');resolved.facts=[];await engine.analyze(['fixture-A']);await engine.processAll();const state=await engine.state();assert.equal(state.opportunity?.stage,'needs_review');assert.equal(state.opportunity?.evidence_checks.find(item=>item.requirement_id==='recorded_insurance_payment')?.result,'unknown');assert.ok(state.facts.every(fact=>fact.verification_state==='needs_review'));assert.equal(state.documents[0].status,'failed');assert.equal(state.pending_evaluation,null);assert.equal(state.opportunity?.ledger_rev,state.ledger_rev);assert.equal(state.history.length,1);
});
test('a changed source with only candidates cannot silently replace supported history or leave the old card current',async()=>{
  const {engine}=await setup();await ingest(engine,'fixture-A');const v2=changed(fixtureSource('fixture-A'),'2');v2.facts.forEach(fact=>fact.verification_state='candidate');await engine.observeSource(v2);await engine.commitIngest(v2);await engine.processAll();const state=await engine.state();assert.equal(state.opportunity?.stage,'needs_review');assert.equal(state.pending_evaluation,null);assert.ok(state.facts.filter(fact=>fact.source.file_version_id==='1').every(fact=>fact.verification_state==='needs_review'));assert.equal(state.opportunity?.evidence_checks.find(item=>item.requirement_id==='partial_payroll')?.result,'unknown');
});
test('publishing a current correction terminates obsolete queued evaluations so processing finishes',async()=>{
  const {engine}=await setup();await ingest(engine,'fixture-A');const corrected=changed(fixtureSource('fixture-A'),'2');await engine.observeSource(corrected);await engine.commitIngest(corrected);await engine.processAll();const state=await engine.state();assert.ok(state.jobs.every(job=>job.status==='completed'));assert.equal(state.pending_evaluation,null);assert.equal(state.opportunity?.ledger_rev,state.ledger_rev);
});
test('concurrent ingest workers atomically claim before any provider resolver call',async()=>{
  const store=new MemoryStore();const seed=new TallyEngine(store);await seed.saveProfile(DEFAULT_PROFILE,0);await seed.analyze(['fixture-A']);let calls=0;let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});const resolveSource=async()=>{calls++;await gate;return fixtureSource('fixture-A');};const first=new TallyEngine(store,{resolveSource});const second=new TallyEngine(store,{resolveSource});const one=first.processAll();const two=second.processAll();await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(calls,1);release();await Promise.all([one,two]);const state=await store.read();assert.equal(state.jobs.find(job=>job.kind==='INGEST')?.attempts,1);assert.equal(state.facts.length,5);assert.equal(state.opportunity?.revision,1);
});
test('late stale publication cannot reinstate pending work after the latest card was published',async()=>{
  const {engine}=await setup();await ingest(engine,'fixture-A');await engine.saveProfile({...DEFAULT_PROFILE,activity:'Updated activity'},1);const stale=await engine.prepareEvaluation();assert.ok(stale);await engine.saveProfile({...DEFAULT_PROFILE,activity:'Latest activity'},2);await engine.processAll();assert.equal(await engine.publishEvaluation(stale,evaluateSnapshot(stale)),false);const state=await engine.state();assert.equal(state.opportunity?.profile_rev,3);assert.equal(state.pending_evaluation,null);assert.ok(state.jobs.every(job=>job.status==='completed'));
});
test('the core independently rejects an eligibility claim even when a custom explanation hook returns no references',async()=>{
  const {engine}=await setup({explain:async()=>({summary:'You qualify for tax credit.',what_changed:'',fact_ids:[],rule_ids:[]})});const state=await ingest(engine,'fixture-A');assert.equal(state.opportunity?.execution.explanation_mode,'deterministic_fallback');assert.doesNotMatch(state.opportunity!.summary,/you qualify/i);
});
test('the core preserves deterministic fallback receipt labels from explanation adapters',async()=>{
  const {engine}=await setup({explain:async(card)=>({mode:'deterministic_fallback',explanation:{summary:card.summary,what_changed:'',fact_ids:card.fact_ids,rule_ids:[]},usage:{inputTokens:null,outputTokens:null,totalTokens:null},reason:'provider-unavailable'})});const state=await ingest(engine,'fixture-A');assert.equal(state.opportunity?.execution.explanation_mode,'deterministic_fallback');assert.equal(state.execution.explanation_mode,'deterministic_fallback');
});
test('a new version with unchanged bytes reuses its canonical fact set without another card revision',async()=>{
  const {engine}=await setup();await ingest(engine,'fixture-A');const before=await engine.state();const unchanged=changed(fixtureSource('fixture-A'),'2');unchanged.sha256=fixtureSource('fixture-A').sha256;unchanged.facts.forEach(fact=>fact.source.sha256=unchanged.sha256);await engine.observeSource(unchanged);await engine.commitIngest(unchanged);await engine.processAll();const state=await engine.state();assert.equal(state.facts.length,before.facts.length);assert.deepEqual(state.facts.map(fact=>fact.fact_id),before.facts.map(fact=>fact.fact_id));assert.equal(state.ledger_rev,before.ledger_rev);assert.equal(state.opportunity?.revision,1);assert.equal(state.documents[0].accepted_version,'2');assert.equal(state.documents[0].status,'completed');assert.ok(state.jobs.every(job=>job.status==='completed'));
});
test('restoring earlier canonical bytes reactivates their facts while superseding the replaced version',async()=>{
  const {engine}=await setup();await ingest(engine,'fixture-A');const original=fixtureSource('fixture-A');const v2=changed(original,'2');await engine.observeSource(v2);await engine.commitIngest(v2);await engine.processAll();const restored=changed(original,'3');restored.sha256=original.sha256;restored.facts.forEach(fact=>fact.source.sha256=restored.sha256);await engine.observeSource(restored);const inFlight=await engine.prepareEvaluation();assert.ok(inFlight);await engine.publishEvaluation(inFlight,evaluateSnapshot(inFlight));assert.equal((await engine.state()).opportunity?.stage,'needs_review');await engine.commitIngest(restored);await engine.processAll();const state=await engine.state();assert.equal(state.opportunity?.stage,'needs_coverage_statement');assert.ok(state.facts.filter(fact=>fact.source.file_version_id==='1').every(fact=>fact.verification_state==='source_supported'));assert.ok(state.facts.filter(fact=>fact.source.file_version_id==='2').every(fact=>fact.verification_state==='superseded'));assert.equal(state.facts.filter(fact=>fact.source.sha256===original.sha256).length,original.facts.length);assert.equal(state.pending_evaluation,null);
});
