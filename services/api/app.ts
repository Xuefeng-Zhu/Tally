import { randomUUID } from 'node:crypto';
import {validateProfile,plainObject} from '../../packages/contracts/validation.js';
import type {State} from '../../packages/contracts/index.js';
import {TallyEngine,DomainError} from '../worker/core.js';
import {verifyBoxSignature,parseBoxUploadEvent} from './box-signature.js';
export type Request = {method:string;path:string;headers?:Record<string,string|undefined>;rawBody?:Buffer|string};
export type Response = {status:number;body:unknown};
export type ApiIntake = {analyze:(fileIds?:string[])=>Promise<void>;webhook:(fileId:string,eventId:string)=>Promise<void>};
export type ApiOptions = {engine:TallyEngine;enqueue:()=>Promise<void>;intake?:ApiIntake;decorateState?:(state:State)=>State;webhook?:({primaryKey:string;secondaryKey?:string}|{loadKeys:()=>Promise<{primaryKey:string;secondaryKey?:string}>})&{webhookId:string;folderId:string}};
export function createApi({engine,enqueue,webhook,intake,decorateState}:ApiOptions) {
 return async (req:Request):Promise<Response>=>{
  const correlation_id=randomUUID();
  const error=(status:number,code:string,message:string,retryable=false,extra={})=>({status,body:{code,message,correlation_id,retryable,...extra}});
  const state=async()=>{const current=await engine.state();return decorateState?decorateState(current):current;};
  const raw=req.rawBody??'';
  if(Buffer.byteLength(raw)>32_768) return error(413,'REQUEST_TOO_LARGE','Request body is too large.');
  try {
   if(req.path==='/webhooks/box' && req.method==='POST') {
    if(!webhook)return error(403,'INVALID_BOX_SIGNATURE','Webhook signature or timestamp is invalid.');
    let keys:{primaryKey:string;secondaryKey?:string};
    try{keys='loadKeys' in webhook?await webhook.loadKeys():webhook;}catch{return error(503,'WEBHOOK_CONFIGURATION_UNAVAILABLE','Webhook verification is unavailable.',true);}
    if(!verifyBoxSignature(raw,req.headers??{},keys)) return error(403,'INVALID_BOX_SIGNATURE','Webhook signature or timestamp is invalid.');
    let event;try {JSON.parse(raw.toString());event=parseBoxUploadEvent(raw,{webhookId:webhook.webhookId,folderId:webhook.folderId});}catch{return error(400,'MALFORMED_WEBHOOK','Webhook JSON is malformed.');}
    if(!event) return {status:200,body:{ignored:true}};
    // Durable enqueue is supplied by the runtime. No provider runs in acknowledgment.
    try{if(intake)await intake.webhook(event.fileId,event.eventId);else{await engine.analyze([event.fileId]);await enqueue();}}catch{return error(503,'QUEUE_UNAVAILABLE','The event was not durably queued.',true);}
    return {status:202,body:{queued:true,correlation_id}};
   }
   if(req.path==='/api/state' && req.method==='GET') return {status:200,body:await state()};
   let body:unknown={};
   try {body=Buffer.byteLength(raw)?JSON.parse(raw.toString()):{};} catch {return error(400,'INVALID_JSON','Send a valid JSON request.');}
   if(!plainObject(body)) return error(422,'INVALID_REQUEST','Expected a JSON object.');
   if(req.path==='/api/profile' && req.method==='PUT') {
    if(Object.keys(body).some(k=>!['expected_profile_rev','profile'].includes(k)) || !Number.isSafeInteger(body.expected_profile_rev) || Number(body.expected_profile_rev)<0) return error(422,'INVALID_PROFILE','Profile revision and fields are invalid.');
    let profile;try{profile=validateProfile(body.profile);}catch(e){return error(422,'INVALID_PROFILE',e instanceof Error?e.message:'Profile is invalid.');}
    const before=await engine.state();
    const result=await engine.saveProfile(profile,Number(body.expected_profile_rev));
    try{await enqueue();}catch{return error(503,'PROFILE_SAVED_EVALUATION_PENDING','Profile saved; evaluation is pending. Use reconcile to retry.',true,{profile_saved:true});}
    return {status:before.profile===null?201:200,body:decorateState?decorateState(result):result};
   }
   if(req.path==='/api/demo/analyze' && req.method==='POST') {
    if(Object.keys(body).some(k=>k!=='file_ids') || (body.file_ids!==undefined && (!Array.isArray(body.file_ids) || body.file_ids.length<1 || body.file_ids.length>2 || body.file_ids.some(x=>typeof x!=='string')))) return error(422,'INVALID_FILE_IDS','Analyze accepts one or two file IDs, or an empty object.');
    if(intake){if(!(await engine.state()).profile)throw new DomainError('PROFILE_REQUIRED','Save the business profile before analyzing documents.',409);await intake.analyze(body.file_ids as string[]|undefined);return {status:202,body:await state()};}
    const result=await engine.analyze(body.file_ids as string[]|undefined ?? ['fixture-A','fixture-B']);
    try{await enqueue();}catch{return error(503,'QUEUE_UNAVAILABLE','Work remains pending. Retry Analyze or Reconcile.',true);}
    return {status:202,body:decorateState?decorateState(result):result};
   }
   if(req.path==='/api/demo/reconcile' && req.method==='POST') {
    if(Object.keys(body).length) return error(422,'INVALID_REQUEST','Reconcile expects an empty object.');
    const before=await engine.state();
    const result=await engine.reconcile();
    try{await enqueue();}catch{return error(503,'QUEUE_UNAVAILABLE','Evaluation remains pending. Retry Reconcile.',true);}
    return {status:before.pending_evaluation?202:200,body:decorateState?decorateState(result):result};
   }
   return error(404,'NOT_FOUND','Route is not available.');
  } catch(e) {
   if(e instanceof DomainError) return error(e.status,e.code,e.message,e.retryable,e.profile_saved?{profile_saved:true}:{});
   return error(500,'INTERNAL_ERROR','The request could not be completed.',true);
  }
 };
}
