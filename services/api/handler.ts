/** Reviewable Lambda boundary. Live provider workflow remains gated; no fixture result is labeled live. */
import {randomUUID} from 'node:crypto';
import {SQSClient,SendMessageCommand} from '@aws-sdk/client-sqs';
import {DynamoStore} from '../storage/dynamo-store.js';
import {TallyEngine} from '../worker/core.js';
import {createApi} from './app.js';
import {readConfiguration} from '../../packages/contracts/configuration.js';
type Event={requestContext?:{http?:{method:string}};rawPath:string;rawQueryString?:string;headers?:Record<string,string>;body?:string;isBase64Encoded?:boolean};
export async function handler(event:Event){
 const correlation_id=randomUUID();
 const respond=(statusCode:number,body:unknown)=>({statusCode,headers:{'content-type':'application/json','cache-control':'no-store'},body:JSON.stringify(body)});
 // An approved deployment must explicitly select fixture mode or wire reviewed live source handling after P01/P02.
 if(process.env.TALLY_EXECUTION_MODE!=='fixture')return respond(503,{code:'LIVE_PROVIDER_GATES_PENDING',message:'The live provider workflow has not passed its required gates.',retryable:false,correlation_id});
 if(event.rawQueryString)return respond(422,{code:'INVALID_REQUEST',message:'Selectors are not accepted.',retryable:false,correlation_id});
 const config=readConfiguration();
 if(!process.env.TALLY_TABLE_NAME||!process.env.TALLY_QUEUE_URL)return respond(503,{code:'RUNTIME_CONFIGURATION_PENDING',message:'Runtime configuration is incomplete.',retryable:false,correlation_id});
 const engine=new TallyEngine(new DynamoStore(process.env.TALLY_TABLE_NAME));
 const queue=new SQSClient({region:'us-east-1',maxAttempts:1});
 const api=createApi({engine,enqueue:async()=>{await queue.send(new SendMessageCommand({QueueUrl:process.env.TALLY_QUEUE_URL,MessageBody:JSON.stringify({kind:'EVALUATE_PENDING',business_id:config.context.business_id})}));}});
 const raw=event.body?Buffer.from(event.body,event.isBase64Encoded?'base64':'utf8'):Buffer.alloc(0);
 const result=await api({method:event.requestContext?.http?.method??'GET',path:event.rawPath,headers:event.headers,rawBody:raw});
 return respond(result.status,result.body);
}
