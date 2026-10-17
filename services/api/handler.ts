import {randomUUID} from 'node:crypto';
import {SQSClient,SendMessageCommand} from '@aws-sdk/client-sqs';
import {DynamoStore} from '../storage/dynamo-store.js';
import {TallyEngine} from '../worker/core.js';
import {createApi,type Request,type Response} from './app.js';
import {readConfiguration} from '../../packages/contracts/configuration.js';
import {createProductionRuntime} from '../runtime/production.js';
export type ApiEvent={requestContext?:{http?:{method:string}};rawPath:string;rawQueryString?:string;headers?:Record<string,string>;body?:string;isBase64Encoded?:boolean};
export function createApiLambda(options:{env?:NodeJS.ProcessEnv;runtimeFactory?:()=>{api:(request:Request)=>Promise<Response>}}={}){
 let api:((request:Request)=>Promise<Response>)|undefined;
 return async(event:ApiEvent)=>{
  const correlation_id=randomUUID(),env=options.env??process.env;
  const respond=(statusCode:number,body:unknown)=>({statusCode,headers:{'content-type':'application/json','cache-control':'no-store'},body:JSON.stringify(body)});
  if(event.rawQueryString)return respond(422,{code:'INVALID_REQUEST',message:'Selectors are not accepted.',retryable:false,correlation_id});
  try{
   if(!api){
    if(options.runtimeFactory){if(env.LIVE_PROVIDERS_ENABLED!=='true'||env.TALLY_APPROVED_LIVE_FLOW!=='true')throw new Error('LIVE_PROVIDER_GATES_PENDING');api=options.runtimeFactory().api;}
    else if(env.TALLY_EXECUTION_MODE==='fixture'){
     const config=readConfiguration(env);if(!env.TALLY_TABLE_NAME||!env.TALLY_QUEUE_URL)throw new Error('RUNTIME_CONFIGURATION_PENDING');
     const engine=new TallyEngine(new DynamoStore(env.TALLY_TABLE_NAME));const queue=new SQSClient({region:'us-east-1',maxAttempts:1});
     api=createApi({engine,enqueue:async()=>{await queue.send(new SendMessageCommand({QueueUrl:env.TALLY_QUEUE_URL,MessageBody:JSON.stringify({kind:'EVALUATE',business_id:config.context.business_id})}));}});
    }else api=createProductionRuntime(env).api;
   }
   const raw=event.body?Buffer.from(event.body,event.isBase64Encoded?'base64':'utf8'):Buffer.alloc(0);
   const result=await api({method:event.requestContext?.http?.method??'GET',path:event.rawPath,headers:event.headers,rawBody:raw});return respond(result.status,result.body);
  }catch{return respond(503,{code:'RUNTIME_UNAVAILABLE',message:'The approved runtime configuration or provider gates are unavailable.',retryable:true,correlation_id});}
 };
}
export const handler=createApiLambda();
