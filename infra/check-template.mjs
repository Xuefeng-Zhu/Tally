import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MODEL } from '../packages/contracts/model.ts';

// Offline review checks. This does not invoke AWS or replace a SAM transform/lint.
const template = JSON.parse(await readFile(new URL('./template.yaml', import.meta.url), 'utf8'));
const resources = template.Resources;
const byType = type => Object.values(resources).filter(resource => resource.Type === type);
assert.equal(template.Transform, 'AWS::Serverless-2016-10-31');
assert.equal(template.Globals.Function.Runtime, 'nodejs22.x');
assert.deepEqual(template.Globals.Function.Architectures,['arm64']);
assert.equal(byType('AWS::Serverless::Function').length, 2);
assert.equal(byType('AWS::DynamoDB::Table').length, 1);
assert.equal(byType('AWS::SQS::Queue').length, 2);
assert.equal(byType('AWS::SecretsManager::Secret').length, 0);
assert.equal(template.Parameters.LiveProvidersEnabled.Default, 'false');
assert.equal(template.Parameters.ApprovedLiveFlow.Default, 'false');
assert.equal(template.Parameters.BoxWebhookId.Default, '');
assert.equal(template.Parameters.BoxWebhookId.AllowedPattern, '(|[0-9]+)');
assert.ok(template.Rules.RequireWebhookIdBeforeLive.Assertions.length > 0);
for (const parameter of ['BoxCredentialsSecretArn', 'BoxWebhookSignaturesSecretArn']) {
  assert.equal(template.Parameters[parameter].Default, undefined);
  assert.match(template.Parameters[parameter].AllowedPattern, /secretsmanager:us-east-1/);
}
assert.deepEqual(resources.StateTable.Properties.KeySchema, [{ AttributeName: 'pk', KeyType: 'HASH' }]);
assert.equal(resources.WorkQueue.Properties.VisibilityTimeout, 720);
assert.equal(resources.WorkQueue.Properties.RedrivePolicy.maxReceiveCount, 5);
const worker = resources.WorkerFunction.Properties;
assert.equal(worker.Timeout, 120);
assert.equal(worker.ReservedConcurrentExecutions, undefined);
assert.equal(template.Globals.Function.ReservedConcurrentExecutions, undefined);
assert.equal(worker.Events.Jobs.Properties.BatchSize, 1);
assert.equal(worker.Events.Jobs.Properties.MaximumBatchingWindowInSeconds, 0);
assert.equal(worker.Events.Jobs.Properties.ScalingConfig.MaximumConcurrency, 2);
assert.deepEqual(worker.Events.Jobs.Properties.FunctionResponseTypes, ['ReportBatchItemFailures']);
assert.equal(worker.Environment.Variables.BEDROCK_REGION, 'us-east-1');
assert.deepEqual(worker.Environment.Variables.BEDROCK_MODEL_ID, { Ref: 'BedrockModelId' });
assert.equal(template.Parameters.BedrockModelId.Default, MODEL.model_id);
assert.deepEqual(template.Parameters.BedrockModelId.AllowedValues, [MODEL.model_id]);
assert.equal(template.Parameters.BedrockModelArn, undefined);
assert.equal(MODEL.model_id,'us.openai.gpt-6-luna');
assert.equal(MODEL.region,'us-east-1');
assert.deepEqual(MODEL.destination_regions,['us-east-1','us-east-2','us-west-2']);
assert.deepEqual(resources.TallyHttpApi.Properties.Auth, { EnableIamAuthorizer: true, DefaultAuthorizer: 'AWS_IAM' });
const expectedRoutes = new Map([
  ['GET /api/state', 'AWS_IAM'],
  ['PUT /api/profile', 'AWS_IAM'],
  ['POST /api/demo/analyze', 'AWS_IAM'],
  ['POST /api/demo/reconcile', 'AWS_IAM'],
  ['POST /webhooks/box', 'NONE'],
]);
const events = Object.values(resources.ApiFunction.Properties.Events);
assert.equal(events.length, expectedRoutes.size);
for (const { Type, Properties: route } of events) {
  assert.equal(Type, 'HttpApi');
  assert.equal(expectedRoutes.get(`${route.Method} ${route.Path}`), route.Auth.Authorizer);
  expectedRoutes.delete(`${route.Method} ${route.Path}`);
}
assert.equal(expectedRoutes.size, 0);
for (const name of ['ApiFunction', 'WorkerFunction']) {
  const { Properties: fn, Metadata: metadata } = resources[name];
  assert.equal(fn.VpcConfig, undefined);
  assert.equal(metadata.BuildMethod, 'makefile');
  assert.equal(metadata.BuildArchitecture, 'arm64');
  assert.equal(metadata.BuildProperties, undefined);
  assert.equal(fn.Handler, `services/${name==='ApiFunction'?'api':'worker'}/handler.handler`);
  assert.equal(fn.CodeUri, '../');
  assert.deepEqual(fn.LoggingConfig.LogGroup, { Ref: name === 'ApiFunction' ? 'ApiLogGroup' : 'WorkerLogGroup' });
  assert.deepEqual(fn.Environment.Variables.LIVE_PROVIDERS_ENABLED, { Ref: 'LiveProvidersEnabled' });
}
for (const name of ['ApiRole', 'WorkerRole']) {
  const statements = resources[name].Properties.Policies[0].PolicyDocument.Statement;
  for (const statement of statements) {
    assert.ok(!JSON.stringify(statement.Resource).includes('*'));
    assert.ok(statement.Action.every(action => !action.includes('*')));
    assert.ok(!statement.Action.includes('logs:CreateLogGroup'));
  }
  const state = statements.find(statement => statement.Sid === 'StateCompareAndSwap');
  assert.deepEqual(state.Action, ['dynamodb:GetItem', 'dynamodb:PutItem']);
  assert.deepEqual(state.Resource, { 'Fn::GetAtt': ['StateTable', 'Arn'] });
  assert.deepEqual(state.Condition['ForAllValues:StringEquals']['dynamodb:LeadingKeys'], ['TENANT#demo-bakery-001#STATE']);
}
const apiStatements = resources.ApiRole.Properties.Policies[0].PolicyDocument.Statement;
assert.deepEqual(resources.ApiFunction.Properties.Environment.Variables.BOX_CREDENTIALS_SECRET_ARN, {Ref:'BoxCredentialsSecretArn'});
const apiSecret = apiStatements.filter(statement => statement.Action.includes('secretsmanager:GetSecretValue'));
assert.equal(apiSecret.length, 1);
assert.deepEqual(apiSecret[0].Action, ['secretsmanager:GetSecretValue']);
assert.deepEqual(apiSecret[0].Resource, [{Ref:'BoxCredentialsSecretArn'},{Ref:'BoxWebhookSignaturesSecretArn'}]);
const workerSecrets = resources.WorkerRole.Properties.Policies[0].PolicyDocument.Statement.filter(statement => statement.Action.includes('secretsmanager:GetSecretValue'));
assert.equal(workerSecrets.length, 1);
assert.deepEqual(workerSecrets[0].Action, ['secretsmanager:GetSecretValue']);
assert.deepEqual(workerSecrets[0].Resource, {Ref:'BoxCredentialsSecretArn'});
assert.ok(apiStatements.every(statement => statement.Action.every(action => !action.startsWith('bedrock:'))));
const bedrockStatements=resources.WorkerRole.Properties.Policies[0].PolicyDocument.Statement.filter(statement=>statement.Action.some(action=>action.startsWith('bedrock:')));
assert.equal(bedrockStatements.length,3);
for(const statement of bedrockStatements)assert.deepEqual(statement.Action,['bedrock:InvokeModel']);
const profile=bedrockStatements.find(statement=>statement.Sid==='InvokeExactLunaProfile');
assert.deepEqual(profile.Resource,{'Fn::Sub':MODEL.inference_profile_arn_template});
assert.equal(profile.Condition,undefined);
const project=bedrockStatements.find(statement=>statement.Sid==='InvokeLunaDefaultProject');
assert.deepEqual(project.Resource,{'Fn::Sub':MODEL.default_project_arn_template});
const foundations=bedrockStatements.find(statement=>statement.Sid==='InvokeLunaDestinationsThroughProfile');
assert.deepEqual(foundations.Resource,[...MODEL.foundation_model_arns]);
assert.deepEqual(foundations.Condition,{StringEquals:{'bedrock:InferenceProfileArn':{'Fn::Sub':MODEL.inference_profile_arn_template}}});
assert.ok(bedrockStatements.every(statement=>!JSON.stringify(statement).includes('global.openai')));
const makefile=await readFile(new URL('../Makefile',import.meta.url),'utf8');
for(const name of ['ApiFunction','WorkerFunction'])assert.ok(makefile.includes(`build-${name}:`));
console.log('Offline SAM contract checks passed: exact routes, auth, queue limits, runtime, IAM scopes, existing secrets, and disabled live gate.');
