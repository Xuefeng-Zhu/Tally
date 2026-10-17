import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { DEFAULT_PROFILE, emptyState, type Document, type Job, type State } from '../packages/contracts/index.js';
import { fixtureSource } from '../fixtures/sources.js';
import { assessmentUpdatePending, currentDocumentFacts, factDisplayValue, filterInbox, inboxEntries, partitionDocumentFacts, safeDocumentUrl, safeErrorCode } from '../apps/web/src/workspacePresentation.js';
function populated():State{
  const state=emptyState(),source=fixtureSource('fixture-A');state.profile=DEFAULT_PROFILE;state.profile_rev=1;state.ledger_rev=1;state.execution.extraction_mode='fixture';state.facts=source.facts;
  state.documents=[{file_id:source.file_id,file_version_id:source.file_version_id,name:source.name,sha256:source.sha256,folder_id:source.folder_id,status:'completed',source_url:source.source_url,aliases:[],error:null,accepted_version:source.file_version_id}];
  state.jobs=[{job_id:'INGEST:successful',kind:'INGEST',file_id:source.file_id,file_version_id:'1',status:'completed',attempts:1,lease_until:null,error:null,committed:true}];return state;
}
const failed=(overrides:Partial<Job>={}):Job=>({job_id:'INGEST:old-failed',kind:'INGEST',file_id:'fixture-A',file_version_id:'0',status:'failed',attempts:3,lease_until:null,error:'BOX_HTTP_503',committed:false,...overrides});
test('a completed current document ignores failed jobs from an earlier version and obsolete intake stubs',()=>{
  const state=populated();state.jobs.unshift(failed(),failed({job_id:'INTAKE:old',file_version_id:null}));const entry=inboxEntries(state)[0];assert.equal(entry.group,'ready');assert.equal(entry.status,'Ready to review');assert.equal(entry.job,null);assert.equal(entry.facts.length,5);
});
test('a new pending intake after the current successful source is visible without showing old failures',()=>{
  const state=populated();state.jobs.push(failed({job_id:'INTAKE:new',file_version_id:null,status:'queued',error:null,attempts:0}));const entry=inboxEntries(state)[0];assert.equal(entry.group,'processing');assert.equal(entry.status,'Waiting to process');
});
test('current fact counts exclude candidates, superseded versions, unverified excerpts and changed-byte references',()=>{
  const state=populated();state.facts[0].verification_state='candidate';state.facts[1].verification_state='superseded';state.facts[2].source.excerpt_validation='failed';assert.equal(currentDocumentFacts(state,state.documents[0]).length,2);state.documents[0].sha256='changed-current-bytes';assert.equal(currentDocumentFacts(state,state.documents[0]).length,0);
});
test('an unchanged content alias resolves its canonical facts while a replaced canonical source remains guarded',()=>{
  const state=populated(),original=state.documents[0];const alias:Document={...structuredClone(original),file_id:'alias-file',aliases:['fixture-A']};original.aliases=['alias-file'];state.documents.push(alias);original.sha256='new-content';original.file_version_id='2';original.status='failed';assert.equal(currentDocumentFacts(state,alias).length,5);assert.equal(currentDocumentFacts(state,original).length,0);
});
test('orphan intake rows expose latest actual work once per file, including safe attention status',()=>{
  const state=emptyState();state.jobs=[failed({file_id:'123',job_id:'old'}),failed({file_id:'123',job_id:'latest',status:'queued',error:null,attempts:0}),failed({file_id:'456',job_id:'attention'})];const entries=inboxEntries(state);assert.equal(entries.length,2);assert.equal(entries[0].group,'processing');assert.equal(entries[0].job?.job_id,'latest');assert.equal(entries[1].group,'attention');
});
test('search and filters work together on real document fields',()=>{
  const state=populated();state.documents.push({...structuredClone(state.documents[0]),file_id:'coverage',name:'June coverage statement.pdf',status:'needs_review',sha256:'different-bytes'});const entries=inboxEntries(state);assert.equal(filterInbox(entries,'payroll','ready').length,1);assert.equal(filterInbox(entries,'June','attention').length,1);assert.equal(filterInbox(entries,'not present','all').length,0);assert.equal(filterInbox(entries,'','attention').length,1);
});
test('processing updates depend on current revisions rather than historical evaluation jobs',()=>{
  const state=populated();state.jobs.push(failed({job_id:'EVALUATE:old',kind:'EVALUATE',file_id:null,status:'evaluating',error:null}));assert.equal(assessmentUpdatePending(state),false);state.pending_evaluation={ledger_rev:1,profile_rev:1,rule_set_id:'us-federal-irc45r-2025-v1'};assert.equal(assessmentUpdatePending(state),true);
});
test('display helpers preserve facts and reject unsafe source links or raw error messages',()=>{
  const source=fixtureSource('fixture-A');assert.equal(factDisplayValue(source.facts[0]),'$1,200.00');source.facts[0].value_state='unknown';assert.equal(factDisplayValue(source.facts[0]),'Not established');assert.equal(safeDocumentUrl('javascript:alert(1)'),null);assert.equal(safeDocumentUrl('//elsewhere.example/file.pdf'),null);assert.equal(safeDocumentUrl('/fixtures/initial-batch.pdf'),'/fixtures/initial-batch.pdf');assert.equal(safeErrorCode('private token detail'),'DOCUMENT_REVIEW_REQUIRED');assert.equal(safeErrorCode('BOX_HTTP_429'),'BOX_HTTP_429');
});
test('a card with stale ledger or profile revisions stays pending even without a queue marker',async()=>{
  const {TallyEngine}=await import('../services/worker/core.js');const {MemoryStore}=await import('../services/storage/store.js');const engine=new TallyEngine(new MemoryStore());await engine.saveProfile(DEFAULT_PROFILE,0);await engine.analyze(['fixture-A']);await engine.processAll();const state=await engine.state();assert.equal(state.pending_evaluation,null);assert.equal(assessmentUpdatePending(state),false);
  const staleLedger=structuredClone(state);staleLedger.ledger_rev++;assert.equal(assessmentUpdatePending(staleLedger),true);
  const staleProfile=structuredClone(state);staleProfile.profile_rev++;assert.equal(assessmentUpdatePending(staleProfile),true);
  const markedCurrent=structuredClone(state);markedCurrent.pending_evaluation={ledger_rev:state.ledger_rev,profile_rev:state.profile_rev,rule_set_id:state.opportunity!.rule_set_id};assert.equal(assessmentUpdatePending(markedCurrent),true);
});
test('a changed canonical document keeps alias-supported old bytes in earlier information, not its current details',()=>{
  const state=populated(),canonical=state.documents[0],alias:Document={...structuredClone(canonical),file_id:'unchanged-alias',aliases:[canonical.file_id]};canonical.aliases=[alias.file_id];state.documents.push(alias);canonical.sha256='changed-content';canonical.file_version_id='2';canonical.accepted_version='2';
  const candidate=structuredClone(state.facts[0]);candidate.fact_id='current-candidate';candidate.source.sha256=canonical.sha256;candidate.source.file_version_id='2';candidate.verification_state='candidate';state.facts.push(candidate);
  const canonicalDetails=partitionDocumentFacts(state,canonical);assert.deepEqual(canonicalDetails.current.map(fact=>fact.fact_id),['current-candidate']);assert.equal(canonicalDetails.earlier.length,5);assert.ok(canonicalDetails.earlier.every(fact=>fact.verification_state==='source_supported'));assert.equal(currentDocumentFacts(state,canonical).length,0);
  const aliasDetails=partitionDocumentFacts(state,alias);assert.equal(aliasDetails.current.length,5);assert.equal(aliasDetails.earlier.length,0);assert.equal(currentDocumentFacts(state,alias).length,5);
});
