/** Planning/read-only gate. Deliberately has no execution, upload, replay or provider-call implementation. */
import { pathToFileURL } from 'node:url';
import { CONTEXT } from '../packages/contracts/index.js';
import { MODEL } from '../packages/contracts/model.js';
import { loadSavedRun, REQUIRED_EXTERNAL_EVIDENCE, validateSavedE2E, type SavedRunManifest, type SavedRunReport } from './live-e2e-validate.js';
export const LIVE_ACTIONS=['cloud_read','box_upload','webhook_replay','box_ai_extract','luna_invoke','deploy','publish_demo'] as const;
export type LiveAction=typeof LIVE_ACTIONS[number];
/** An approval flag or a saved JSON receipt cannot turn this local verifier into a live runner. */
export function assertLocalOnlyActionGate(_action:LiveAction):never{throw new Error('LIVE_ACTIONS_DISABLED_IN_LOCAL_VERIFIER');}
export function liveE2EPreflight(saved?:SavedRunReport){return {
  mode:'offline_preflight',external_network:'disabled_by_design',external_actions_executed:[],live_actions_enabled:false,live_execution_authenticated:false,
  action_gate:'blocked_local_verifier',blocked_actions:[...LIVE_ACTIONS],
  requested_order:['integration verification','live E2E with independently captured traces','fix and retest failures','new live demo after reviewed E2E evidence'],
  target:{business_id:CONTEXT.business_id,tax_year:2025,rule_set_id:CONTEXT.rule_set_id,model_id:MODEL.model_id,source_region:MODEL.region},
  local_saved_evidence_status:saved?.status??'not_supplied',
  next_step:saved?.valid?'Review the original external traces and current human authorization; this local report does not authenticate live execution or enable any action.':'Finish local integration checks and collect an explicitly scoped, approved live run separately. Supply saved artifacts here for offline checking.',
  required_external_evidence:REQUIRED_EXTERNAL_EVIDENCE,
  authorization_note:'AWS login and saved configuration do not authorize this script to call providers, deploy, upload, replay or publish. No credentials are inspected and no runtime gate or app data is changed.',
};}
export function savedRunTemplate():SavedRunManifest{
  return {schema:'tally-live-e2e-v1',run_id:'replace_with_run_id',target:{business_id:CONTEXT.business_id,tax_year:2025,rule_set_id:CONTEXT.rule_set_id,model_id:MODEL.model_id,source_region:MODEL.region,sources:{a:{file_id:'',file_version_id:'',sha256:''},b:{file_id:'',file_version_id:'',sha256:''}}},artifacts:{api_a:{path:'snapshots/after-a.json',sha256:'',kind:'api_snapshot'},api_b:{path:'snapshots/after-b.json',sha256:'',kind:'api_snapshot'},api_duplicate:{path:'snapshots/after-duplicate.json',sha256:'',kind:'api_snapshot'},api_refresh:{path:'snapshots/after-refresh.json',sha256:'',kind:'api_snapshot'}},snapshots:{after_a:'api_a',after_b:'api_b',after_duplicate:'api_duplicate',after_refresh:'api_refresh'},external_evidence:{}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const args=process.argv.slice(2);
  if(args.length===1&&args[0]==='--template')console.log(JSON.stringify(savedRunTemplate(),null,2));
  else if(args.some(arg=>arg.startsWith('--'))||args.length>1){console.error(JSON.stringify({code:'LOCAL_PREFLIGHT_HAS_NO_LIVE_EXECUTION_FLAGS',external_actions_executed:[]}));process.exitCode=1;}
  else if(!args.length)console.log(JSON.stringify(liveE2EPreflight(),null,2));
  else try{console.log(JSON.stringify(liveE2EPreflight(validateSavedE2E(await loadSavedRun(args[0]))),null,2));}catch{console.error(JSON.stringify({code:'LOCAL_EVIDENCE_LOAD_FAILED',external_actions_executed:[]}));process.exitCode=1;}
}
