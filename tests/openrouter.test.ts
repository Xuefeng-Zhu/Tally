import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROFILE } from '../packages/contracts/index.js';
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
  assert.ok(receipts.every(receipt => receipt.cumulativeUpperBoundUsd <= 0.50));
});

test('oversized input and mismatched rule context are rejected before spending an attempt', async () => {
  const context = await bakeryContext();
  const mock = mocked(envelope(context));
  const explain = createOpenRouterExplainer({ approvedLiveCall: true, fetcher: mock.fetcher });
  const oversized = await explain({ ...context, previousSummary: 'x'.repeat(100_001) });
  assert.equal(oversized.reason, 'EXPLANATION_INPUT_LIMIT');
  assert.equal(oversized.attempted, false);
  const mismatch = await explain({ ...context, opportunity: { ...context.opportunity, rule_set_id: 'wrong-rule' } });
  assert.equal(mismatch.reason, 'EXPLANATION_RULE_CONTEXT_INVALID');
  assert.equal(mismatch.attemptsUsed, 0);
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
