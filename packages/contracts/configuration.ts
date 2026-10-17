/** Interim runtime configuration reconstructed from the read build specification. */
import {CONTEXT} from './index.js';
import {MODEL} from './model.js';
export function validateApiOrigin(value:string):URL {
 const url=new URL(value);
 if(url.protocol!=='https:' || !/^[a-z0-9]+\.execute-api\.us-east-1\.amazonaws\.com$/.test(url.hostname) || url.port || url.username || url.password || url.search || url.hash || url.pathname!=='/') throw new Error('TALLY_API_ORIGIN must be one fixed us-east-1 API Gateway HTTPS origin.');
 return url;
}
export function readConfiguration(env:NodeJS.ProcessEnv=process.env){
 const exact:Record<string,string>={TALLY_DEMO_TENANT_ID:CONTEXT.business_id,TALLY_TAX_YEAR:'2025',TALLY_RULE_SET_ID:CONTEXT.rule_set_id,EXTRACTION_SCHEMA_VERSION:CONTEXT.extraction_schema_version,AWS_REGION:MODEL.region,BEDROCK_MODEL_ID:MODEL.model_id,TALLY_EXPLANATION_ADAPTER:'strands'};
 for(const [key,value] of Object.entries(exact))if(env[key]!==undefined&&env[key]!==value)throw new Error(`Unsupported configured ${key}`);
 for(const [key,max] of [['MAX_PDF_BYTES',1048576],['MAX_PDF_PAGES',2]] as const)if(env[key]!==undefined&&(!Number.isSafeInteger(Number(env[key]))||Number(env[key])<1||Number(env[key])>max))throw new Error(`Invalid ${key}`);
 const mode=env.TALLY_EXECUTION_MODE??'fixture';
 if(mode!=='fixture'&&mode!=='aws')throw new Error('TALLY_EXECUTION_MODE must be fixture or aws.');
 const apiOrigin=env.TALLY_API_ORIGIN?validateApiOrigin(env.TALLY_API_ORIGIN).origin:null;
 return {mode,apiOrigin,context:CONTEXT,folderId:env.BOX_INPUT_FOLDER_ID??null,maxPdfBytes:Number(env.MAX_PDF_BYTES??1048576),maxPdfPages:Number(env.MAX_PDF_PAGES??2)};
}
