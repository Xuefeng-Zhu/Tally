import {SignatureV4} from '@smithy/signature-v4';
import {Sha256} from '@aws-crypto/sha256-js';
import {defaultProvider} from '@aws-sdk/credential-provider-node';
import {validateApiOrigin} from '../../packages/contracts/configuration.js';
const routes=new Set(['GET /api/state','PUT /api/profile','POST /api/demo/analyze','POST /api/demo/reconcile']);
export type Signer={sign:(request:{method:string;protocol:string;hostname:string;path:string;headers:Record<string,string>;body:string})=>Promise<{headers:Record<string,string>}>};
/** Only explicit live-flow approval activates forwarding. Fixture execution never calls this path. */
export function createAwsForwarder(options:{apiOrigin:string;approvedLiveFlow:boolean;signer?:Signer;fetcher?:typeof fetch}){
 const url=validateApiOrigin(options.apiOrigin);
 return async(method:string,path:string,body:string)=>{
  if(!options.approvedLiveFlow)throw new Error('Live application flow requires explicit approval.');
  if(!routes.has(`${method} ${path}`)||body.length>32768)throw new Error('Route is not allowlisted.');
  const signer=options.signer??new SignatureV4({service:'execute-api',region:'us-east-1',credentials:defaultProvider(),sha256:Sha256});
  const headers=(await signer.sign({method,protocol:'https:',hostname:url.hostname,path,headers:{host:url.hostname,'content-type':'application/json'},body})).headers;
  const response=await(options.fetcher??fetch)(`${url.origin}${path}`,{method,headers,...(method==='GET'?{}:{body}),redirect:'error',signal:AbortSignal.timeout(20000)});
  const text=await response.text();if(text.length>1048576)throw new Error('Upstream response exceeded the configured limit.');
  return {status:response.status,body:JSON.parse(text)};
 };
}
