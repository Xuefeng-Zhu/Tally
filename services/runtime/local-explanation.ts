import {readConfiguration} from '../../packages/contracts/configuration.js';
import {createOpenRouterExplainer, OPENROUTER_CONFIG} from '../providers/openrouter.js';
import {createOpenRouterKeySupplier} from '../providers/openrouter-key.js';
import type {EngineOptions} from '../worker/core.js';

/** Optional real inference for the built-in synthetic fixture flow. Default construction stays offline. */
export function localExplanationOptions(env:NodeJS.ProcessEnv=process.env,dependencies:{fetcher?:typeof fetch;getApiKey?:()=>Promise<string>}={}):EngineOptions {
  const config=readConfiguration(env);
  if(env.TALLY_OPENROUTER_ENABLED!=='true')return {};
  if(config.mode!=='fixture')throw new Error('LOCAL_OPENROUTER_REQUIRES_SYNTHETIC_FIXTURE_MODE');
  const raw=env.OPENROUTER_PRIOR_SPEND_USD??'0';
  if(!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw)||!Number.isFinite(Number(raw))||Number(raw)>OPENROUTER_CONFIG.budgetUsd)throw new Error('OPENROUTER_PRIOR_SPEND_INVALID');
  const explain=createOpenRouterExplainer({approvedLiveCall:true,env,getApiKey:dependencies.getApiKey??createOpenRouterKeySupplier({env}),fetcher:dependencies.fetcher,priorSpendUsd:Number(raw)});
  return {explain:(opportunity,facts)=>explain({opportunity,facts})};
}
