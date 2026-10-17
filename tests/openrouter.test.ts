import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ANNUAL_IDS, EVIDENCE_IDS, DEFAULT_PROFILE } from '../packages/contracts/index.js';
import { TallyEngine, MemoryStore } from '../services/worker/core.js';
import type { ExplanationContext } from '../services/providers/explanation.js';
import { createOpenRouterExplainer, OPENROUTER_CONFIG } from '../services/providers/openrouter.js';

let previousKey: string | undefined;
beforeEach(() => { previousKey = process.env.OPENROUTER_API_KEY; process.env.OPENROUTER_API_KEY = 'offline-test-placeholder'; });
afterEach(() => { if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = previousKey; });

async function bakeryContext(): Promise<ExplanationContext> {
  const engine = new TallyEngine(new MemoryStore());
  await engine.saveProfile(DEFAULT_PROFILE, 0);
  await engine.analyze(['fixture-A']);
  await engine.processAll();
  const state = await engine.state();
  assert.ok(state.opportunity);
  return { opportunity: state.opportunity, facts: state.facts };
}
function output(context: ExplanationContext) {
  return { summary: 'Payment and partial payroll evidence are recorded. Coverage evidence and annual requirements remain unresolved.', what_changed: 'Payment and partial payroll evidence were added.', fact_ids: context.opportunity.fact_ids.slice(0, 2), rule_ids: ['recorded_insurance_payment', 'partial_payroll'] };
}
function envelope(context: ExplanationContext) {
  return { id: 'gen-offline-test', provider: 'OpenAI', model: OPENROUTER_CONFIG.modelId, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(output(context)) } }], usage: { prompt_tokens: 1500, completion_tokens: 100, total_tokens: 1600, cost: 0.00020 } };
}
function mocked(value: unknown | (() => Promise<Response>), status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = (async (url: unknown, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return typeof value === 'function' ? await value() : new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { calls, fetcher };
}

test('construction is inert; explicit approval and externally loaded key are required before a request', async () => {
  const context = await bakeryContext();
  const mock = mocked(envelope(context));
  const unapproved = createOpenRouterExplainer({ approvedLiveCall: false, fetcher: mock.fetcher });
  assert.equal(mock.calls.length, 0);
  await assert.rejects(unapproved(context), /OPENROUTER_EXPLICIT_APPROVAL_REQUIRED/);
  delete process.env.OPENROUTER_API_KEY;
  await assert.rejects(createOpenRouterExplainer({ approvedLiveCall: true, fetcher: mock.fetcher })(context), /OPENROUTER_API_KEY_REQUIRED/);
  assert.equal(mock.calls.length, 0);
});

test('one grounded strict JSON call uses the fixed model, route, price limits and safe provider receipt', async () => {
  const context = await bakeryContext();
  const mock = mocked(envelope(context));
  const receipt = await createOpenRouterExplainer({ approvedLiveCall: true, fetcher: mock.fetcher })(context);
  assert.equal(receipt.mode, 'live_openrouter');
  assert.equal(receipt.attempt, 1);
  assert.equal(receipt.costSource, 'provider');
  assert.equal(receipt.costUsd, 0.00020);
  assert.equal(receipt.costUncertain, false);
  assert.equal(receipt.responseId, 'gen-offline-test');
  assert.equal(receipt.observedProvider, 'OpenAI');
  assert.equal(receipt.httpStatus, 200);
  assert.equal(receipt.finishReason, 'stop');
  assert.deepEqual(receipt.usage, { inputTokens: 1500, outputTokens: 100, totalTokens: 1600 });
  assert.ok(receipt.cumulativeUpperBoundUsd < 0.50);
  assert.equal(mock.calls.length, 1);
  const call = mock.calls[0];
  assert.equal(call.url, OPENROUTER_CONFIG.endpoint);
  assert.equal(call.init.redirect, 'error');
  assert.ok(call.init.signal instanceof AbortSignal);
  const body = JSON.parse(String(call.init.body));
  assert.equal(body.model, 'openai/gpt-6-luna');
  assert.equal(body.max_tokens, 600);
  assert.equal(body.stream, false);
  assert.equal(body.response_format.type, 'json_schema');
  assert.equal(body.response_format.json_schema.strict, true);
  assert.deepEqual(body.response_format.json_schema.schema.properties.fact_ids.items.enum, context.opportunity.fact_ids);
  assert.deepEqual(body.response_format.json_schema.schema.properties.rule_ids.items.enum, [...ANNUAL_IDS, ...EVIDENCE_IDS]);
  assert.ok(!body.response_format.json_schema.schema.properties.rule_ids.items.enum.includes('irc-45r'));
  assert.deepEqual(body.provider, { require_parameters: true, only: ['openai'], allow_fallbacks: false, max_price: { prompt: 0.10, completion: 0.50 } });
  assert.deepEqual(body.reasoning, { effort: 'none', exclude: true });
  assert.deepEqual(body.prompt_cache_options, { mode: 'explicit' });
  assert.ok(!String(call.init.body).includes('prompt_cache_breakpoint'));
  assert.ok(!('temperature' in body));
  assert.ok(!('top_p' in body));
  const prompt = JSON.parse(body.messages[1].content);
  assert.equal(prompt.rule_context.rule_set_id, context.opportunity.rule_set_id);
  assert.deepEqual(prompt.allowed_fact_ids, context.opportunity.fact_ids);
  assert.ok(!JSON.stringify(receipt).includes('offline-test-placeholder'));
  assert.ok(!('prompt' in receipt));
  assert.equal(receipt.failureDiagnostic, undefined);
  assert.equal(receipt.referenceDiagnostic, undefined);
});

test('shared run budget permits exactly two calls even with concurrent evaluations, then fails closed', async () => {
  const context = await bakeryContext();
  const mock = mocked(envelope(context));
  const explain = createOpenRouterExplainer({ approvedLiveCall: true, fetcher: mock.fetcher });
  const receipts = await Promise.all([explain(context), explain(context), explain(context)]);
  assert.equal(mock.calls.length, 2);
  assert.deepEqual(receipts.map(receipt => receipt.attempted), [true, true, false]);
  assert.equal(receipts[2].reason, 'EXPLANATION_ATTEMPT_LIMIT');
  assert.equal(receipts[2].mode, 'deterministic_fallback');
  assert.equal(receipts[2].failureDiagnostic?.stage, 'request');
  assert.ok(receipts.every(receipt => receipt.cumulativeUpperBoundUsd <= 0.50));
});

test('oversized input and mismatched rule context are rejected before spending an attempt', async () => {
  const context = await bakeryContext();
  const mock = mocked(envelope(context));
  const explain = createOpenRouterExplainer({ approvedLiveCall: true, fetcher: mock.fetcher });
  const oversized = await explain({ ...context, previousSummary: 'x'.repeat(100_001) });
  assert.equal(oversized.reason, 'EXPLANATION_INPUT_LIMIT');
  assert.equal(oversized.attempted, false);
  assert.equal(oversized.failureDiagnostic?.stage, 'request');
  const mismatch = await explain({ ...context, opportunity: { ...context.opportunity, rule_set_id: 'wrong-rule' } });
  assert.equal(mismatch.reason, 'EXPLANATION_RULE_CONTEXT_INVALID');
  assert.equal(mismatch.attemptsUsed, 0);
  assert.equal(mismatch.failureDiagnostic?.stage, 'request');
  assert.equal(mock.calls.length, 0);
  const emptyReferences = await explain({ ...context, opportunity: { ...context.opportunity, fact_ids: [] } });
  assert.equal(emptyReferences.reason, 'EXPLANATION_REFERENCE_CONTEXT_INVALID');
  assert.equal(emptyReferences.failureDiagnostic?.stage, 'request');
  assert.equal(emptyReferences.attempted, false);
  assert.equal(mock.calls.length, 0);
  const duplicateContext = await explain({ ...context, opportunity: { ...context.opportunity, fact_ids: ['same', 'same'] } });
  assert.equal(duplicateContext.reason, 'EXPLANATION_REFERENCE_CONTEXT_INVALID');
  assert.equal(duplicateContext.attempted, false);
  assert.equal(mock.calls.length, 0);
});

test('HTTP errors and transport timeouts make one attempt with sanitized uncertainty and no retry', async () => {
  const context = await bakeryContext();
  for (const [mock, reason] of [
    [mocked({ error: { message: 'never retain provider body' } }, 429), 'EXPLANATION_HTTP_429'],
    [mocked(async () => { const error = new Error('never retain secret-bearing transport details'); error.name = 'TimeoutError'; throw error; }), 'EXPLANATION_TIMEOUT'],
  ] as const) {
    const receipt = await createOpenRouterExplainer({ approvedLiveCall: true, fetcher: mock.fetcher })(context);
    assert.equal(mock.calls.length, 1);
    assert.equal(receipt.mode, 'deterministic_fallback');
    assert.equal(receipt.reason, reason);
    assert.equal(receipt.attempted, true);
    assert.equal(receipt.costUncertain, true);
    assert.equal(receipt.costUsd, null);
    assert.equal(receipt.cumulativeReportedCostUsd, null);
    assert.equal(receipt.failureDiagnostic?.stage, 'transport');
    assert.ok(receipt.cumulativeUpperBoundUsd > 0);
    assert.ok(!JSON.stringify(receipt).includes('never retain'));
  }
});

test('truncation, invented claims, references and numbers fall back while preserving actual usage and cost', async () => {
  const context = await bakeryContext();
  for (const [change, reason] of [
    [(value: ReturnType<typeof envelope>) => { value.choices[0].finish_reason = 'length'; }, 'EXPLANATION_NOT_END_TURN'],
    [(value: ReturnType<typeof envelope>) => { value.choices[0].message.content = JSON.stringify({ ...output(context), summary: 'You are eligible.' }); }, 'EXPLANATION_CLAIM'],
    [(value: ReturnType<typeof envelope>) => { value.choices[0].message.content = JSON.stringify({ ...output(context), fact_ids: ['invented'] }); }, 'EXPLANATION_REFERENCE'],
    [(value: ReturnType<typeof envelope>) => { value.choices[0].message.content = JSON.stringify({ ...output(context), summary: 'The recorded payment is 999 dollars.' }); }, 'EXPLANATION_NUMBER'],
    [(value: ReturnType<typeof envelope>) => { value.choices[0].message.content += ' trailing'; }, 'EXPLANATION_JSON_INVALID'],
  ] as const) {
    const value = envelope(context); change(value);
    const mock = mocked(value);
    const receipt = await createOpenRouterExplainer({ approvedLiveCall: true, fetcher: mock.fetcher })(context);
    assert.equal(receipt.mode, 'deterministic_fallback');
    assert.equal(receipt.reason, reason);
    assert.equal(receipt.usage.totalTokens, 1600);
    assert.equal(receipt.costUsd, 0.00020);
    assert.equal(mock.calls.length, 1);
  }
});

test('wrong model, missing usage and impossible usage or cost cannot pass as real inference', async () => {
  const context = await bakeryContext();
  for (const [change, reason] of [
    [(value: Record<string, unknown>) => { value.model = 'other/model'; }, 'EXPLANATION_MODEL_MISMATCH'],
    [(value: Record<string, unknown>) => { delete value.usage; }, 'EXPLANATION_USAGE_UNAVAILABLE'],
    [(value: Record<string, unknown>) => { value.usage = { prompt_tokens: 1500, completion_tokens: 601, total_tokens: 2101, cost: 0.0003904 }; }, 'EXPLANATION_USAGE_INVALID'],
    [(value: Record<string, unknown>) => { value.usage = { prompt_tokens: 1500, completion_tokens: 100, total_tokens: 1600, cost: 0.51 }; }, 'EXPLANATION_COST_EXCEEDS_BOUND'],
  ] as const) {
    const value: Record<string, unknown> = envelope(context); change(value);
    const mock = mocked(value);
    const receipt = await createOpenRouterExplainer({ approvedLiveCall: true, fetcher: mock.fetcher })(context);
    assert.equal(receipt.mode, 'deterministic_fallback');
    assert.equal(receipt.reason, reason);
    assert.equal(mock.calls.length, 1);
  }
});

test('missing provider cost is explicitly estimated; uncertain failed requests keep their budget reservation', async () => {
  const context = await bakeryContext();
  const value = envelope(context);
  delete (value.usage as Partial<typeof value.usage>).cost;
  const mock = mocked(value);
  const receipt = await createOpenRouterExplainer({ approvedLiveCall: true, fetcher: mock.fetcher })(context);
  assert.equal(receipt.mode, 'live_openrouter');
  assert.equal(receipt.costSource, 'rate_estimate');
  assert.equal(receipt.costUncertain, true);
  assert.equal(receipt.costUsd, 0.00020);
  assert.equal(receipt.cumulativeReportedCostUsd, null);
  const failed = mocked(async () => { throw new Error('provider details must remain private'); });
  const explain = createOpenRouterExplainer({ approvedLiveCall: true, fetcher: failed.fetcher });
  const first = await explain(context);
  const second = await explain(context);
  const third = await explain(context);
  assert.equal(first.reason, 'EXPLANATION_PROVIDER_FAILURE');
  assert.equal(second.cumulativeReportedCostUsd, null);
  assert.ok(second.cumulativeUpperBoundUsd > first.cumulativeUpperBoundUsd);
  assert.equal(third.reason, 'EXPLANATION_ATTEMPT_LIMIT');
  assert.equal(failed.calls.length, 2);
});

test('only the verified Luna alias or canonical response model may pass', async () => {
  const context = await bakeryContext();
  const value = envelope(context);
  const mock = mocked({ ...value, model: OPENROUTER_CONFIG.canonicalModelId });
  const receipt = await createOpenRouterExplainer({ approvedLiveCall: true, fetcher: mock.fetcher })(context);
  assert.equal(receipt.mode, 'live_openrouter');
  assert.equal(receipt.model, 'openai/gpt-6-luna');
  assert.equal(receipt.observedModel, 'openai/gpt-6-luna-20260922');
  const wrong = mocked({ ...value, model: 'openai/gpt-4.1-nano' });
  assert.equal((await createOpenRouterExplainer({ approvedLiveCall: true, fetcher: wrong.fetcher })(context)).reason, 'EXPLANATION_MODEL_MISMATCH');
});

test('validated prior spend is included in cost receipts and gates new calls against the original budget', async () => {
  const context = await bakeryContext();
  const mock = mocked(envelope(context));
  for (const priorSpendUsd of [-1, NaN, Infinity, 0.500001, '0.1' as unknown as number, null as unknown as number]) {
    assert.throws(() => createOpenRouterExplainer({ approvedLiveCall: true, fetcher: mock.fetcher, priorSpendUsd }), /OPENROUTER_PRIOR_SPEND_INVALID/);
  }
  const priorSpendUsd = 0.0006628;
  const receipt = await createOpenRouterExplainer({ approvedLiveCall: true, fetcher: mock.fetcher, priorSpendUsd })(context);
  assert.equal(receipt.mode, 'live_openrouter');
  assert.equal(receipt.priorSpendUsd, priorSpendUsd);
  assert.equal(receipt.cumulativeReportedCostUsd, priorSpendUsd + 0.00020);
  assert.equal(receipt.cumulativeUpperBoundUsd, priorSpendUsd + receipt.upperBoundUsd!);
  assert.equal(mock.calls.length, 1);
  const blocked = await createOpenRouterExplainer({ approvedLiveCall: true, fetcher: mock.fetcher, priorSpendUsd: 0.49999 })(context);
  assert.equal(blocked.reason, 'EXPLANATION_BUDGET_LIMIT');
  assert.equal(blocked.attempted, false);
  assert.equal(blocked.attemptsUsed, 0);
  assert.equal(blocked.failureDiagnostic?.stage, 'request');
  assert.equal(blocked.cumulativeReportedCostUsd, 0.49999);
  assert.equal(mock.calls.length, 1);
});

test('an empty tool_calls list is harmless; requested tools remain absent and malformed or real tool calls fall back', async () => {
  const context = await bakeryContext();
  for (const [tool_calls, expectedMode] of [[[], 'live_openrouter'], [null, 'live_openrouter'], [[{ type: 'function' }], 'deterministic_fallback'], ['invalid', 'deterministic_fallback']] as const) {
    const value = envelope(context);
    const mock = mocked({ ...value, choices: [{ ...value.choices[0], message: { ...value.choices[0].message, tool_calls } }] });
    const receipt = await createOpenRouterExplainer({ approvedLiveCall: true, fetcher: mock.fetcher })(context);
    assert.equal(receipt.mode, expectedMode);
    if (expectedMode === 'deterministic_fallback') assert.equal(receipt.reason, 'EXPLANATION_NON_TEXT');
    assert.ok(!('tools' in JSON.parse(String(mock.calls[0].init.body))));
  }
});

test('future claim rejections identify the validator rule and retain only a bounded output excerpt', async () => {
  const context = await bakeryContext();
  for (const [summary, rule] of [
    ['You are eligible.', 'eligibility_or_annual_claim'],
    ['The refund is $1,200.', 'credit_amount_claim'],
    ['The records were IRS-approved.', 'professional_review_claim'],
    ['Payment matches the coverage statement.', 'unsupported_payment_match'],
    ['Annual payroll wages are $4,000.', 'unsupported_annualization'],
  ] as const) {
    const value = envelope(context);
    value.choices[0].message.content = JSON.stringify({ ...output(context), summary });
    const receipt = await createOpenRouterExplainer({ approvedLiveCall: true, fetcher: mocked(value).fetcher })(context);
    assert.equal(receipt.reason, 'EXPLANATION_CLAIM');
    assert.equal(receipt.claimDiagnostic?.rule, rule);
    assert.ok(receipt.claimDiagnostic!.excerpt.includes(summary));
    assert.ok(receipt.claimDiagnostic!.excerpt.length <= 160);
    assert.equal(receipt.explanation.summary, context.opportunity.summary);
  }
});

test('claim excerpts redact full credentials, URLs, email, token strings and controls before slicing', async () => {
  const context = await bakeryContext();
  const value = envelope(context);
  const summary = 'You are eligible. offline-test-placeholder https://example.test/private me@example.test ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789\u001b\n';
  value.choices[0].message.content = JSON.stringify({ ...output(context), summary, what_changed: 'Authorization: Bearer sensitive-short-token' });
  const message = { ...value.choices[0].message, reasoning: 'never retain reasoning or transport envelope' };
  const mock = mocked({ ...value, choices: [{ ...value.choices[0], message }] });
  const receipt = await createOpenRouterExplainer({ approvedLiveCall: true, fetcher: mock.fetcher })(context);
  assert.equal(receipt.claimDiagnostic?.rule, 'eligibility_or_annual_claim');
  const excerpt = receipt.claimDiagnostic!.excerpt;
  assert.ok(excerpt.startsWith('You are eligible.'));
  assert.ok(excerpt.includes('[redacted]'));
  assert.ok(excerpt.length <= 160);
  for (const sensitive of ['offline-test-placeholder', 'https://', 'example.test', 'me@', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 'sensitive-short-token', 'never retain reasoning']) assert.ok(!JSON.stringify(receipt).includes(sensitive));
  assert.ok(!/[\u0000-\u001f\u007f-\u009f]/.test(excerpt));
});

test('malformed or oversized parsed output and forged provider metadata never create claim diagnostics', async () => {
  const context = await bakeryContext();
  for (const content of ['not json', JSON.stringify({ ...output(context), summary: 'eligible '.repeat(100) }), JSON.stringify({ ...output(context), summary: 'You are eligible.', extra: true })]) {
    const value = envelope(context);
    value.choices[0].message.content = content;
    const receipt = await createOpenRouterExplainer({ approvedLiveCall: true, fetcher: mocked(value).fetcher })(context);
    assert.equal(receipt.mode, 'deterministic_fallback');
    assert.equal(receipt.claimDiagnostic, undefined);
  }
  const mock = mocked(async () => {
    const error = Object.assign(new Error('EXPLANATION_CLAIM'), { claimRule: 'eligibility_or_annual_claim', claimMatch: { start: 0, end: 8 }, excerpt: 'never retain arbitrary transport fields' });
    throw error;
  });
  const receipt = await createOpenRouterExplainer({ approvedLiveCall: true, fetcher: mock.fetcher })(context);
  assert.equal(receipt.claimDiagnostic, undefined);
  assert.ok(!JSON.stringify(receipt).includes('never retain'));
});

test('reference diagnostics separate both fields and report type, count, duplicates and unknown IDs', async () => {
  const context = await bakeryContext();
  const value = envelope(context);
  const known = context.opportunity.fact_ids[0];
  const factIds: unknown[] = [known, known, 'unknown_fact', 17, ...Array.from({ length: 14 }, (_, index) => `extra_${index}`)];
  const ruleIds: unknown[] = ['annual_fte', 'annual_fte', 'irc-45r', false, ...Array.from({ length: 5 }, (_, index) => `unknown_${index}`)];
  value.choices[0].message.content = JSON.stringify({ ...output(context), fact_ids: factIds, rule_ids: ruleIds });
  const receipt = await createOpenRouterExplainer({ approvedLiveCall: true, fetcher: mocked(value).fetcher })(context);
  assert.equal(receipt.reason, 'EXPLANATION_REFERENCE');
  assert.equal(receipt.failureDiagnostic?.stage, 'references');
  assert.equal(receipt.referenceDiagnostic?.length, 2);
  const facts = receipt.referenceDiagnostic!.find(issue => issue.field === 'fact_ids')!;
  const rules = receipt.referenceDiagnostic!.find(issue => issue.field === 'rule_ids')!;
  assert.deepEqual(facts.failureKinds, ['too_many', 'non_string', 'unknown_id', 'duplicate']);
  assert.equal(facts.typeStatus, 'contains_non_strings');
  assert.equal(facts.actualCount, 18);
  assert.equal(facts.maxItems, 16);
  assert.equal(facts.countStatus, 'too_many');
  assert.equal(facts.nonStringCount, 1);
  assert.deepEqual(facts.nonStringIndexes, [3]);
  assert.deepEqual(facts.nonStringTypes, ['number']);
  assert.equal(facts.duplicateCount, 1);
  assert.equal(facts.invalidIdCount, 15);
  assert.ok(facts.invalidIds.includes('unknown_fact'));
  assert.ok(facts.expectedIds.includes(known));
  assert.equal(rules.maxItems, 8);
  assert.equal(rules.countStatus, 'too_many');
  assert.equal(rules.duplicateCount, 1);
  assert.ok(rules.invalidIds.includes('irc-45r'));
  assert.ok(rules.expectedIds.includes('annual_fte'));
  assert.ok(!rules.expectedIds.includes(known));
});

test('non-array references retain only type/status and the expected bounded allowlists', async () => {
  const context = await bakeryContext();
  const value = envelope(context);
  value.choices[0].message.content = JSON.stringify({ ...output(context), fact_ids: 'offline-test-placeholder', rule_ids: null });
  const receipt = await createOpenRouterExplainer({ approvedLiveCall: true, fetcher: mocked(value).fetcher })(context);
  assert.equal(receipt.referenceDiagnostic?.length, 2);
  for (const issue of receipt.referenceDiagnostic!) {
    assert.deepEqual(issue.failureKinds, ['not_array']);
    assert.equal(issue.typeStatus, 'not_array');
    assert.equal(issue.actualCount, null);
    assert.equal(issue.countStatus, 'not_array');
    assert.deepEqual(issue.invalidIds, []);
    assert.ok(issue.expectedIds.length > 0);
  }
  assert.ok(!JSON.stringify(receipt).includes('offline-test-placeholder'));
});

test('reference diagnostics redact invalid tokens and exact keys while preserving known derived IDs', async () => {
  const context = await bakeryContext();
  const derivedId = `derived:stated-employer-share:${'a'.repeat(24)}`;
  context.opportunity.fact_ids = [derivedId, 'offline-test-placeholder', ...context.opportunity.fact_ids, ...Array.from({ length: 40 }, (_, index) => `known-fact:${index}`)];
  const value = envelope(context);
  value.choices[0].message.content = JSON.stringify({ ...output(context), fact_ids: ['offline-test-placeholder-wrong', 'https://example.test/private', 'Z'.repeat(80)], rule_ids: ['irc-45r'] });
  const receipt = await createOpenRouterExplainer({ approvedLiveCall: true, fetcher: mocked(value).fetcher })(context);
  const facts = receipt.referenceDiagnostic!.find(issue => issue.field === 'fact_ids')!;
  assert.equal(facts.expectedIdCount, 47);
  assert.equal(facts.expectedIds.length, 32);
  assert.equal(facts.samplesTruncated, true);
  assert.ok(facts.expectedIds.includes(derivedId));
  assert.ok(facts.invalidIds.some(id => id.includes('[redacted]')));
  assert.ok(facts.expectedIds.every(id => id.length <= 120));
  for (const forbidden of ['offline-test-placeholder', 'https://', 'example.test', 'Z'.repeat(80)]) assert.ok(!JSON.stringify(receipt.referenceDiagnostic).includes(forbidden));
});

test('each response and output validation branch has fixed structured failure-stage evidence', async () => {
  const context = await bakeryContext();
  const outputEnvelope = (candidate: unknown) => {
    const value = envelope(context);
    value.choices[0].message.content = JSON.stringify(candidate);
    return value;
  };
  const base = envelope(context);
  const cases: { value: unknown | (() => Promise<Response>); stage: string; check: string }[] = [
    { value: async () => new Response('not-json'), stage: 'response_json', check: 'EXPLANATION_RESPONSE_INVALID' },
    { value: async () => new Response('x'.repeat(128_001)), stage: 'response_json', check: 'EXPLANATION_RESPONSE_LIMIT' },
    { value: [], stage: 'response_shape', check: 'EXPLANATION_RESPONSE_INVALID' },
    { value: { ...base, choices: [] }, stage: 'response_shape', check: 'EXPLANATION_RESPONSE_INVALID' },
    { value: { ...base, choices: [null] }, stage: 'response_shape', check: 'EXPLANATION_RESPONSE_INVALID' },
    { value: { ...base, model: 'wrong/model' }, stage: 'model', check: 'EXPLANATION_MODEL_MISMATCH' },
    { value: { ...base, usage: {} }, stage: 'usage', check: 'EXPLANATION_USAGE_UNAVAILABLE' },
    { value: { ...base, usage: { ...base.usage, total_tokens: 2000 } }, stage: 'usage', check: 'EXPLANATION_USAGE_INVALID' },
    { value: { ...base, usage: { ...base.usage, prompt_tokens: 1_000_000, total_tokens: 1_000_100 } }, stage: 'usage', check: 'EXPLANATION_USAGE_INVALID' },
    { value: { ...base, usage: { ...base.usage, completion_tokens: 601, total_tokens: 2101 } }, stage: 'usage', check: 'EXPLANATION_USAGE_INVALID' },
    { value: { ...base, usage: { ...base.usage, cost: 0.51 } }, stage: 'usage', check: 'EXPLANATION_COST_EXCEEDS_BOUND' },
    { value: { ...base, choices: [{ ...base.choices[0], finish_reason: 'length' }] }, stage: 'completion', check: 'EXPLANATION_NOT_END_TURN' },
    { value: { ...base, choices: [{ ...base.choices[0], message: null }] }, stage: 'completion', check: 'EXPLANATION_NON_TEXT' },
    { value: { ...base, choices: [{ ...base.choices[0], message: { role: 'user', content: '{}' } }] }, stage: 'completion', check: 'EXPLANATION_NON_TEXT' },
    { value: { ...base, choices: [{ ...base.choices[0], message: { role: 'assistant', content: [] } }] }, stage: 'completion', check: 'EXPLANATION_NON_TEXT' },
    { value: { ...base, choices: [{ ...base.choices[0], message: { ...base.choices[0].message, refusal: 'offline-test-placeholder' } }] }, stage: 'completion', check: 'EXPLANATION_NON_TEXT' },
    { value: { ...base, choices: [{ ...base.choices[0], message: { ...base.choices[0].message, tool_calls: {} } }] }, stage: 'completion', check: 'EXPLANATION_NON_TEXT' },
    { value: { ...base, choices: [{ ...base.choices[0], message: { ...base.choices[0].message, content: '{} trailing' } }] }, stage: 'output_json', check: 'EXPLANATION_JSON_INVALID' },
    ...[null, [], 42, 'text'].map(candidate => ({ value: outputEnvelope(candidate), stage: 'output_shape', check: 'EXPLANATION_NOT_OBJECT' })),
    { value: outputEnvelope({ ...output(context), ['offline-test-placeholder']: true }), stage: 'output_shape', check: 'EXPLANATION_FIELDS' },
    { value: outputEnvelope({ summary: 'Partial evidence.', fact_ids: [], rule_ids: [] }), stage: 'output_shape', check: 'EXPLANATION_FIELDS' },
    ...[{ summary: null }, { what_changed: false }, { summary: '  ' }, { summary: 'x'.repeat(601) }, { what_changed: 'x'.repeat(351) }].map(change => ({ value: outputEnvelope({ ...output(context), ...change }), stage: 'output_text', check: 'EXPLANATION_TEXT' })),
    { value: outputEnvelope({ ...output(context), summary: 'The recorded payment is 999 dollars.' }), stage: 'numbers', check: 'EXPLANATION_NUMBER' },
    { value: outputEnvelope({ ...output(context), summary: 'You are eligible.' }), stage: 'claim', check: 'EXPLANATION_CLAIM' },
  ];
  for (const item of cases) {
    const mock = mocked(item.value);
    const receipt = await createOpenRouterExplainer({ approvedLiveCall: true, fetcher: mock.fetcher })(context);
    assert.equal(receipt.mode, 'deterministic_fallback');
    assert.equal(receipt.failureDiagnostic?.stage, item.stage, item.check);
    assert.equal(receipt.failureDiagnostic?.check, item.check);
    assert.ok(Object.keys(receipt.failureDiagnostic!.details).length > 0);
    assert.equal(mock.calls.length, 1);
    assert.ok(!JSON.stringify(receipt).includes('offline-test-placeholder'));
    if (item.stage === 'numbers') assert.equal(receipt.failureDiagnostic!.details.constraint, 'unsupported_number');
  }
});

test('transport errors cannot inject arbitrary diagnostic codes or raw metadata', async () => {
  const context = await bakeryContext();
  const mock = mocked(async () => { throw Object.assign(new Error('EXPLANATION_PRIVATE_PROVIDER_DATA'), { referenceIssues: [{ field: 'fact_ids', unknownIdIndexes: [0] }] }); });
  const receipt = await createOpenRouterExplainer({ approvedLiveCall: true, fetcher: mock.fetcher })(context);
  assert.equal(receipt.reason, 'EXPLANATION_PROVIDER_FAILURE');
  assert.equal(receipt.failureDiagnostic?.stage, 'transport');
  assert.equal(receipt.referenceDiagnostic, undefined);
  assert.ok(!JSON.stringify(receipt).includes('PRIVATE_PROVIDER_DATA'));
});

test('provider metadata that echoes the exact environment credential is omitted from receipts', async () => {
  const context = await bakeryContext();
  for (const field of ['model', 'id', 'provider'] as const) {
    const value = { ...envelope(context), [field]: 'prefix-offline-test-placeholder-suffix' };
    const receipt = await createOpenRouterExplainer({ approvedLiveCall: true, fetcher: mocked(value).fetcher })(context);
    const receiptField = field === 'model' ? 'observedModel' : field === 'id' ? 'responseId' : 'observedProvider';
    assert.equal(receipt[receiptField], null);
    assert.ok(!JSON.stringify(receipt).includes('offline-test-placeholder'));
    if (field === 'model') assert.equal(receipt.reason, 'EXPLANATION_MODEL_MISMATCH');
  }
});

test('Oversized streaming provider output is cancelled before reading the complete allocation',async()=>{
 const context=await bakeryContext();let pulls=0,cancelled=false;
 const stream=new ReadableStream<Uint8Array>({pull(controller){pulls++;controller.enqueue(new Uint8Array(70_000));},cancel(){cancelled=true;}},{highWaterMark:0});
 const mock=mocked(async()=>new Response(stream));
 const receipt=await createOpenRouterExplainer({approvedLiveCall:true,fetcher:mock.fetcher})(context);
 assert.equal(receipt.reason,'EXPLANATION_RESPONSE_LIMIT');assert.equal(receipt.mode,'deterministic_fallback');assert.equal(cancelled,true);assert.equal(pulls,2);assert.equal(mock.calls.length,1);
});

test('Reference rejection diagnostics redact complete AWS access-key patterns',async()=>{
 const context=await bakeryContext();
 for(const token of ['AKIAABCDEFGHIJKLMNOP','ASIA1234567890ABCDEF']){
  const value=envelope(context);const answer=output(context);answer.fact_ids=[token];value.choices[0].message.content=JSON.stringify(answer);
  const mock=mocked(value);const receipt=await createOpenRouterExplainer({approvedLiveCall:true,fetcher:mock.fetcher})(context);
  assert.equal(receipt.reason,'EXPLANATION_REFERENCE');assert.ok(receipt.referenceDiagnostic);assert.ok(!JSON.stringify(receipt).includes(token));assert.match(JSON.stringify(receipt.referenceDiagnostic),/redacted/);
 }
});
