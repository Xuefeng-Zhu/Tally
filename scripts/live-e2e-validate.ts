/** Offline evidence checks only. This module has no SDK client, credential lookup or network path. */
import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ANNUAL_IDS, CONTEXT, EVIDENCE_IDS, type Fact, type State } from '../packages/contracts/index.js';
import { MODEL } from '../packages/contracts/model.js';
import { validateExplanation } from '../services/providers/explanation.js';
import { parseBoxExtraction } from '../services/providers/box.js';
export const SNAPSHOT_STAGES=['after_a','after_b','after_duplicate','after_refresh'] as const;
export type SnapshotStage=typeof SNAPSHOT_STAGES[number];
export const REQUIRED_EXTERNAL_EVIDENCE={
  box_delivery:'Box delivery exports and API acknowledgment traces for both uploads; state labels do not prove webhook delivery.',
  box_extraction:'Actual Box structured-extraction request/response artifacts, stable version/hash checks and verified reference receipts.',
  queue_worker:'SQS and worker correlation traces showing no extraction in acknowledgment and a durable INGEST to EVALUATE handoff.',
  dynamodb_reads:'Independent consistent DynamoDB reads for all four snapshots, compared with the API business state.',
  luna_invocation:'Actual Luna request IDs, fixed profile/region/options, token usage and complete validated explanation artifacts for A and B.',
  luna_guards:'Saved guard-test output for unsupported claims, amounts, references and annual completion, plus validation of the actual live output.',
  duplicate_delivery:'A duplicate-delivery trace demonstrating zero additional extraction/model requests or card effects.',
  browser_refresh:'A browser hard-refresh/network receipt and fresh GET /api/state response, independent of the rendered UI.',
} as const;
export type ExternalEvidenceKind=keyof typeof REQUIRED_EXTERNAL_EVIDENCE;
export type LocalArtifact={path:string;sha256:string;kind:'api_snapshot'|'external_trace'|'raw_export'};
export type SourceIdentity={file_id:string;file_version_id:string;sha256:string};
export type SavedRunManifest={schema:'tally-live-e2e-v1';run_id:string;target:{business_id:string;tax_year:number;rule_set_id:string;model_id:string;source_region:string;sources:{a:SourceIdentity;b:SourceIdentity}};artifacts:Record<string,LocalArtifact>;snapshots:Record<SnapshotStage,string>;external_evidence?:Partial<Record<ExternalEvidenceKind,string>>};
export type SavedRunBundle={manifest:SavedRunManifest;artifacts:Record<string,Uint8Array|string>};
export type EvidenceIssue={code:string;path:string;message:string};
export type SavedRunReport={status:'snapshot_checks_passed'|'local_evidence_consistent'|'checks_failed';valid:boolean;mode:'offline_saved_evidence';live_execution_authenticated:false;external_actions_executed:[];issues:EvidenceIssue[];external_evidence:Record<ExternalEvidenceKind,{status:'missing'|'inconsistent'|'supplied_for_manual_review';required_evidence:string}>;limitations:string[]};
const record=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const sha=(value:Uint8Array|string)=>createHash('sha256').update(value).digest('hex');
const hex=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const text=(value:unknown)=>typeof value==='string'&&value.trim().length>0;
const integer=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>=0;
function canonical(value:unknown):unknown{if(Array.isArray(value))return value.map(canonical);if(record(value))return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));return value;}
/** Ignores API decoration and transport-job bookkeeping; keeps actual facts, cards, history and revisions. */
export function businessStateFingerprint(state:State):string{
  const documents=state.documents.map(doc=>({...doc,aliases:[...doc.aliases].sort()})).sort((a,b)=>a.file_id.localeCompare(b.file_id));
  return sha(JSON.stringify(canonical({profile:state.profile,profile_rev:state.profile_rev,ledger_rev:state.ledger_rev,documents,facts:[...state.facts].sort((a,b)=>a.fact_id.localeCompare(b.fact_id)),opportunity:state.opportunity,history:state.history})));
}
function currentFacts(state:State):Fact[]{return state.facts.filter(fact=>fact.value_state==='known'&&['source_supported','derived','owner_confirmed'].includes(fact.verification_state));}
function bodyState(input:unknown):State|null{const value=record(input)&&record(input.state)?input.state:input;return record(value)&&Array.isArray(value.documents)&&Array.isArray(value.facts)&&Array.isArray(value.jobs)&&Array.isArray(value.history)&&record(value.opportunity)&&record(value.profile)&&record(value.execution)?value as State:null;}
function persistedState(input:unknown):State|null{
  if(!record(input)||!record(input.Item))return null;const payload=input.Item.payload;
  try{return bodyState(JSON.parse(typeof payload==='string'?payload:record(payload)&&typeof payload.S==='string'?payload.S:''));}catch{return null;}
}
export function validateSavedE2E(bundle:SavedRunBundle,options:{snapshotsOnly?:boolean}={}):SavedRunReport{
  const issues:EvidenceIssue[]=[],manifest=bundle.manifest,parsed=new Map<string,unknown>();
  const add=(code:string,path:string,message:string)=>issues.push({code,path,message});
  const check=(condition:unknown,code:string,path:string,message:string)=>{if(!condition)add(code,path,message);};
  const external=Object.fromEntries(Object.entries(REQUIRED_EXTERNAL_EVIDENCE).map(([kind,description])=>[kind,{status:'missing',required_evidence:description}])) as SavedRunReport['external_evidence'];
  function artifact(id:unknown,path:string):unknown{
    if(typeof id!=='string'||!manifest.artifacts?.[id]||bundle.artifacts[id]===undefined){add('ARTIFACT_MISSING',path,'A named local artifact was not supplied.');return null;}
    if(parsed.has(id))return parsed.get(id);
    const bytes=bundle.artifacts[id];check(hex(manifest.artifacts[id].sha256)&&sha(bytes)===manifest.artifacts[id].sha256,'ARTIFACT_HASH_MISMATCH',path,'Artifact bytes do not match the manifest fingerprint.');
    try{const value=JSON.parse(typeof bytes==='string'?bytes:Buffer.from(bytes).toString('utf8'));parsed.set(id,value);return value;}catch{add('ARTIFACT_NOT_JSON',path,'This evidence artifact must be saved JSON.');return null;}
  }
  const states={} as Record<SnapshotStage,State>;
  try{
    check(manifest.schema==='tally-live-e2e-v1'&&/^[A-Za-z0-9_-]{1,80}$/.test(manifest.run_id),'MANIFEST_CONTEXT','manifest','A valid versioned run manifest is required.');
    check(manifest.target.business_id===CONTEXT.business_id&&manifest.target.tax_year===2025&&manifest.target.rule_set_id===CONTEXT.rule_set_id&&manifest.target.model_id===MODEL.model_id&&manifest.target.source_region===MODEL.region,'TARGET_MISMATCH','target','The saved run must target the fixed business, 2025 rule set and selected Luna profile/region.');
    for(const [name,source]of Object.entries(manifest.target.sources))check(text(source.file_id)&&text(source.file_version_id)&&hex(source.sha256),'SOURCE_IDENTITY_MISSING',`target.sources.${name}`,'File, version and actual byte hash must be recorded.');
    check(manifest.target.sources.a.file_id!==manifest.target.sources.b.file_id&&manifest.target.sources.a.sha256!==manifest.target.sources.b.sha256,'SOURCE_IDENTITY_COLLISION','target.sources','A and B must identify two distinct source documents.');
    for(const stage of SNAPSHOT_STAGES){
      const id=manifest.snapshots[stage],state=bodyState(artifact(id,`snapshots.${stage}`));
      check(manifest.artifacts[id]?.kind==='api_snapshot','SNAPSHOT_ARTIFACT_KIND',stage,'Snapshot references must identify saved API responses.');
      if(!state){add('SNAPSHOT_SHAPE',stage,'A full settled API State response is required.');continue;}states[stage]=state;
      const card=state.opportunity!,facts=currentFacts(state),ids=new Set(state.facts.map(fact=>fact.fact_id));
      check(integer(state.ledger_rev)&&integer(state.profile_rev)&&integer(card.revision)&&card.revision>0,'REVISION_SHAPE',stage,'Revisions must be nonnegative integer state counters.');
      check(card.business_id===CONTEXT.business_id&&card.tax_year===2025&&card.rule_set_id===CONTEXT.rule_set_id&&card.opportunity_id===CONTEXT.opportunity_id,'CARD_CONTEXT',stage,'The card must stay within the configured business and rule context.');
      check(card.ledger_rev===state.ledger_rev&&card.profile_rev===state.profile_rev&&card.evaluation_key===`${state.ledger_rev}:${state.profile_rev}:${CONTEXT.rule_set_id}`&&!state.pending_evaluation,'STALE_CARD_REVISION',stage,'A saved card must match current ledger/profile revisions with no pending evaluation.');
      check(ids.size===state.facts.length&&card.fact_ids.every(id=>ids.has(id)),'FACT_REFERENCE_INVALID',stage,'Fact IDs must be unique and card references must exist.');
      check(card.assessment==='potential_opportunity'&&card.annual_readiness==='annual_requirements_unresolved'&&card.estimate.status==='unavailable'&&card.estimate.amount_cents===null,'UNSUPPORTED_ELIGIBILITY_OR_ESTIMATE',stage,'The demonstration must not assert eligibility or produce a credit estimate.');
      check(card.annual_requirements.length===ANNUAL_IDS.length&&ANNUAL_IDS.every(id=>card.annual_requirements.filter(item=>item.requirement_id===id&&item.result==='unknown').length===1),'ANNUAL_REQUIREMENTS_CHANGED',stage,'Every annual requirement must remain separately unknown.');
      check(card.evidence_checks.length===EVIDENCE_IDS.length&&EVIDENCE_IDS.every(id=>card.evidence_checks.filter(item=>item.requirement_id===id).length===1),'EVIDENCE_CHECKS_MISSING',stage,'All five distinct evidence checks must remain present.');
      check(card.evidence_checks.find(item=>item.requirement_id==='payment_to_coverage_match')?.result==='unknown','INVENTED_PAYMENT_MATCH',stage,'Equal amounts and overlapping dates do not establish a confirmed payment match.');
      for(const id of ['recorded_insurance_payment','partial_payroll','coverage_period','stated_premium_breakdown'])check(card.evidence_checks.find(item=>item.requirement_id===id)?.result===(stage==='after_a'&&['coverage_period','stated_premium_breakdown'].includes(id)?'unknown':'supported'),'EVIDENCE_RESULT_CONTRADICTION',`${stage}.${id}`,'Evidence readiness must match the A then B demonstration sequence.');
      try{validateExplanation({summary:card.summary,what_changed:'',fact_ids:card.fact_ids.slice(0,16),rule_ids:[]},{opportunity:card,facts});}catch{add('UNSUPPORTED_SUMMARY',stage,'The summary contains unsupported claims, references or numbers.');}
      const canonicalKeys=new Set<string>();
      for(const fact of facts){
        check(fact.business_id===CONTEXT.business_id&&fact.extraction_schema_version===CONTEXT.extraction_schema_version,'FACT_CONTEXT',stage,'Facts must match the configured business and extraction format.');
        if(fact.verification_state==='source_supported'){
          check(fact.source.excerpt_validation==='matched'&&Boolean(fact.source.excerpt)&&state.documents.some(doc=>doc.sha256===fact.source.sha256&&doc.accepted_version===doc.file_version_id&&doc.status==='completed'),'UNSUPPORTED_CURRENT_FACT',stage,'Current evidence needs a matched excerpt and a current accepted document or unchanged alias.');
          const key=`${fact.source.sha256}:${fact.fact_type}`;check(!canonicalKeys.has(key),'DUPLICATE_CANONICAL_FACT',stage,'Identical bytes must have one canonical fact of each extracted type.');canonicalKeys.add(key);
        }
        if(fact.fact_type.startsWith('payroll_'))check(fact.relevant_period.scope==='partial_period','PAYROLL_ANNUALIZED',stage,'Partial payroll must not become annual evidence.');
        check(!(fact.unit==='USD_cents'&&fact.value===240000),'DOUBLE_COUNTED_PAYMENT',stage,'The recorded payment and stated contribution must not be summed into a second payment.');
      }
      const expected:Record<string,unknown>={recorded_payment_amount:120000,recorded_payment_date:'2025-06-05',payroll_total_hours:200,payroll_gross_wages:400000};
      if(stage!=='after_a')Object.assign(expected,{coverage_start:'2025-06-01',coverage_end:'2025-06-30',stated_total_premium:150000,stated_employer_contribution:120000,stated_employee_contribution:30000});
      for(const [type,value]of Object.entries(expected)){const actual=facts.filter(fact=>fact.fact_type===type);check(actual.length===1&&actual[0].value===value,'CONTRADICTORY_FIXTURE_VALUE',`${stage}.${type}`,'The saved value contradicts the fixed A/B demonstration records.');}
      for(const source of stage==='after_a'?[manifest.target.sources.a]:Object.values(manifest.target.sources))check(state.documents.some(doc=>doc.file_id===source.file_id&&doc.file_version_id===source.file_version_id&&doc.accepted_version===source.file_version_id&&doc.sha256===source.sha256&&doc.status==='completed'),'SOURCE_SNAPSHOT_MISMATCH',stage,'The accepted document identity must match the saved source manifest.');
      const expectedStage=stage==='after_a'?'needs_coverage_statement':'evidence_updated',expectedAction=stage==='after_a'?'upload_coverage_statement':'review_remaining_requirements';
      check(card.stage===expectedStage&&card.next_action.id===expectedAction&&card.reported_employer_share_basis_points===(stage==='after_a'?null:8000),'CARD_TRANSITION_INVALID',stage,'A must request coverage; B must update the same card with an 80% stated share and remaining annual questions.');
      if(stage==='after_a')check(!facts.some(fact=>fact.fact_type.startsWith('stated_')||fact.fact_type.startsWith('coverage_')),'B_EVIDENCE_PRESENT_TOO_EARLY',stage,'The A snapshot must precede coverage statement ingestion.');
      else{const share=facts.find(fact=>fact.fact_type==='reported_employer_share_basis_points'),inputs=facts.filter(fact=>['coverage_start','coverage_end','stated_total_premium','stated_employer_contribution','stated_employee_contribution'].includes(fact.fact_type));check(share?.value===8000&&share.verification_state==='derived'&&share.source.kind==='deterministic_derivation'&&share.source.input_fact_ids.length===5&&inputs.every(fact=>share.source.input_fact_ids.includes(fact.fact_id)),'SHARE_DERIVATION_INVALID',stage,'The stated share must derive only from the reconciled B components and period.');}
    }
    if(SNAPSHOT_STAGES.every(stage=>states[stage])){
      const a=states.after_a,b=states.after_b;check(b.opportunity!.revision>a.opportunity!.revision&&b.ledger_rev>a.ledger_rev&&b.profile_rev===a.profile_rev,'REVISION_TRANSITION_INVALID','sequence','B must advance the existing card and ledger without changing the saved profile.');
      for(const stage of ['after_duplicate','after_refresh'] as const)check(businessStateFingerprint(states[stage])===businessStateFingerprint(b),'DUPLICATE_OR_REFRESH_CHANGED_STATE',stage,'Duplicate delivery and refresh must preserve facts, card revision, history and current document state.');
    }
    for(const kind of Object.keys(REQUIRED_EXTERNAL_EVIDENCE) as ExternalEvidenceKind[]){
      const id=manifest.external_evidence?.[kind];if(!id){if(!options.snapshotsOnly)add('EXTERNAL_PROOF_MISSING',`external_evidence.${kind}`,REQUIRED_EXTERNAL_EVIDENCE[kind]);continue;}
      const before=issues.length,trace=artifact(id,`external_evidence.${kind}`);
      check(manifest.artifacts[id]?.kind==='external_trace','EXTERNAL_TRACE_KIND',kind,'Live claims require an external trace artifact, not another API snapshot.');
      if(!record(trace)||trace.kind!==kind||trace.run_id!==manifest.run_id||!text(trace.capture_source)||!text(trace.captured_at)||Number.isNaN(Date.parse(String(trace.captured_at)))||!Array.isArray(trace.records)){add('EXTERNAL_TRACE_SHAPE',kind,'A trace needs matching run/kind, capture source/time and correlated records.');external[kind].status='inconsistent';continue;}
      const rawId=trace.raw_artifact_id;
      check(typeof rawId==='string'&&manifest.artifacts[rawId]?.kind==='raw_export'&&rawId!==id&&bundle.artifacts[rawId]!==undefined,'RAW_EXTERNAL_EXPORT_MISSING',kind,'A trace receipt must reference a separately saved raw export.');
      if(typeof rawId==='string'&&bundle.artifacts[rawId]!==undefined)check(hex(manifest.artifacts[rawId]?.sha256)&&sha(bundle.artifacts[rawId])===manifest.artifacts[rawId]?.sha256,'ARTIFACT_HASH_MISMATCH',kind,'Raw export bytes must match the manifest fingerprint.');
      const rows=trace.records.filter(record),sourceRows=(source:SourceIdentity)=>rows.find(row=>row.file_id===source.file_id);
      if(kind==='box_delivery'||kind==='box_extraction'||kind==='queue_worker')for(const source of Object.values(manifest.target.sources)){
        const row=sourceRows(source);check(Boolean(row),'EXTERNAL_SOURCE_MISSING',kind,'Both A and B need correlated source receipts.');if(!row)continue;
        if(kind==='box_delivery')check(text(row.event_id)&&text(row.delivery_id)&&text(row.queue_message_id)&&hex(row.raw_event_sha256)&&row.ack_status===202&&row.signature_verified===true,'BOX_DELIVERY_TRACE_INVALID',kind,'Delivery evidence needs original-event hash, delivery/event/queue IDs and verified 202 acknowledgment.');
        if(kind==='queue_worker')check(text(row.queue_message_id)&&text(row.worker_request_id)&&row.ack_extraction_calls===0&&row.ingest_attempts===1&&row.evaluate_handoff===true,'QUEUE_TRACE_INVALID',kind,'Trace must show acknowledgment without extraction and a separate committed worker handoff.');
        if(kind==='box_extraction'){
          check(row.file_version_id===source.file_version_id&&row.sha256===source.sha256&&row.metadata_stable===true&&row.extract_requests===1&&text(row.provider_request_id)&&Array.isArray(row.matched_fact_ids)&&row.matched_fact_ids.length>0,'BOX_EXTRACTION_TRACE_INVALID',kind,'Actual extraction needs exact source identity, request receipt and verified fact references.');
          const response=artifact(row.response_artifact_id,`${kind}.response`);
          let supportedContainer=false;try{supportedContainer=Object.keys(parseBoxExtraction(response).reference).length>0;}catch{}
          check(typeof row.response_artifact_id==='string'&&manifest.artifacts[row.response_artifact_id]?.kind==='raw_export'&&supportedContainer,'BOX_RESPONSE_REFERENCE_MISSING',kind,'The actual provider answer and nonempty singular or plural reference container must be saved without conflicting containers, not inferred from API state.');
          const supportedIds=new Set(Object.values(states).flatMap(state=>currentFacts(state).filter(fact=>fact.verification_state==='source_supported'&&fact.source.sha256===source.sha256).map(fact=>fact.fact_id)));
          check(Array.isArray(row.matched_fact_ids)&&row.matched_fact_ids.every(id=>typeof id==='string'&&supportedIds.has(id)),'BOX_MATCHED_FACT_REFERENCE_INVALID',kind,'Verified reference receipts must identify existing supported facts from the same source bytes.');
        }
      }
      if(kind==='dynamodb_reads')for(const stage of SNAPSHOT_STAGES){const row=rows.find(row=>row.stage===stage),stored=row?persistedState(artifact(row.state_artifact_id,`${kind}.${stage}`)):null;check(row?.consistent_read===true&&text(row.table_name)&&Boolean(stored)&&Boolean(states[stage])&&businessStateFingerprint(stored!)===businessStateFingerprint(states[stage]),'DYNAMO_STATE_PROOF_INVALID',stage,'A separately saved consistent DynamoDB Item payload must match the API business state.');}
      if(kind==='luna_invocation')for(const stage of ['after_a','after_b'] as const){
        const row=rows.find(row=>row.stage===stage),usage=row&&record(row.usage)?row.usage:null;
        check(Boolean(row)&&row!.model_id===MODEL.model_id&&row!.region===MODEL.region&&text(row!.request_id)&&row!.attempts===1&&row!.stream===false&&row!.stop_reason==='endTurn'&&row!.structured_output===true&&usage&&integer(usage.inputTokens)&&Number(usage.inputTokens)>0&&integer(usage.outputTokens)&&Number(usage.outputTokens)>0&&integer(usage.totalTokens)&&usage.totalTokens===Number(usage.inputTokens)+Number(usage.outputTokens),'LUNA_RECEIPT_INVALID',stage,'Luna proof requires the exact profile, one bounded non-streaming turn, structured response and complete usage.');
        const explanation=row?artifact(row.explanation_artifact_id,`${kind}.${stage}.explanation`):null;
        try{if(!states[stage])throw new Error();const checked=validateExplanation(explanation,{opportunity:states[stage].opportunity!,facts:currentFacts(states[stage])});check(checked.summary===states[stage].opportunity!.summary,'LUNA_SUMMARY_MISMATCH',stage,'The saved live explanation must be the summary actually published.');}catch{add('LUNA_OUTPUT_UNVALIDATED',stage,'The actual saved model output must pass the same field/reference/claim guards as the application.');}
      }
      if(kind==='luna_guards')for(const caseId of ['eligibility_claim','unsupported_amount','unsupported_reference','annual_completion'])check(rows.some(row=>row.case_id===caseId&&row.outcome==='deterministic_fallback'&&typeof row.validation_code==='string'&&row.validation_code.startsWith('EXPLANATION_')),'LUNA_GUARD_EVIDENCE_MISSING',caseId,'Saved guard-test output must cover each unsupported-output failure mode.');
      if(kind==='duplicate_delivery')check(rows.some(row=>text(row.event_id)&&Number(row.delivery_count)>=2&&row.additional_extract_requests===0&&row.additional_model_requests===0&&row.card_revision_unchanged===true),'DUPLICATE_TRACE_INVALID',kind,'Zero repeated paid work requires a delivery/provider trace; API revisions alone are insufficient.');
      if(kind==='browser_refresh')check(rows.some(row=>row.hard_reload===true&&row.method==='GET'&&row.path==='/api/state'&&row.status===200&&row.cache_control==='no-store'&&row.response_artifact_id===manifest.snapshots.after_refresh),'REFRESH_TRACE_INVALID',kind,'A hard-reload network trace must identify the saved fresh state response.');
      external[kind].status=issues.length===before?'supplied_for_manual_review':'inconsistent';
    }
    if(!options.snapshotsOnly)for(const stage of SNAPSHOT_STAGES)if(states[stage])check(states[stage].execution.extraction_mode==='live_box_ai'&&states[stage].opportunity!.execution.explanation_mode==='live_bedrock'&&currentFacts(states[stage]).filter(fact=>fact.verification_state==='source_supported').every(fact=>fact.source.kind==='box_document'),'SNAPSHOT_LIVE_LABELS_MISSING',stage,'Fixture or fallback labels cannot support a fully live extraction/explanation claim; labels alone still do not prove a call.');
  }catch{add('MALFORMED_SAVED_EVIDENCE','manifest','A required saved field has an invalid shape. No external action was attempted.');}
  return {status:issues.length?'checks_failed':options.snapshotsOnly?'snapshot_checks_passed':'local_evidence_consistent',valid:issues.length===0,mode:'offline_saved_evidence',live_execution_authenticated:false,external_actions_executed:[],issues,external_evidence:external,limitations:['API snapshots demonstrate saved application state, not actual webhook delivery, provider execution or independent persistence.','Hash-bound external exports can be checked for local consistency; this offline tool cannot authenticate their provenance or authorize live actions.','Review actual Box/AWS/browser traces and current human authorization before claiming live E2E success or creating a new live demo.']};
}
export async function loadSavedRun(manifestPath:string):Promise<SavedRunBundle>{
  if(/^[a-z]+:\/\//i.test(manifestPath))throw new Error('LOCAL_MANIFEST_PATH_REQUIRED');
  const full=await realpath(resolve(manifestPath)),base=dirname(full);if((await stat(full)).size>65536)throw new Error('MANIFEST_SIZE_LIMIT');
  const manifest=JSON.parse(await readFile(full,'utf8')) as SavedRunManifest;if(!record(manifest.artifacts)||Object.keys(manifest.artifacts).length>64)throw new Error('ARTIFACT_LIST_INVALID');
  const artifacts:SavedRunBundle['artifacts']={};
  for(const [id,item]of Object.entries(manifest.artifacts)){
    if(!record(item)||typeof item.path!=='string'||isAbsolute(item.path)||item.path.split(/[\\/]/).includes('..')||item.path.includes('://'))throw new Error('LOCAL_ARTIFACT_PATH_REQUIRED');
    const path=await realpath(resolve(base,item.path)),distance=relative(base,path);if(distance.startsWith('..')||isAbsolute(distance))throw new Error('ARTIFACT_OUTSIDE_RUN_DIRECTORY');
    if((await stat(path)).size>2*1024*1024)throw new Error('ARTIFACT_SIZE_LIMIT');artifacts[id]=await readFile(path);
  }
  return {manifest,artifacts};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const args=process.argv.slice(2),paths=args.filter(arg=>!arg.startsWith('--'));
  if(args.some(arg=>arg.startsWith('--')&&!['--snapshots-only','--help'].includes(arg))||paths.length>1){console.error(JSON.stringify({code:'OFFLINE_VALIDATOR_ARGUMENTS_ONLY',external_actions_executed:[]}));process.exitCode=1;}
  else if(args.includes('--help')||!paths.length)console.log('Offline only: node_modules/node/bin/node --import tsx scripts/live-e2e-validate.ts RUN_MANIFEST.json [--snapshots-only]. Reads local files; never contacts providers.');
  else try{const result=validateSavedE2E(await loadSavedRun(paths[0]),{snapshotsOnly:args.includes('--snapshots-only')});console.log(JSON.stringify(result,null,2));if(!result.valid)process.exitCode=1;}catch{console.error(JSON.stringify({code:'LOCAL_EVIDENCE_LOAD_FAILED',external_actions_executed:[]}));process.exitCode=1;}
}
