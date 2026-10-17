import {SQSClient,SendMessageCommand} from '@aws-sdk/client-sqs';
import {createLiveApi,assertApprovedLiveFlow,type ApiBoxReader} from './live-api.js';
import {DynamoStore} from '../storage/dynamo-store.js';
import type {Store} from '../storage/store.js';
import {BoxAdapter} from '../providers/box.js';
import {createBoxSourceProvider} from '../providers/normalize-box.js';
import {normalizeBoxSourceWithLocalText} from '../providers/local-pdf-text.js';
import {SecretProvider,createBoxTokenProvider} from '../providers/secrets.js';
import {LiveWorker,type LiveSourceProvider,type LiveWorkerEnvelope} from '../worker/live-worker.js';
import {createOpenRouterExplainer,OPENROUTER_CONFIG} from '../providers/openrouter.js';
import {createOpenRouterKeySupplier,readOpenRouterPriorSpendUsd} from '../providers/openrouter-key.js';
import type {SecretReader} from '../providers/secrets.js';
import {DomainError,type EngineOptions} from '../worker/core.js';
export type ProductionOverrides={store?:Store;send?:(message:LiveWorkerEnvelope)=>Promise<void>;secrets?:Pick<SecretProvider,'getWebhookKeys'|'getBoxCredentials'>;box?:()=>Promise<ApiBoxReader>;sourceProvider?:LiveSourceProvider;explain?:EngineOptions['explain'];boxAdapterFactory?:(accessToken:string,folderId:string)=>BoxAdapter;openRouterKeyReader?:SecretReader;openRouterFetch?:typeof fetch};
/** Gate first. Construction performs no secret read, OAuth request, Box extraction or OpenRouter call. */
export function createProductionRuntime(env:NodeJS.ProcessEnv=process.env,overrides:ProductionOverrides={}){
 assertApprovedLiveFlow(env);
 const sourceVerification=env.BOX_SOURCE_VERIFICATION??'box_native_reference';
 if(sourceVerification!=='box_native_reference'&&sourceVerification!=='local_pdf_text_match')throw new DomainError('SOURCE_VERIFICATION_CONFIGURATION_INVALID','The source verification method is not supported.',503);
 const normalize=sourceVerification==='local_pdf_text_match'?normalizeBoxSourceWithLocalText:undefined;
 const table=env.TALLY_TABLE_NAME??'',queueUrl=env.TALLY_QUEUE_URL??'';
 if(!/^[A-Za-z0-9_.-]{3,255}$/.test(table)||!/^https:\/\/sqs\.us-east-1\.amazonaws\.com\/\d{12}\/[A-Za-z0-9_-]+$/.test(queueUrl))throw new DomainError('RUNTIME_CONFIGURATION_PENDING','Approved persistence targets are missing.',503);
 const store=overrides.store??new DynamoStore(table);
 const secrets=overrides.secrets??new SecretProvider({env});
 let queue:SQSClient|undefined;
 const send=overrides.send??(async(message:LiveWorkerEnvelope)=>{queue??=new SQSClient({region:'us-east-1',maxAttempts:1});await queue.send(new SendMessageCommand({QueueUrl:queueUrl,MessageBody:JSON.stringify(message)}),{abortSignal:AbortSignal.timeout(10000)});});
 const token=createBoxTokenProvider({secrets,approvedLiveFlow:true});
 let current:{token:string;expectedUserId:string;adapter:BoxAdapter;source:LiveSourceProvider}|undefined;
 async function boxAndSources(){
  const access=await token();
  if(current?.token===access.accessToken&&current.expectedUserId===access.expectedUserId)return current;
  const adapter=overrides.boxAdapterFactory?overrides.boxAdapterFactory(access.accessToken,env.BOX_INPUT_FOLDER_ID!):new BoxAdapter(access.accessToken,env.BOX_INPUT_FOLDER_ID!);
  if(await adapter.identity()!==access.expectedUserId)throw new DomainError('BOX_IDENTITY_MISMATCH','Box identity does not match the approved service account.',503);
  current={token:access.accessToken,expectedUserId:access.expectedUserId,adapter,source:createBoxSourceProvider(adapter,{normalize})};return current;
 }
 const sourceProvider=overrides.sourceProvider??{prepare:async(fileId:string)=>(await boxAndSources()).source.prepare(fileId),extract:async(observation:Parameters<LiveSourceProvider['extract']>[0])=>(await boxAndSources()).source.extract(observation)};
 const api=createLiveApi({store,env,loadKeys:()=>secrets.getWebhookKeys(),send,box:overrides.box??(async()=>(await boxAndSources()).adapter)});
 // One explainer instance is retained by the warm worker runtime: at most two calls and $0.50 reserved there.
 // This process-local guard does not enforce the total project budget across Lambda processes.
 const describe=overrides.explain?undefined:createOpenRouterExplainer({approvedLiveCall:true,env,getApiKey:createOpenRouterKeySupplier({env,reader:overrides.openRouterKeyReader}),priorSpendUsd:readOpenRouterPriorSpendUsd(env,OPENROUTER_CONFIG.budgetUsd),fetcher:overrides.openRouterFetch});
 const explain=overrides.explain??((opportunity,facts)=>describe!({opportunity,facts}));
 return {api,worker:new LiveWorker(store,{sourceProvider,enqueue:send,explain}),store};
}
