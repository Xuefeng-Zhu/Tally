import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ANNUAL_IDS, CONTEXT, EVIDENCE_IDS, type Explanation } from '../packages/contracts/index.js';
import { MODEL } from '../packages/contracts/model.js';
import { deterministicExplanation, type ExplanationContext } from '../services/providers/explanation.js';
import { explainWithStrands, type SingleTurnInvoker, type StrandsResult } from '../services/providers/strands.js';
import { loadRulePack, MAX_RULE_CONTEXT_BYTES, type RuleContext, type RuleSourceContext } from '../services/rules/rule-pack.js';

const directory = new URL('../rules/2025/', import.meta.url);
const packName = 'us-federal-irc45r-2025-v1.json';
const packBytes = readFileSync(new URL(packName, directory));
const manifestBytes = readFileSync(new URL('sources/manifest.json', directory));
const context = JSON.parse(readFileSync(new URL('../fixtures/interim/strands-smoke-input.json', import.meta.url), 'utf8')) as ExplanationContext;
const env = { TALLY_DEMO_TENANT_ID: CONTEXT.business_id, TALLY_TAX_YEAR: '2025', TALLY_RULE_SET_ID: CONTEXT.rule_set_id, AWS_REGION: MODEL.region, BEDROCK_MODEL_ID: MODEL.model_id, TALLY_EXPLANATION_ADAPTER: 'strands' };
const usage = { inputTokens: 80, outputTokens: 35, totalTokens: 115 };
const explanation: Explanation = { summary: 'Professional review remains pending. Annual requirements remain unresolved.', what_changed: '', fact_ids: context.opportunity.fact_ids.slice(0, 1), rule_ids: ['annual_fte'] };
const result = (value: Explanation = explanation): StrandsResult => ({ stopReason: 'endTurn', lastMessage: { content: [{ type: 'text', text: JSON.stringify(value) }] }, metrics: { accumulatedUsage: usage } });
const hash = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
type Pack = { rule_set_id: string; tax_year: number; context_version: string; specification_status: string; purpose: string; rule_source_ids: string[]; annual_requirements: string[]; evidence_checks: string[]; constraints: string[]; source_context: RuleSourceContext[]; [key: string]: unknown };
async function temporaryPack(run: (url: URL, pack: Pack, manifest: Record<string, unknown>) => Promise<void>, change?: (pack: Pack, manifest: Record<string, unknown>) => void) {
  const path = await mkdtemp(join(tmpdir(), 'tally-rulepack-'));
  const pack = JSON.parse(packBytes.toString('utf8')) as Pack;
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as Record<string, unknown>;
  change?.(pack, manifest);
  await mkdir(join(path, 'sources'));
  await writeFile(join(path, packName), JSON.stringify(pack));
  await writeFile(join(path, 'sources/manifest.json'), JSON.stringify(manifest));
  try { await run(pathToFileURL(path + '/'), pack, manifest); }
  finally { await rm(path, { recursive: true, force: true }); }
}
async function rejected(change: (pack: Pack, manifest: Record<string, unknown>) => void) {
  await temporaryPack(async url => { assert.throws(() => loadRulePack(url), /EXPLANATION_RULE_CONTEXT_INVALID/); }, change);
}

// These are provenance and uncertainty checks, not legal interpretation or professional review.
test('runtime rule context is read from the actual versioned pack with exact contract IDs and honest provenance', async () => {
  const loaded = loadRulePack();
  assert.equal(loaded.rule_set_id, CONTEXT.rule_set_id);
  assert.equal(loaded.tax_year, 2025);
  assert.equal(loaded.rule_pack_sha256, hash(packBytes));
  assert.deepEqual(loaded.annual_requirements, [...ANNUAL_IDS]);
  assert.deepEqual(loaded.evidence_checks, [...EVIDENCE_IDS]);
  assert.deepEqual(loaded.source_context, (JSON.parse(packBytes.toString()) as Pack).source_context);
  assert.equal(loaded.context_status, 'source_excerpt_checked_professional_review_pending');
  assert.equal(loaded.specification_status, 'interim_reconstructed');
  assert.equal(loaded.provenance.source_id, 'form-8941-instructions-2025');
  assert.equal(loaded.provenance.url, 'https://www.irs.gov/pub/irs-prior/i8941--2025.pdf');
  assert.equal(loaded.provenance.professional_review_status, 'not_reviewed');
  assert.equal(loaded.provenance.calculation_enabled, false);
  assert.ok(loaded.source_context.every(entry => entry.source_id === loaded.provenance.source_id), 'No statutory excerpt is attributed to an unavailable IRC text artifact');
  assert.ok(Buffer.byteLength(JSON.stringify(loaded), 'utf8') <= MAX_RULE_CONTEXT_BYTES);
  await temporaryPack(async url => {
    const bytes = await readFile(new URL(packName, url));
    assert.equal(loadRulePack(url).rule_pack_sha256, hash(bytes), 'The digest binds actual selected file bytes, rather than a hardcoded context');
    assert.notEqual(hash(bytes), hash(packBytes));
  });
});

test('each source excerpt occurs on its stated page of the hash-bound local IRS PDF', async () => {
  const loaded = loadRulePack();
  const bytes = readFileSync(new URL('sources/i8941--2025.pdf', directory));
  assert.equal(hash(bytes), loaded.provenance.sha256);
  const require = createRequire(import.meta.url);
  const pdfjs = await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href;
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, enableXfa: false, useWorkerFetch: false, useWasm: false, disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  const normalize = (value: string) => value.normalize('NFKC').replace(/\u00ad/g, '').replace(/\s+/g, ' ').trim();
  try {
    const document = await task.promise;
    for (const entry of loaded.source_context) {
      assert.ok(entry.pdf_page <= document.numPages);
      const page = await document.getPage(entry.pdf_page);
      const content = await page.getTextContent();
      const text = content.items.map((item: { str?: unknown }) => typeof item.str === 'string' ? item.str : '').join(' ');
      assert.ok(normalize(text).includes(normalize(entry.excerpt)), `Source excerpt for ${entry.requirement_id} must be present on PDF page ${entry.pdf_page}`);
      page.cleanup();
    }
  } finally { await task.destroy(); }
});

test('wrong year, rule/version and missing, duplicate or unknown requirement IDs fail closed', async () => {
  const changes: ((pack: Pack) => void)[] = [
    pack => { pack.tax_year = 2024; }, pack => { pack.tax_year = 2026; },
    pack => { pack.rule_set_id = 'us-federal-other-2025-v1'; }, pack => { pack.context_version = 'unreviewed-v2'; },
    pack => { pack.annual_requirements.pop(); }, pack => { pack.annual_requirements[1] = pack.annual_requirements[0]; },
    pack => { pack.annual_requirements[0] = 'invented_requirement'; },
    pack => { pack.evidence_checks.pop(); }, pack => { pack.evidence_checks[1] = pack.evidence_checks[0]; },
    pack => { pack.evidence_checks[0] = 'invented_check'; },
  ];
  for (const change of changes) await rejected(change);
});

test('incomplete or incorrectly attributed excerpts and falsely promoted review/calculation metadata are rejected', async () => {
  const changes: ((pack: Pack, manifest: Record<string, unknown>) => void)[] = [
    pack => { pack.source_context.pop(); }, pack => { pack.source_context[1].requirement_id = pack.source_context[0].requirement_id; },
    pack => { pack.source_context[0].source_id = 'irc-45r'; }, pack => { pack.source_context[0].excerpt = ''; },
    pack => { pack.source_context[0].pdf_page = 0; }, pack => { pack.source_context[0].pdf_page = 31; },
    (_, manifest) => { manifest.professional_review_status = 'professionally_reviewed'; },
    (_, manifest) => { manifest.calculation_enabled = true; }, (_, manifest) => { manifest.sha256 = '0'.repeat(64); },
    (_, manifest) => { manifest.source = 'https://example.invalid/unverified-source.pdf'; },
  ];
  for (const change of changes) await rejected(change);
});

test('malformed/missing local inputs and oversized UTF-8 context are rejected rather than silently truncated', async () => {
  await temporaryPack(async url => { await writeFile(new URL(packName, url), '{'); assert.throws(() => loadRulePack(url), /EXPLANATION_RULE_CONTEXT_INVALID/); });
  await temporaryPack(async url => { await rm(new URL('sources/manifest.json', url)); assert.throws(() => loadRulePack(url), /EXPLANATION_RULE_CONTEXT_INVALID/); });
  await temporaryPack(async url => { await rm(new URL(packName, url)); assert.throws(() => loadRulePack(url), /EXPLANATION_RULE_CONTEXT_INVALID/); });
  await rejected(pack => { pack.unused_padding = 'x'.repeat(21_000); });
  await rejected((_, manifest) => { manifest.unused_padding = 'x'.repeat(4_001); });
  await rejected(pack => {
    pack.purpose = '界'.repeat(180); pack.constraints = pack.constraints.map(() => '界'.repeat(180));
    for (const entry of pack.source_context) { entry.section = '界'.repeat(100); entry.excerpt = '界'.repeat(220); }
  });
});

test('the actual application-built prompt includes the bounded attributed pack and only referenced business facts', async () => {
  let calls = 0; let sent: Record<string, unknown> | undefined;
  const input = structuredClone(context);
  input.facts.push({ ...structuredClone(input.facts[0]), fact_id: 'unreferenced-test-fact', value: 987654321 });
  const receipt = await explainWithStrands(input, { approvedLiveCall: true, env, invoke: async prompt => { calls++; sent = JSON.parse(prompt) as Record<string, unknown>; return result(); } });
  assert.equal(calls, 1); assert.equal(receipt.mode, 'live_bedrock'); assert.ok(sent);
  assert.deepEqual(sent.rule_context, loadRulePack());
  assert.deepEqual(sent.allowed_rule_ids, [...ANNUAL_IDS, ...EVIDENCE_IDS]);
  assert.deepEqual(sent.allowed_fact_ids, context.opportunity.fact_ids);
  assert.ok(!(sent.source_values as { fact_id: string }[]).some(fact => fact.fact_id === 'unreferenced-test-fact'));
  assert.ok(!(sent.allowed_rule_ids as string[]).includes((sent.rule_context as RuleContext).provenance.source_id));
  assert.equal((sent.rule_context as RuleContext).provenance.professional_review_status, 'not_reviewed');
  assert.equal((sent.rule_context as RuleContext).provenance.calculation_enabled, false);
  assert.deepEqual(input.opportunity, context.opportunity, 'Sending background context cannot mutate deterministic annual evidence or amounts');
});

test('bad rule files or caller rule/year disagreement fall back before invoking the model', async () => {
  const before = structuredClone(context); let calls = 0;
  const invoke: SingleTurnInvoker = async () => { calls++; return result(); };
  await temporaryPack(async url => {
    const receipt = await explainWithStrands(context, { approvedLiveCall: true, env, invoke, rulePackDirectory: url });
    assert.equal(receipt.mode, 'deterministic_fallback'); assert.equal(receipt.reason, 'EXPLANATION_RULE_CONTEXT_INVALID');
    assert.deepEqual(receipt.explanation, deterministicExplanation(context));
    assert.deepEqual(receipt.usage, { inputTokens: null, outputTokens: null, totalTokens: null });
  }, pack => { pack.annual_requirements.pop(); });
  for (const field of ['rule_set_id', 'tax_year'] as const) {
    const input = structuredClone(context);
    if (field === 'rule_set_id') input.opportunity.rule_set_id = 'us-federal-other-2025-v1';
    else input.opportunity.tax_year = 2026 as 2025;
    const receipt = await explainWithStrands(input, { approvedLiveCall: true, env, invoke });
    assert.equal(receipt.mode, 'deterministic_fallback'); assert.equal(receipt.reason, 'EXPLANATION_RULE_CONTEXT_INVALID');
  }
  assert.equal(calls, 0); assert.deepEqual(context, before);
  assert.ok(context.opportunity.annual_requirements.every(check => check.result === 'unknown'));
  assert.equal(context.opportunity.estimate.amount_cents, null);
});

test('source form numbers and source IDs in the prompt never become permitted business numbers or output requirement IDs', async () => {
  assert.ok(loadRulePack().source_context.some(entry => entry.excerpt.includes('8941')));
  for (const [value, reason] of [
    [{ ...explanation, summary: 'The recorded amount is 8941.' }, 'EXPLANATION_NUMBER'],
    [{ ...explanation, rule_ids: ['form-8941-instructions-2025'] }, 'EXPLANATION_REFERENCE'],
    [{ ...explanation, rule_ids: ['irc-45r'] }, 'EXPLANATION_REFERENCE'],
  ] as const) {
    const receipt = await explainWithStrands(context, { approvedLiveCall: true, env, invoke: async () => result(value as Explanation) });
    assert.equal(receipt.mode, 'deterministic_fallback'); assert.equal(receipt.reason, reason); assert.deepEqual(receipt.usage, usage);
  }
});

test('partial source context cannot support invented professional review, eligibility, annual completion, credit or payment matching claims', async () => {
  const claims = ['Your business meets all credit requirements.', 'Annual requirements have been met.', 'A tax professional reviewed this assessment.', 'This assessment was reviewed by a professional.', 'The IRS has approved this assessment.', 'This evidence was professionally reviewed.', 'The legal review is complete.', 'Professional review has been approved.', 'The tax review passed.', 'These records are IRS-approved.', 'You qualify for a credit.', 'Your credit is $1200.', 'Annual requirements are resolved.', 'The payment matches the coverage.'];
  let calls = 0;
  for (const summary of claims) {
    const receipt = await explainWithStrands(context, { approvedLiveCall: true, env, invoke: async () => { calls++; return result({ ...explanation, summary }); } });
    assert.equal(receipt.mode, 'deterministic_fallback', summary); assert.equal(receipt.reason, 'EXPLANATION_CLAIM', summary);
    assert.deepEqual(receipt.explanation, deterministicExplanation(context)); assert.deepEqual(receipt.usage, usage);
  }
  assert.equal(calls, claims.length, 'There is one injected attempt per case, with no repair or retry');
  assert.ok(context.opportunity.annual_requirements.every(check => check.result === 'unknown')); assert.equal(context.opportunity.estimate.amount_cents, null);
});
