import {AwsSecretReader,validateSecretArn,type SecretReader} from './secrets.js';
import {ProviderGateError} from './gates.js';

const fail=(code:string):never=>{throw new ProviderGateError(code);};
function key(value:unknown):string{
 if(typeof value!=='string'||!value||value.length>4096||!/^[\x21-\x7e]+$/.test(value))return fail('OPENROUTER_API_KEY_INVALID');
 return value;
}
function parse(raw:string):string{
 if(typeof raw!=='string'||Buffer.byteLength(raw,'utf8')>16384)return fail('OPENROUTER_SECRET_INVALID');
 let value:unknown;try{value=JSON.parse(raw);}catch{return fail('OPENROUTER_SECRET_INVALID');}
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==1||!Object.hasOwn(value,'api_key'))return fail('OPENROUTER_SECRET_INVALID');
 return key((value as {api_key:unknown}).api_key);
}
/** Inert supplier. No file lookup or secret request occurs until the returned function is invoked. */
export function createOpenRouterKeySupplier(options:{env?:NodeJS.ProcessEnv;reader?:SecretReader;now?:()=>number}={}):()=>Promise<string>{
 const env=options.env??process.env,now=options.now??Date.now;
 let reader=options.reader,cached:{arn:string;key:string;expiresAt:number}|undefined,pending:{arn:string;work:Promise<string>}|undefined;
 return async()=>{
  // An explicitly configured environment key never falls back to another credential source on error.
  if(env.OPENROUTER_API_KEY!==undefined)return key(env.OPENROUTER_API_KEY);
  if(!env.OPENROUTER_CREDENTIALS_SECRET_ARN)return fail('OPENROUTER_API_KEY_REQUIRED');
  let arn:string;try{arn=validateSecretArn(env.OPENROUTER_CREDENTIALS_SECRET_ARN);}catch{return fail('OPENROUTER_SECRET_ARN_INVALID');}
  if(cached?.arn===arn&&cached.expiresAt>now())return cached.key;
  if(pending?.arn===arn)return pending.work;
  cached=undefined;
  const work=(async()=>{let raw:string;try{reader??=new AwsSecretReader();raw=await reader.read(arn);}catch{return fail('OPENROUTER_SECRET_READ_FAILED');}const value=parse(raw);cached={arn,key:value,expiresAt:now()+30_000};return value;})();
  pending={arn,work};try{return await work;}finally{if(pending?.work===work)pending=undefined;}
 };
}
/** This is the adapter's local reservation ledger, not a project-wide or durable cloud budget. */
export function readOpenRouterPriorSpendUsd(env:NodeJS.ProcessEnv,budgetUsd:number):number{
 const raw=env.OPENROUTER_PRIOR_SPEND_USD;if(raw===undefined)return 0;
 if(!Number.isFinite(budgetUsd)||budgetUsd<0||! /^(?:0|0\.\d{1,12})$/.test(raw))return fail('OPENROUTER_PRIOR_SPEND_INVALID');
 const amount=Number(raw);if(!Number.isFinite(amount)||amount>budgetUsd)return fail('OPENROUTER_PRIOR_SPEND_INVALID');return amount;
}
