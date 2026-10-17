import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { assertLiveGate, requireEnv, safeFailure, ProviderGateError } from '../services/providers/gates.js';
import { explainWithStrands } from '../services/providers/strands.js';
import { CONTEXT } from '../packages/contracts/index.js';
import { MODEL } from '../packages/contracts/model.js';
import type { ExplanationContext } from '../services/providers/explanation.js';
export async function main():Promise<void>{
  assertLiveGate('strands');
  const context=JSON.parse(await readFile(requireEnv(process.env,'TALLY_SMOKE_INPUT_PATH'),'utf8')) as ExplanationContext;
  if(context.opportunity?.business_id!==CONTEXT.business_id||context.opportunity?.tax_year!==CONTEXT.tax_year||context.opportunity?.rule_set_id!==CONTEXT.rule_set_id||!Array.isArray(context.facts))throw new ProviderGateError('SMOKE_INPUT_CONTEXT_MISMATCH');
  const receipt=await explainWithStrands(context,{approvedLiveCall:true});
  if(receipt.mode!=='live_bedrock')throw new ProviderGateError(receipt.reason??'P02_FALLBACK');
  console.log(JSON.stringify({gate:'P02',status:'validated',model:MODEL.model_id,region:MODEL.region,attempts:1,usage:receipt.usage,output_fields:Object.keys(receipt.explanation)}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(JSON.stringify({gate:'P02',status:'failed',...safeFailure(error)}));process.exitCode=1;});
