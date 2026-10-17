import { BoxAdapter, BOX_SMOKE_FIELDS, boxShapeReceipt } from '../services/providers/box.js';
import { assertLiveGate, requireEnv, safeFailure, ProviderGateError } from '../services/providers/gates.js';
import { pathToFileURL } from 'node:url';
export async function main():Promise<void> {
  assertLiveGate('box');
  const adapter=new BoxAdapter(requireEnv(process.env,'BOX_ACCESS_TOKEN'),requireEnv(process.env,'BOX_INPUT_FOLDER_ID'));
  if(await adapter.identity()!==requireEnv(process.env,'BOX_EXPECTED_USER_ID'))throw new ProviderGateError('BOX_IDENTITY_MISMATCH');
  const result=await adapter.extractChecked(requireEnv(process.env,'BOX_FIXTURE_A_FILE_ID'),BOX_SMOKE_FIELDS);
  console.log(JSON.stringify({gate:'P01',status:'observed_shape_requires_review',extract_requests:1,metadata_stable:true,fields:BOX_SMOKE_FIELDS.map(v=>v.key),...boxShapeReceipt(result.extraction)}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(JSON.stringify({gate:'P01',status:'failed',...safeFailure(error)}));process.exitCode=1;});
