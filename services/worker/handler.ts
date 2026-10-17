import {DynamoStore} from '../storage/dynamo-store.js';
import {TallyEngine} from './core.js';
import {readConfiguration} from '../../packages/contracts/configuration.js';
type Event={Records:{messageId:string;body:string}[]};
/** SQS envelope is a wake-up; authoritative pending jobs and guards live in persistence. */
export async function handler(event:Event){
 if(process.env.TALLY_EXECUTION_MODE!=='fixture')throw new Error('LIVE_PROVIDER_GATES_PENDING');
 const config=readConfiguration();if(!process.env.TALLY_TABLE_NAME)throw new Error('TALLY_TABLE_NAME_REQUIRED');
 const engine=new TallyEngine(new DynamoStore(process.env.TALLY_TABLE_NAME));
 const batchItemFailures:{itemIdentifier:string}[]=[];
 for(const record of event.Records){try{const message=JSON.parse(record.body);if(message.business_id!==config.context.business_id)throw new Error('TENANT_MISMATCH');await engine.processAll();}catch{batchItemFailures.push({itemIdentifier:record.messageId});}}
 return {batchItemFailures};
}
