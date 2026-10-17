import { BoxAdapter, BOX_SMOKE_FIELDS, boxShapeReceipt, sameBoxVersion } from '../services/providers/box.js';
import { assertLiveGate, requireEnv, safeFailure, ProviderGateError } from '../services/providers/gates.js';
import { pathToFileURL } from 'node:url';
import { prepareBoxSource } from '../services/providers/normalize-box.js';
export async function main():Promise<void> {
  assertLiveGate('box');
  const adapter=new BoxAdapter(requireEnv(process.env,'BOX_ACCESS_TOKEN'),requireEnv(process.env,'BOX_INPUT_FOLDER_ID'));
  if(await adapter.identity()!==requireEnv(process.env,'BOX_EXPECTED_USER_ID'))throw new ProviderGateError('BOX_IDENTITY_MISMATCH');
  const fileId=requireEnv(process.env,'BOX_FIXTURE_A_FILE_ID');
  const prepared=await prepareBoxSource(adapter,fileId);
  if(!sameBoxVersion(prepared.metadata,await adapter.metadata(fileId)))throw new ProviderGateError('BOX_FILE_CHANGED_DURING_PREPARATION');
  const result=await adapter.extractChecked(fileId,BOX_SMOKE_FIELDS);
  if(!sameBoxVersion(prepared.metadata,result.metadata))throw new ProviderGateError('BOX_FILE_CHANGED_DURING_EXTRACTION');
  console.log(JSON.stringify({gate:'P01',status:'observed_shape_requires_review',extract_requests:1,metadata_stable:true,parsed_pdf:true,page_count:prepared.pdf.pageCount,fields:BOX_SMOKE_FIELDS.map(v=>v.key),...boxShapeReceipt(result.extraction)}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(JSON.stringify({gate:'P01',status:'failed',...safeFailure(error)}));process.exitCode=1;});
