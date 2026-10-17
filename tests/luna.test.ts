import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CONTEXT, type Explanation } from '../packages/contracts/index.js';
import { MODEL } from '../packages/contracts/model.js';
import { deterministicExplanation, parseCompleteExplanation, type ExplanationContext } from '../services/providers/explanation.js';
import { BEDROCK_CONFIG, EXPLANATION_JSON_SCHEMA, createStrandsInvoker, explainWithStrands, type StrandsResult } from '../services/providers/strands.js';

const context=JSON.parse(readFileSync(new URL('../fixtures/interim/strands-smoke-input.json',import.meta.url),'utf8')) as ExplanationContext;
const env={TALLY_DEMO_TENANT_ID:CONTEXT.business_id,TALLY_TAX_YEAR:'2025',TALLY_RULE_SET_ID:CONTEXT.rule_set_id,AWS_REGION:MODEL.region,BEDROCK_MODEL_ID:MODEL.model_id,TALLY_EXPLANATION_ADAPTER:'strands'};
const explanation:Explanation={summary:'Coverage evidence was recorded. Annual requirements remain unresolved.',what_changed:'Evidence was re-evaluated.',fact_ids:context.opportunity.fact_ids.slice(0,1),rule_ids:['annual_fte']};
const validText=JSON.stringify(explanation);
const usage={inputTokens:80,outputTokens:35,totalTokens:115};
type CapturedRequest={method:string;hostname:string;path:string;body:Record<string,unknown>};
type MockResponse={output:{message:{role:string;content:Record<string,unknown>[]}};stopReason:string;usage?:typeof usage;metrics:{latencyMs:number}};
function response(content:Record<string,unknown>[]=[{text:validText}],stopReason='end_turn'):MockResponse {
  return {output:{message:{role:'assistant',content}},stopReason,usage:{...usage},metrics:{latencyMs:2}};
}
function mockedSdk(payload:MockResponse) {
  const requests:CapturedRequest[]=[];
  const invoke=createStrandsInvoker({
    // Explicit, nonfunctional test credentials prevent all ambient credential lookup.
    credentials:{accessKeyId:'OFFLINE_TEST_ACCESS_KEY',secretAccessKey:'OFFLINE_TEST_SECRET'},
    requestHandler:{
      async handle(request:{method:string;hostname:string;path:string;body?:unknown}) {
        requests.push({method:request.method,hostname:request.hostname,path:request.path,body:JSON.parse(typeof request.body==='string'?request.body:Buffer.from(request.body as Uint8Array).toString('utf8')) as Record<string,unknown>});
        assert.equal(request.path,'/model/us.openai.gpt-6-luna/converse','unexpected AWS operation (including CountTokens or streaming)');
        return {response:{statusCode:200,headers:{'content-type':'application/json'},body:Buffer.from(JSON.stringify(payload))}};
      }
    }
  });
  return {invoke,requests};
}
async function receiptFor(payload:MockResponse) {
  const mock=mockedSdk(payload);
  const receipt=await explainWithStrands(context,{approvedLiveCall:true,env,invoke:mock.invoke});
  assert.equal(mock.requests.length,1,'one provider attempt with no token-count, tool, repair, or retry request');
  return {receipt,requests:mock.requests};
}

test('Luna uses the pinned Strands Agent and AWS serializer for one strict non-streaming Converse request',async()=>{
  const mock=mockedSdk(response());
  const result=await mock.invoke('Describe only the supplied deterministic evidence.',AbortSignal.timeout(2_000));
  assert.equal(mock.requests.length,1);
  const request=mock.requests[0]!;
  assert.equal(request.method,'POST');
  assert.equal(request.hostname,'bedrock-runtime.us-east-1.amazonaws.com');
  assert.equal(request.path,'/model/us.openai.gpt-6-luna/converse');
  assert.deepEqual(request.body.inferenceConfig,{maxTokens:350});
  assert.equal('toolConfig' in request.body,false);
  assert.equal('reasoning' in request.body,false);
  assert.equal('reasoning_effort' in request.body,false);
  assert.equal('temperature' in request.body,false);
  assert.deepEqual(request.body.additionalModelRequestFields,{text:{format:{strict:true}}});
  const output=request.body.outputConfig as {textFormat:{type:string;structure:{jsonSchema:{name:string;schema:string}}}};
  assert.equal(output.textFormat.type,'json_schema');
  assert.equal(output.textFormat.structure.jsonSchema.name,'tally_explanation');
  const schema=JSON.parse(output.textFormat.structure.jsonSchema.schema);
  assert.deepEqual(schema,EXPLANATION_JSON_SCHEMA);
  assert.deepEqual(schema.required,['summary','what_changed','fact_ids','rule_ids']);
  assert.equal(schema.additionalProperties,false);
  assert.deepEqual(schema.properties,{summary:{type:'string'},what_changed:{type:'string'},fact_ids:{type:'array',items:{type:'string'}},rule_ids:{type:'array',items:{type:'string'}}});
  assert.equal(BEDROCK_CONFIG.useNativeTokenCount,false);
  assert.equal(BEDROCK_CONFIG.clientConfig.maxAttempts,1);
  assert.equal(result.stopReason,'endTurn');
  assert.deepEqual(result.lastMessage.content,[{type:'text',text:validText}]);
  assert.deepEqual(parseCompleteExplanation(result.lastMessage.content[0]!.text!,context),explanation);
  assert.deepEqual(result.metrics?.accumulatedUsage,usage);
});

test('a complete SDK explanation preserves actual usage and passes the deterministic validator',async()=>{
  const {receipt}=await receiptFor(response());
  assert.equal(receipt.mode,'live_bedrock');
  assert.deepEqual(receipt.explanation,explanation);
  assert.deepEqual(receipt.usage,usage);
});

test('separate SDK reasoning blocks are stripped before returning or parsing the final explanation',async()=>{
  const privateMarker='OFFLINE_PRIVATE_REASONING_DO_NOT_RETAIN';
  const mock=mockedSdk(response([{reasoningContent:{reasoningText:{text:privateMarker,signature:'test-only-signature'}}},{text:validText}]));
  let sanitized:StrandsResult|undefined;
  const receipt=await explainWithStrands(context,{approvedLiveCall:true,env,invoke:async(prompt,signal)=>{sanitized=await mock.invoke(prompt,signal);return sanitized;}});
  assert.equal(mock.requests.length,1);
  assert.equal(receipt.mode,'live_bedrock');
  assert.deepEqual(receipt.explanation,explanation);
  assert.deepEqual(sanitized?.lastMessage.content,[{type:'reasoning'},{type:'text',text:validText}]);
  assert.equal(JSON.stringify(sanitized).includes(privateMarker),false);
  assert.equal(JSON.stringify(receipt).includes(privateMarker),false);
  assert.equal(JSON.stringify(sanitized).includes('test-only-signature'),false);
});

test('unexpected SDK tool output falls back without invoking a tool or another model turn',async()=>{
  const {receipt}=await receiptFor(response([{toolUse:{toolUseId:'unexpected-tool',name:'never_registered',input:{}}}]));
  assert.equal(receipt.mode,'deterministic_fallback');
  assert.deepEqual(receipt.explanation,deterministicExplanation(context));
});

test('a non-text non-reasoning block also fails the adapter guard with an apparent end turn',async()=>{
  const receipt=await explainWithStrands(context,{approvedLiveCall:true,env,invoke:async()=>({stopReason:'endTurn',lastMessage:{content:[{type:'text',text:validText},{type:'toolUseBlock'}]},metrics:{accumulatedUsage:usage}})});
  assert.equal(receipt.mode,'deterministic_fallback');
  assert.equal(receipt.reason,'EXPLANATION_NON_TEXT');
  assert.deepEqual(receipt.explanation,deterministicExplanation(context));
});

test('truncated SDK output falls back without fabricating unavailable usage or issuing a repair call',async()=>{
  const {receipt}=await receiptFor(response([{text:'{"summary":"unfinished'}],'max_tokens'));
  assert.equal(receipt.mode,'deterministic_fallback');
  // The pinned Agent throws on max_tokens before returning a result or its metrics.
  assert.equal(receipt.reason,'EXPLANATION_PROVIDER_FAILURE');
  assert.deepEqual(receipt.usage,{inputTokens:null,outputTokens:null,totalTokens:null});
});

test('a refusal or content filter never becomes an explanation and is not retried',async()=>{
  for(const payload of [response([{text:'I cannot provide this response.'}]),response([{text:validText}],'content_filtered')]) {
    const {receipt}=await receiptFor(payload);
    assert.equal(receipt.mode,'deterministic_fallback');
    assert.deepEqual(receipt.explanation,deterministicExplanation(context));
  }
});

test('missing SDK usage fails closed without fabricating zero token counts',async()=>{
  const payload=response();
  delete payload.usage;
  const {receipt}=await receiptFor(payload);
  assert.equal(receipt.mode,'deterministic_fallback');
  assert.deepEqual(receipt.usage,{inputTokens:null,outputTokens:null,totalTokens:null});
});

test('native JSON shape does not bypass unknown ID, numeric, claim, or text-length guards',async()=>{
  const invalid=[
    {...explanation,fact_ids:['invented-fact']},
    {...explanation,summary:'The recorded amount is 987654321.'},
    {...explanation,summary:'You are eligible for a credit.'},
    {...explanation,summary:'x'.repeat(601)},
    {...explanation,fact_ids:[...explanation.fact_ids,...explanation.fact_ids]},
    {...explanation,unexpected:'extra field'},
  ];
  for(const value of invalid) {
    const {receipt}=await receiptFor(response([{text:JSON.stringify(value)}]));
    assert.equal(receipt.mode,'deterministic_fallback');
    assert.deepEqual(receipt.explanation,deterministicExplanation(context));
  }
});
