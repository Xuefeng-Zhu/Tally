import {createHash} from 'node:crypto';
import {CONTEXT,type State} from '../../packages/contracts/index.js';
import {readConfiguration} from '../../packages/contracts/configuration.js';
import {createApi,type ApiOptions} from '../api/app.js';
import {DomainError,TallyEngine} from '../worker/core.js';
import type {Store} from '../storage/store.js';
import type {BoxMetadata} from '../providers/box.js';
import type {WebhookKeys} from '../providers/secrets.js';
import type {LiveWorkerEnvelope} from '../worker/live-worker.js';
export type ApiBoxReader={metadata:(fileId:string)=>Promise<BoxMetadata>;listInbox:(maxFiles?:number,maxPages?:number)=>Promise<string[]>};
export type LiveApiDependencies={store:Store;env:NodeJS.ProcessEnv;loadKeys:()=>Promise<WebhookKeys>;send:(message:LiveWorkerEnvelope)=>Promise<void>;box:()=>Promise<ApiBoxReader>};
export function assertApprovedLiveFlow(env:NodeJS.ProcessEnv):void{
 if(env.LIVE_PROVIDERS_ENABLED!=='true'||env.TALLY_APPROVED_LIVE_FLOW!=='true')throw new DomainError('LIVE_PROVIDER_GATES_PENDING','The live flow requires explicit approval and successful provider gates.',503);
 readConfiguration(env);
 if(!/^\d+$/.test(env.BOX_INPUT_FOLDER_ID??'')||!/^\d+$/.test(env.BOX_WEBHOOK_ID??''))throw new DomainError('RUNTIME_CONFIGURATION_PENDING','The approved Box targets are missing.',503);
}
/** No provider/secret client is touched during construction. Dependencies are lazy and injected in tests. */
export function createLiveApi(deps:LiveApiDependencies){
 const {store,env}=deps;assertApprovedLiveFlow(env);
 const folder=env.BOX_INPUT_FOLDER_ID!;const uploadUrl=`https://app.box.com/folder/${folder}`;
 const engine=new TallyEngine(store,{uploadUrl});
 const decorateState=(state:State):State=>({...state,upload_url:uploadUrl,execution:{...state.execution,intake_mode:state.execution.intake_mode==='webhook'?'webhook':'manual'}});
 const send=async(message:LiveWorkerEnvelope)=>{try{await deps.send(message);}catch{throw new DomainError('QUEUE_UNAVAILABLE','Work remains pending; retry Analyze or Reconcile.',503,true);}};
 async function enqueueFiles(items:{fileId:string;version?:string}[],intakeMode:'manual'|'webhook',eventId?:string){
  for(const item of items)if(!/^\d+$/.test(item.fileId))throw new DomainError('UNSUPPORTED_DOCUMENT','A real Box file ID is required.',422);
  await store.transact(state=>{
   for(const item of items){const identity=createHash('sha256').update(`${intakeMode}:${eventId??item.fileId+':'+(item.version??'current')}`).digest('hex');const job_id=`INTAKE:${CONTEXT.business_id}:${identity}`;
    const existing=state.jobs.find(job=>job.job_id===job_id);
    if(!existing)state.jobs.push({job_id,kind:'INGEST',file_id:item.fileId,file_version_id:null,status:'queued',attempts:0,lease_until:null,error:null,committed:false});
    else if(intakeMode==='manual'&&['needs_review','failed'].includes(existing.status)){existing.status='queued';existing.error=null;existing.committed=false;}
   }
   state.execution.intake_mode=intakeMode;
  });
  // All batch intentions survive before the first SQS send. Reconcile can repair any partial enqueue.
  for(const item of items)await send({kind:'INGEST',business_id:CONTEXT.business_id,file_id:item.fileId,intake_mode:intakeMode,...(eventId?{event_id:eventId}:{})});
 }
 const options:ApiOptions={engine,decorateState,webhook:{webhookId:env.BOX_WEBHOOK_ID!,folderId:folder,loadKeys:deps.loadKeys},
  enqueue:async()=>{const state=await store.read();const pending=[...new Set(state.jobs.filter(job=>job.kind==='INGEST'&&job.file_version_id===null&&!job.committed&&job.status==='queued'&&job.file_id).map(job=>job.file_id!))];for(const fileId of pending)await send({kind:'INGEST',business_id:CONTEXT.business_id,file_id:fileId,intake_mode:state.execution.intake_mode==='webhook'?'webhook':'manual'});if(state.pending_evaluation)await send({kind:'EVALUATE',business_id:CONTEXT.business_id});},
  intake:{webhook:(fileId,eventId)=>enqueueFiles([{fileId}],'webhook',eventId),analyze:async(fileIds)=>{
   const box=await deps.box();const ids=fileIds??await box.listInbox(2,3);
   if(!ids.length||ids.length>2||new Set(ids).size!==ids.length)throw new DomainError('UNSUPPORTED_DOCUMENT','No supported direct inbox documents were found.',422);
   const metadata:BoxMetadata[]=[];
   for(const id of ids){try{metadata.push(await box.metadata(id));}catch(error){const code=error instanceof Error?error.message:'';if(/429|5\d\d|TIMEOUT|Abort/.test(code))throw new DomainError('PROVIDER_UNAVAILABLE','Box preflight is temporarily unavailable.',503,true);if(/FOLDER|403|404/.test(code))throw new DomainError('OUTSIDE_FOLDER','The document is outside the designated inbox or unavailable.',403);throw new DomainError('UNSUPPORTED_DOCUMENT','The document is unsupported or unavailable.',422);}}
   if(metadata.some(item=>item.parent.id!==folder))throw new DomainError('OUTSIDE_FOLDER','The document is outside the designated inbox.',403);
   await enqueueFiles(metadata.map(item=>({fileId:item.id,version:item.file_version.id})),'manual');
  }}
 };
 return createApi(options);
}
