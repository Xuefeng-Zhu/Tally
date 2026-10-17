import { CONTEXT, type SourceInput } from '../../packages/contracts/index.js';
import { DomainError, TallyEngine, ingestFailure, type EngineOptions } from './core.js';
import type { Store } from '../storage/store.js';

export type LiveWorkerEnvelope =
  | { kind:'INGEST';business_id:string;file_id:string;event_id?:string;intake_mode:'manual'|'webhook' }
  | { kind:'EVALUATE';business_id:string };
export type LiveSourceProvider = {
  /** Metadata, bounded PDF download, local pages and content hash; never calls AI. */
  prepare(fileId:string):Promise<SourceInput>;
  /** AI extraction and validation against the prepared immutable observation. */
  extract(observation:SourceInput):Promise<SourceInput>;
};
export type LiveWorkerOptions = {
  sourceProvider:LiveSourceProvider;
  enqueue:(message:LiveWorkerEnvelope)=>Promise<void>;
  explain?:EngineOptions['explain'];
  maxIngestAttempts?:number;
};
export type LiveWorkerResult={status:'completed'|'duplicate'|'needs_review';code?:string};

/** Injectable orchestration only. Runtime constructs approved provider clients behind its gates. */
export class LiveWorker {
  constructor(readonly store:Store,readonly options:LiveWorkerOptions){}
  private async enqueue(message:LiveWorkerEnvelope):Promise<void>{
    try{await this.options.enqueue(message);}
    catch{throw new DomainError('QUEUE_HANDOFF_FAILED','Durable work is pending; queue delivery must be retried.',503,true);}
  }
  private engine(intakeMode:'manual'|'webhook'='manual'):TallyEngine{
    return new TallyEngine(this.store,{
      resolveSource:fileId=>this.options.sourceProvider.prepare(fileId),
      extractSource:observation=>this.options.sourceProvider.extract(observation),
      explain:this.options.explain,
      maxIngestAttempts:this.options.maxIngestAttempts,
      extractionMode:'live_box_ai',intakeMode,
      afterLedgerCommit:async()=>this.enqueue({kind:'EVALUATE',business_id:CONTEXT.business_id}),
    });
  }
  async handle(envelope:LiveWorkerEnvelope):Promise<LiveWorkerResult>{
    if(!envelope || envelope.business_id!==CONTEXT.business_id)throw new DomainError('TENANT_MISMATCH','This queue message does not target the configured business.',403);
    if(envelope.kind==='EVALUATE'){
      const result=await this.engine().processEvaluation();
      if(result==='busy')throw new DomainError('EVALUATION_LEASE_ACTIVE','Another worker owns this evaluation.',503,true);
      if(result==='stale')await this.enqueue({kind:'EVALUATE',business_id:CONTEXT.business_id});
      return {status:result==='duplicate'?'duplicate':'completed'};
    }
    if(envelope.kind!=='INGEST' || !/^\d+$/.test(envelope.file_id) || !['manual','webhook'].includes(envelope.intake_mode))throw new DomainError('INVALID_WORKER_ENVELOPE','The queued source request is invalid.',422);
    const engine=this.engine(envelope.intake_mode);
    let observation:SourceInput;
    try{observation=await this.options.sourceProvider.prepare(envelope.file_id);}
    catch(error){
      const failure=ingestFailure(error);
      if(failure.retryable)throw new DomainError(failure.code,'Source preparation is temporarily unavailable.',503,true);
      // The failed source may have changed before a new immutable version could be observed.
      await engine.failPreparation(envelope.file_id,failure.code);
      return {status:'needs_review',code:failure.code};
    }
    if(observation.file_id!==envelope.file_id || observation.facts.length!==0)throw new DomainError('INVALID_SOURCE_PREPARATION','Preparation must return this file observation without extracted facts.',422);
    await engine.observeSource(observation);
    const result=await engine.processIngest(envelope.file_id);
    if(result.status==='busy')throw new DomainError('INGEST_LEASE_ACTIVE','Another worker owns this document extraction.',503,true);
    if(result.status==='source_changed'){
      // The fresh observation is durable before the old delivery is acknowledged.
      await this.enqueue({...envelope,event_id:undefined});
      return {status:'completed',code:'SOURCE_CHANGED_REQUEUED'};
    }
    return {status:result.status==='committed'?'completed':result.status,...(result.code?{code:result.code}:{})};
  }
}
