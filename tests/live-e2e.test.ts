import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DEFAULT_PROFILE, type State } from '../packages/contracts/index.js';
import { fixtureSource } from '../fixtures/sources.js';
import { MemoryStore } from '../services/storage/store.js';
import { TallyEngine } from '../services/worker/core.js';
import { loadSavedRun, SNAPSHOT_STAGES, validateSavedE2E, type SavedRunBundle, type SnapshotStage } from '../scripts/live-e2e-validate.js';
import { assertLocalOnlyActionGate, LIVE_ACTIONS, liveE2EPreflight, savedRunTemplate } from '../scripts/live-e2e-preflight.js';
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
async function savedFixtureRun():Promise<SavedRunBundle>{
  const engine=new TallyEngine(new MemoryStore());await engine.saveProfile(DEFAULT_PROFILE,0);await engine.analyze(['fixture-A']);await engine.processAll();const a=await engine.state();await engine.analyze(['fixture-B']);await engine.processAll();const b=await engine.state();await engine.analyze(['fixture-A']);await engine.processAll();const duplicate=await engine.state(),refresh=await engine.state();
  const manifest=savedRunTemplate();manifest.run_id='offline-unit-test';for(const name of ['a','b'] as const){const source=fixtureSource(name==='a'?'fixture-A':'fixture-B');manifest.target.sources[name]={file_id:source.file_id,file_version_id:source.file_version_id,sha256:source.sha256};}
  const artifacts:SavedRunBundle['artifacts']={};const states={after_a:a,after_b:b,after_duplicate:duplicate,after_refresh:refresh};for(const stage of SNAPSHOT_STAGES){const id=manifest.snapshots[stage],bytes=JSON.stringify(states[stage]);artifacts[id]=bytes;manifest.artifacts[id].sha256=digest(bytes);}return {manifest,artifacts};
}
function mutate(bundle:SavedRunBundle,stage:SnapshotStage,fn:(state:State)=>void){const id=bundle.manifest.snapshots[stage],state=JSON.parse(String(bundle.artifacts[id])) as State;fn(state);const bytes=JSON.stringify(state);bundle.artifacts[id]=bytes;bundle.manifest.artifacts[id].sha256=digest(bytes);}
const has=(bundle:SavedRunBundle,code:string)=>validateSavedE2E(bundle,{snapshotsOnly:true}).issues.some(issue=>issue.code===code);

test('saved A/B/duplicate/refresh fixture state can pass snapshot checks without being labeled live proof',async()=>{
  const result=validateSavedE2E(await savedFixtureRun(),{snapshotsOnly:true});assert.equal(result.valid,true,JSON.stringify(result.issues));assert.equal(result.status,'snapshot_checks_passed');assert.equal(result.live_execution_authenticated,false);assert.deepEqual(result.external_actions_executed,[]);assert.ok(Object.values(result.external_evidence).every(item=>item.status==='missing'));
});
test('contradictory source values or evidence checks fail even when manifest hashes match the modified snapshots',async()=>{
  const bundle=await savedFixtureRun();mutate(bundle,'after_b',state=>{state.facts.find(fact=>fact.fact_type==='stated_employee_contribution')!.value=40000;state.opportunity!.evidence_checks.find(check=>check.requirement_id==='coverage_period')!.result='unknown';});assert.ok(has(bundle,'CONTRADICTORY_FIXTURE_VALUE'));assert.ok(has(bundle,'EVIDENCE_RESULT_CONTRADICTION'));
});
test('summing the payment and stated contribution or inventing a payment match is rejected',async()=>{
  const bundle=await savedFixtureRun();mutate(bundle,'after_b',state=>{state.facts.find(fact=>fact.fact_type==='recorded_payment_amount')!.value=240000;state.opportunity!.evidence_checks.find(check=>check.requirement_id==='payment_to_coverage_match')!.result='supported';});assert.ok(has(bundle,'DOUBLE_COUNTED_PAYMENT'));assert.ok(has(bundle,'INVENTED_PAYMENT_MATCH'));
});
test('stale ledger/profile revisions and annual completion cannot appear as settled saved evidence',async()=>{
  const bundle=await savedFixtureRun();mutate(bundle,'after_b',state=>{state.profile_rev++;state.ledger_rev++;state.opportunity!.annual_requirements[0].result='supported';});assert.ok(has(bundle,'STALE_CARD_REVISION'));assert.ok(has(bundle,'ANNUAL_REQUIREMENTS_CHANGED'));
});
test('duplicate or refresh snapshots cannot silently add facts, history or card revisions',async()=>{
  const bundle=await savedFixtureRun();mutate(bundle,'after_duplicate',state=>{state.opportunity!.revision++;state.history.push(structuredClone(state.opportunity!));});assert.ok(has(bundle,'DUPLICATE_OR_REFRESH_CHANGED_STATE'));
});
test('API state and self-reported live mode labels are insufficient when external proof is required',async()=>{
  const bundle=await savedFixtureRun();for(const stage of SNAPSHOT_STAGES)mutate(bundle,stage,state=>{state.execution.extraction_mode='live_box_ai';state.opportunity!.execution.explanation_mode='live_bedrock';for(const fact of state.facts)if(fact.source.kind==='fixture_document')fact.source.kind='box_document';});const result=validateSavedE2E(bundle);assert.equal(result.valid,false);assert.ok(result.issues.some(issue=>issue.code==='EXTERNAL_PROOF_MISSING'));assert.equal(result.live_execution_authenticated,false);assert.ok(result.limitations.some(value=>value.includes('not actual webhook delivery')));
});
test('an API snapshot cannot be passed off as a Box delivery trace or independent persistence proof',async()=>{
  const bundle=await savedFixtureRun();bundle.manifest.external_evidence={box_delivery:bundle.manifest.snapshots.after_b,dynamodb_reads:bundle.manifest.snapshots.after_refresh};const result=validateSavedE2E(bundle);assert.ok(result.issues.some(issue=>issue.code==='EXTERNAL_TRACE_KIND'));assert.equal(result.external_evidence.box_delivery.status,'inconsistent');assert.equal(result.external_evidence.dynamodb_reads.status,'inconsistent');
});

function addArtifact(bundle:SavedRunBundle,id:string,value:unknown,kind:'external_trace'|'raw_export'){
  const bytes=JSON.stringify(value);bundle.artifacts[id]=bytes;bundle.manifest.artifacts[id]={path:`${id}.json`,sha256:digest(bytes),kind};
}
function addSyntheticBoxTrace(bundle:SavedRunBundle,container:'reference'|'references'|'conflicting'){
  const state=JSON.parse(String(bundle.artifacts[bundle.manifest.snapshots.after_b])) as State;
  const rows=Object.entries(bundle.manifest.target.sources).map(([name,source])=>{
    const responseId=`box-response-${name}`,reference={field:[{page:1,excerpt:'Synthetic redacted reference artifact'}]};
    addArtifact(bundle,responseId,{answer:{field:'synthetic'},...(container==='conflicting'?{reference,references:{different:[]}}:{[container]:reference})},'raw_export');
    return {...source,metadata_stable:true,extract_requests:1,provider_request_id:`synthetic-request-${name}`,matched_fact_ids:state.facts.filter(fact=>fact.verification_state==='source_supported'&&fact.source.sha256===source.sha256).map(fact=>fact.fact_id),response_artifact_id:responseId};
  });
  addArtifact(bundle,'box-raw',{synthetic_test_export:true,redacted:true},'raw_export');
  addArtifact(bundle,'box-trace',{kind:'box_extraction',run_id:bundle.manifest.run_id,capture_source:'offline-synthetic-test',captured_at:'2026-10-17T10:00:00Z',raw_artifact_id:'box-raw',records:rows},'external_trace');
  bundle.manifest.external_evidence={box_extraction:'box-trace'};
}

test('saved Box extraction receipts accept the same singular or plural reference containers as the application',async()=>{
  for(const container of ['reference','references'] as const){const bundle=await savedFixtureRun();addSyntheticBoxTrace(bundle,container);const result=validateSavedE2E(bundle,{snapshotsOnly:true});assert.equal(result.valid,true,JSON.stringify(result.issues));assert.equal(result.external_evidence.box_extraction.status,'supplied_for_manual_review');assert.equal(result.live_execution_authenticated,false);}
});
test('conflicting Box reference containers and facts from another source cannot support extraction receipts',async()=>{
  const ambiguous=await savedFixtureRun();addSyntheticBoxTrace(ambiguous,'conflicting');assert.ok(has(ambiguous,'BOX_RESPONSE_REFERENCE_MISSING'));
  const mismatched=await savedFixtureRun();addSyntheticBoxTrace(mismatched,'references');const receipt=JSON.parse(String(mismatched.artifacts['box-trace']));receipt.records[0].matched_fact_ids=receipt.records[1].matched_fact_ids;addArtifact(mismatched,'box-trace',receipt,'external_trace');assert.ok(has(mismatched,'BOX_MATCHED_FACT_REFERENCE_INVALID'));
});

test('artifact tampering is detected before a saved file can support a claim',async()=>{
  const bundle=await savedFixtureRun();const id=bundle.manifest.snapshots.after_a;bundle.artifacts[id]=String(bundle.artifacts[id])+' ';assert.ok(has(bundle,'ARTIFACT_HASH_MISMATCH'));
});
test('preflight exposes no executable live mode, approval flag or credential-based bypass',()=>{
  const prior=process.env.LIVE_PROVIDERS_ENABLED;process.env.LIVE_PROVIDERS_ENABLED='true';try{const report=liveE2EPreflight();assert.equal(report.live_actions_enabled,false);assert.equal(report.action_gate,'blocked_local_verifier');assert.deepEqual(report.external_actions_executed,[]);for(const action of LIVE_ACTIONS)assert.throws(()=>assertLocalOnlyActionGate(action),/LIVE_ACTIONS_DISABLED_IN_LOCAL_VERIFIER/);}finally{if(prior===undefined)delete process.env.LIVE_PROVIDERS_ENABLED;else process.env.LIVE_PROVIDERS_ENABLED=prior;}
});
test('local loader reads only named artifacts beneath its run directory and rejects path escape',async()=>{
  const bundle=await savedFixtureRun(),directory=await mkdtemp(join(tmpdir(),'tally-saved-evidence-'));for(const [id,bytes]of Object.entries(bundle.artifacts)){bundle.manifest.artifacts[id].path=`${id}.json`;await writeFile(join(directory,`${id}.json`),bytes);}const path=join(directory,'manifest.json');await writeFile(path,JSON.stringify(bundle.manifest));assert.equal(validateSavedE2E(await loadSavedRun(path),{snapshotsOnly:true}).valid,true);bundle.manifest.artifacts[bundle.manifest.snapshots.after_a].path='../outside.json';await writeFile(path,JSON.stringify(bundle.manifest));await assert.rejects(loadSavedRun(path),/LOCAL_ARTIFACT_PATH_REQUIRED/);await assert.rejects(loadSavedRun('https://example.com/run.json'),/LOCAL_MANIFEST_PATH_REQUIRED/);
});
test('CLI rejects live execution flags without exposing credential values',()=>{
  const root=resolve(import.meta.dirname,'..'),result=spawnSync(process.execPath,['--require','./tests/offline-guard.cjs','--import','tsx','scripts/live-e2e-preflight.ts','--approved-live-call'],{cwd:root,encoding:'utf8'});assert.equal(result.status,1);assert.match(result.stderr,/LOCAL_PREFLIGHT_HAS_NO_LIVE_EXECUTION_FLAGS/);assert.doesNotMatch(result.stderr,/credential|access_token|AWS_SECRET/);
});
