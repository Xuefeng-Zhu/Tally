import {createProductionRuntime} from '../runtime/production.js';
import {DynamoStore} from '../storage/dynamo-store.js';
import {TallyEngine} from './core.js';
import {CONTEXT} from '../../packages/contracts/index.js';
import type {LiveWorkerEnvelope,LiveWorkerResult} from './live-worker.js';
export type SqsEvent={Records:{messageId:string;body:string}[]};
export function createWorkerLambda(options:{env?:NodeJS.ProcessEnv;runtimeFactory?:()=>{worker:{handle:(envelope:LiveWorkerEnvelope)=>Promise<LiveWorkerResult>}}}={}){
 let worker:{handle:(envelope:LiveWorkerEnvelope)=>Promise<LiveWorkerResult>}|undefined;
 return async(event:SqsEvent)=>{
  const env=options.env??process.env,batchItemFailures:{itemIdentifier:string}[]=[];
  for(const record of event.Records){try{
   const envelope=JSON.parse(record.body) as LiveWorkerEnvelope;
   if(!envelope||envelope.business_id!==CONTEXT.business_id||!['INGEST','EVALUATE'].includes(envelope.kind))throw new Error('INVALID_ENVELOPE');
   if(!worker){
    if(options.runtimeFactory){if(env.LIVE_PROVIDERS_ENABLED!=='true'||env.TALLY_APPROVED_LIVE_FLOW!=='true')throw new Error('LIVE_PROVIDER_GATES_PENDING');worker=options.runtimeFactory().worker;}
    else if(env.TALLY_EXECUTION_MODE==='fixture'){
     if(!env.TALLY_TABLE_NAME)throw new Error('RUNTIME_CONFIGURATION_PENDING');const engine=new TallyEngine(new DynamoStore(env.TALLY_TABLE_NAME));
     worker={handle:async()=>{await engine.processAll();return {status:'completed'};}};
    }else worker=createProductionRuntime(env).worker;
   }
   await worker.handle(envelope);
  }catch{batchItemFailures.push({itemIdentifier:record.messageId});}}
  return {batchItemFailures};
 };
}
export const handler=createWorkerLambda();
