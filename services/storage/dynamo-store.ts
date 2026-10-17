import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { CONTEXT, emptyState, type State } from '../../packages/contracts/index.js';
import type { Store } from './store.js';
export type DynamoTransport=(command:GetCommand|PutCommand)=>Promise<{Item?:Record<string,unknown>}>;
export const MAX_STATE_BYTES=300*1024;
function defaultTransport():DynamoTransport {
  const client=DynamoDBDocumentClient.from(new DynamoDBClient({region:'us-east-1',maxAttempts:1}));
  return async command=>{if(command instanceof GetCommand){const result=await client.send(command);return {Item:result.Item};}await client.send(command);return {};};
}
/** One demo-tenant aggregate makes source claims, facts, history and revision advancement atomic.
 * Pure synchronous callbacks may be rerun on conditional conflicts; no provider calls inside them.
 * This bounded hackathon store stops at 300KiB, it never drops history to fit Dynamo's 400KiB limit.
 */
export class DynamoStore implements Store {
  readonly key:{pk:string};
  constructor(private readonly tableName:string,tenantId:string=CONTEXT.business_id,private readonly send:DynamoTransport=defaultTransport()){
    if(!tableName||tenantId!==CONTEXT.business_id)throw new Error('DYNAMO_TARGET_MISMATCH');
    this.key={pk:`TENANT#${tenantId}#STATE`};
  }
  private async snapshot():Promise<{state:State;revision:number|null}>{
    const result=await this.send(new GetCommand({TableName:this.tableName,Key:this.key,ConsistentRead:true}));
    if(!result.Item)return {state:emptyState(),revision:null};
    const {payload,revision}=result.Item;
    if(typeof payload!=='string'||!Number.isSafeInteger(revision)||Number(revision)<1)throw new Error('DYNAMO_STATE_CORRUPT');
    const state=JSON.parse(payload) as State;
    if(!Array.isArray(state.facts)||!Array.isArray(state.documents)||!Array.isArray(state.jobs)||!Array.isArray(state.history))throw new Error('DYNAMO_STATE_CORRUPT');
    return {state,revision:Number(revision)};
  }
  async read():Promise<State>{return structuredClone((await this.snapshot()).state);}
  async transact<T>(fn:(draft:State)=>T):Promise<T>{
    for(let attempt=0;attempt<8;attempt++){
      const snapshot=await this.snapshot(),draft=structuredClone(snapshot.state),result=fn(draft);
      if(result instanceof Promise)throw new Error('Store transaction callbacks must be synchronous');
      const payload=JSON.stringify(draft);
      if(Buffer.byteLength(payload,'utf8')>MAX_STATE_BYTES)throw new Error('DYNAMO_STATE_CAPACITY_EXCEEDED');
      try{
        await this.send(new PutCommand({TableName:this.tableName,Item:{...this.key,payload,revision:(snapshot.revision??0)+1},ConditionExpression:snapshot.revision===null?'attribute_not_exists(pk)':'#revision = :expected',...(snapshot.revision===null?{}:{ExpressionAttributeNames:{'#revision':'revision'},ExpressionAttributeValues:{':expected':snapshot.revision}})}));
        return structuredClone(result);
      }catch(error){if(!(error instanceof Error)||error.name!=='ConditionalCheckFailedException')throw error;}
    }
    throw new Error('DYNAMO_CAS_RETRY_EXHAUSTED');
  }
}
