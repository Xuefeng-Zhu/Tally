import { CONTEXT } from '../../packages/contracts/index.js';
import { MODEL } from '../../packages/contracts/model.js';
export type LiveProvider='box'|'strands';
export class ProviderGateError extends Error { constructor(public readonly code:string){super(code);this.name='ProviderGateError';} }
export function requireEnv(env:NodeJS.ProcessEnv,key:string):string {const value=env[key]?.trim();if(!value)throw new ProviderGateError(`MISSING_${key}`);return value;}
/** Call before constructing a provider client or resolving credentials. Imports never call a provider. */
export function assertLiveGate(provider:LiveProvider,args:string[]=process.argv.slice(2),env:NodeJS.ProcessEnv=process.env):void {
  if (!args.includes('--approved-live-call')) throw new ProviderGateError('LIVE_CALL_REQUIRES_EXPLICIT_APPROVAL');
  if (requireEnv(env,'TALLY_DEMO_TENANT_ID')!==CONTEXT.business_id || requireEnv(env,'TALLY_TAX_YEAR')!==String(CONTEXT.tax_year) || requireEnv(env,'TALLY_RULE_SET_ID')!==CONTEXT.rule_set_id) throw new ProviderGateError('DEMO_TARGET_MISMATCH');
  if(provider==='strands' && (requireEnv(env,'AWS_REGION')!==MODEL.region || requireEnv(env,'BEDROCK_MODEL_ID')!==MODEL.model_id || requireEnv(env,'TALLY_EXPLANATION_ADAPTER')!=='strands'))throw new ProviderGateError('MODEL_TARGET_MISMATCH');
  if(provider==='box')for(const name of ['BOX_INPUT_FOLDER_ID','BOX_FIXTURE_A_FILE_ID','BOX_EXPECTED_USER_ID'])if(!/^\d+$/.test(requireEnv(env,name)))throw new ProviderGateError('BOX_TARGET_MISMATCH');
}
export function safeFailure(error:unknown):{code:string} {return {code:error instanceof ProviderGateError?error.code:'PROVIDER_GATE_FAILED'};}
