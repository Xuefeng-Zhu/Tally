import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertApprovedLiveFlow} from '../services/runtime/live-api.js';
import {createProductionRuntime} from '../services/runtime/production.js';
import {MODEL} from '../packages/contracts/model.js';

const template=JSON.parse(readFileSync(new URL('../infra/template.yaml',import.meta.url),'utf8'));
type Parameters=Record<string,string>;
/** Evaluate only the documented parameter-only rule functions used by this template. */
function evaluate(value:unknown,parameters:Parameters):unknown{
 if(value===null||typeof value!=='object')return value;
 const entries=Object.entries(value);assert.equal(entries.length,1,'A rule expression must have one supported function');
 const [name,args]=entries[0];
 if(name==='Ref'){assert.equal(typeof args,'string');assert.ok(Object.hasOwn(parameters,args));return parameters[args];}
 assert.ok(Array.isArray(args));const values=args.map(arg=>evaluate(arg,parameters));
 if(name==='Fn::Equals'){assert.equal(values.length,2);return values[0]===values[1];}
 if(name==='Fn::And')return values.every(value=>value===true);
 if(name==='Fn::Or')return values.some(value=>value===true);
 if(name==='Fn::Not'){assert.equal(values.length,1);return values[0]!==true;}
 throw new Error(`Unsupported rule function ${name}`);
}
function deploymentAccepts(parameters:Parameters):boolean{
 for(const [name,definition] of Object.entries(template.Parameters) as [string,{AllowedPattern?:string;AllowedValues?:string[]}][]){
  const value=parameters[name];if(value===undefined)continue;
  if(definition.AllowedPattern&&!new RegExp(`^(?:${definition.AllowedPattern})$`).test(value))return false;
  if(definition.AllowedValues&&!definition.AllowedValues.includes(value))return false;
 }
 return Object.values(template.Rules).every((rule:any)=>rule.Assertions.every((assertion:any)=>evaluate(assertion.Assert,parameters)===true));
}

test('SAM permits an unbound webhook only while both live gates are disabled',()=>{
 assert.equal(template.Parameters.BoxWebhookId.Default,'');
 for(const live of ['false','true'])for(const flow of ['false','true']){
  const gates={LiveProvidersEnabled:live,ApprovedLiveFlow:flow};
  assert.equal(deploymentAccepts({...gates,BoxWebhookId:''}),live==='false'&&flow==='false',`blank ID: ${live}/${flow}`);
  assert.equal(deploymentAccepts({...gates,BoxWebhookId:'2709900123'}),true,`numeric ID: ${live}/${flow}`);
  for(const invalid of ['placeholder','pending','12abc',' 123','123\n','-1'])assert.equal(deploymentAccepts({...gates,BoxWebhookId:invalid}),false,`invalid ID: ${JSON.stringify(invalid)}`);
 }
});

test('API gets only its two exact secret references; worker keeps credentials only',()=>{
 const resources=template.Resources;
 assert.deepEqual(resources.ApiFunction.Properties.Environment.Variables.BOX_CREDENTIALS_SECRET_ARN,{Ref:'BoxCredentialsSecretArn'});
 for(const [role,expected] of [
  ['ApiRole',[{Ref:'BoxCredentialsSecretArn'},{Ref:'BoxWebhookSignaturesSecretArn'}]],
  ['WorkerRole',{Ref:'BoxCredentialsSecretArn'}],
 ] as const){
  const properties=resources[role].Properties;
  assert.deepEqual(properties.AssumeRolePolicyDocument.Statement,[{Effect:'Allow',Principal:{Service:'lambda.amazonaws.com'},Action:'sts:AssumeRole'}]);
  const secrets=properties.Policies.flatMap((policy:any)=>policy.PolicyDocument.Statement).filter((statement:any)=>statement.Action.some((action:string)=>action.startsWith('secretsmanager:')));
  assert.equal(secrets.length,1);assert.deepEqual(secrets[0].Action,['secretsmanager:GetSecretValue']);assert.deepEqual(secrets[0].Resource,expected);
 }
 assert.equal(Object.values(resources).filter((resource:any)=>resource.Type==='AWS::SecretsManager::Secret').length,0);
});

test('production independently rejects unbound or malformed webhook before touching dependencies',()=>{
 for(const webhook of [undefined,'','pending','12abc',' 123','123\n']){
  let touched=0;
  const env={LIVE_PROVIDERS_ENABLED:'true',TALLY_APPROVED_LIVE_FLOW:'true',BOX_INPUT_FOLDER_ID:'12',BOX_WEBHOOK_ID:webhook};
  assert.throws(()=>assertApprovedLiveFlow(env),(error:any)=>error.code==='RUNTIME_CONFIGURATION_PENDING');
  assert.throws(()=>createProductionRuntime(env,{secrets:{getWebhookKeys:async()=>{touched++;throw new Error('must not read');},getBoxCredentials:async()=>{touched++;throw new Error('must not read');}}}),(error:any)=>error.code==='RUNTIME_CONFIGURATION_PENDING');
  assert.equal(touched,0);
 }
});


test('one SQS source caps normal worker concurrency at2 without an unavailable account reservation',()=>{
 const worker=template.Resources.WorkerFunction.Properties;
 assert.equal(worker.ReservedConcurrentExecutions,undefined);
 assert.equal(template.Globals.Function.ReservedConcurrentExecutions,undefined);
 assert.deepEqual(Object.keys(worker.Events),['Jobs']);
 assert.equal(worker.Events.Jobs.Type,'SQS');
 assert.deepEqual(worker.Events.Jobs.Properties.ScalingConfig,{MaximumConcurrency:2});
 assert.equal(worker.Events.Jobs.Properties.BatchSize,1);
 assert.equal(worker.Events.Jobs.Properties.MaximumBatchingWindowInSeconds,0);
 assert.equal(template.Parameters.LiveProvidersEnabled.Default,'false');
 assert.equal(template.Parameters.ApprovedLiveFlow.Default,'false');
});


test('regional selected model grants only InvokeModel on its one exact foundation model',()=>{
 const exactArn='arn:aws:bedrock:us-east-1::foundation-model/mistral.ministral-3-14b-instruct';
 assert.equal(MODEL.model_id,'mistral.ministral-3-14b-instruct');
 assert.equal(MODEL.foundation_model_id,MODEL.model_id);
 assert.equal(MODEL.inference_type,'in_region');
 assert.deepEqual(MODEL.destination_regions,['us-east-1']);
 assert.deepEqual(MODEL.foundation_model_arns,[exactArn]);
 assert.equal(template.Parameters.BedrockModelId.Default,MODEL.model_id);
 assert.deepEqual(template.Parameters.BedrockModelId.AllowedValues,[MODEL.model_id]);
 const modelStatements=(role:string)=>template.Resources[role].Properties.Policies.flatMap((policy:any)=>policy.PolicyDocument.Statement).filter((statement:any)=>statement.Action.some((action:string)=>action.startsWith('bedrock:')||action.startsWith('aws-marketplace:')));
 assert.deepEqual(modelStatements('ApiRole'),[]);
 assert.deepEqual(modelStatements('WorkerRole'),[{Sid:'InvokeExactMinistral14B',Effect:'Allow',Action:['bedrock:InvokeModel'],Resource:exactArn}]);
 assert.deepEqual(template.Resources.WorkerFunction.Properties.Environment.Variables.BEDROCK_MODEL_ID,{Ref:'BedrockModelId'});
 assert.equal(template.Parameters.LiveProvidersEnabled.Default,'false');
 assert.equal(template.Parameters.ApprovedLiveFlow.Default,'false');
});
