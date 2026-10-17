import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_PROFILE } from '../packages/contracts/index.js';
import { evaluateRuleLibrary, parseRuleLibrary, RULE_LIBRARY, type RuleAnswer, type RuleScreeningProfile } from '../packages/rules/library.js';

const ids = ['irc_45r', 'irc_45e', 'irc_44', 'irc_190', 'irc_51', 'irc_179', 'irc_168k', 'irc_45b', 'irc_199a', 'irc_162l'];
const rule = (id: string) => { const found = RULE_LIBRARY.find(entry => entry.id === id); assert.ok(found); return found; };
const screen = (profile: RuleScreeningProfile | null, id: string) => { const found = evaluateRuleLibrary(profile).find(entry => entry.rule_id === id); assert.ok(found); return found; };
const allAnswers = (answer: RuleAnswer): Record<string, RuleAnswer> => Object.fromEntries(RULE_LIBRARY.flatMap(entry => entry.conditions.map(condition => [condition.flag, answer])));
const positive = (overrides: Partial<RuleScreeningProfile> = {}): RuleScreeningProfile => ({ ...DEFAULT_PROFILE, opportunity_flags: allAnswers('yes'), ...overrides });
const copyManifest = (): Record<string, any>[] => JSON.parse(readFileSync(new URL('../rules/2025/opportunity-library.json', import.meta.url), 'utf8'));
function rejects(change: (manifest: Record<string, any>[]) => void) { const manifest = copyManifest(); change(manifest); assert.throws(() => parseRuleLibrary(manifest), /RULE_LIBRARY_INVALID/); }

test('library contains exactly ten distinct opportunities, not health evidence subchecks', () => {
  assert.equal(RULE_LIBRARY.length, 10);
  assert.deepEqual(RULE_LIBRARY.map(entry => entry.id), ids);
  assert.equal(RULE_LIBRARY.filter(entry => entry.type === 'credit').length, 5);
  assert.equal(RULE_LIBRARY.filter(entry => entry.type === 'deduction').length, 5);
  const healthPack = JSON.parse(readFileSync(new URL('../rules/2025/us-federal-irc45r-2025-v1.json', import.meta.url), 'utf8'));
  assert.ok(!RULE_LIBRARY.some(entry => [...healthPack.annual_requirements, ...healthPack.evidence_checks].includes(entry.id)));
});

test('every rule retains official source provenance and honest offline, review and live status', () => {
  for (const entry of RULE_LIBRARY) {
    assert.equal(entry.tax_year, 2025);
    assert.equal(entry.professional_review_status, 'not_reviewed');
    assert.equal(entry.verification_status, 'source_checked_offline_tests_only');
    assert.equal(entry.live_e2e_status, 'not_verified');
    assert.ok(entry.sources.length > 0 && entry.conditions.length > 0 && entry.missing_evidence.length > 0);
    for (const source of entry.sources) {
      assert.equal(new URL(source.url).hostname, 'www.irs.gov');
      assert.equal(source.tax_year, 2025);
      assert.ok(Number.isFinite(Date.parse(source.verified_at)));
    }
  }
  assert.equal(rule('irc_45r').fixture_verification, 'existing_45r_offline_fixture_flow');
  assert.ok(RULE_LIBRARY.filter(entry => entry.id !== 'irc_45r').every(entry => entry.fixture_verification === 'not_implemented'));
});

test('source edition notes distinguish 2025 analysis from evergreen guidance and the current 2017 form', () => {
  const barrier = rule('irc_190').sources[0];
  assert.equal(barrier.edition, 'evergreen');
  assert.match(barrier.notes!, /not a 2025 edition/);
  const access = rule('irc_44').sources.find(source => source.url.endsWith('/f8826.pdf'));
  assert.ok(access);
  assert.equal(access.edition, 'current_revision');
  assert.match(access.title, /2017/);
  assert.match(access.notes!, /not a 2025 edition/);
  assert.equal(rule('irc_51').sources[0].edition, 'evergreen');
});

test('absent profiles and the actual bakery profile default to missing evidence without activating claims', () => {
  for (const profile of [null, DEFAULT_PROFILE]) {
    const results = evaluateRuleLibrary(profile);
    assert.ok(results.every(entry => entry.status === 'needs_evidence'));
    for (const entry of results) {
      assert.ok(entry.reasons.length > 0 && entry.missing_evidence.length > 0);
      assert.equal(entry.professional_review_status, 'not_reviewed');
      assert.equal(entry.legal_claim_activated, false);
      assert.equal(entry.calculation_enabled, false);
      assert.ok(!Object.hasOwn(entry, 'amount') && !Object.hasOwn(entry, 'eligible'));
    }
  }
});

test('known wrong years are outside the 2025 library even when all supplied flags are positive', () => {
  for (const tax_year of [2024, 2026]) assert.ok(evaluateRuleLibrary(positive({ tax_year })).every(entry => entry.status === 'out_of_scope'));
  assert.ok(evaluateRuleLibrary(positive({ tax_year: NaN })).every(entry => entry.status === 'needs_evidence'));
});

test('C corporation profile does not produce owner-level QBI or self-employed insurance candidates', () => {
  const profile = positive({ federal_tax_classification: 'c_corporation' });
  for (const id of ['irc_199a', 'irc_162l']) {
    assert.equal(rule(id).claimant, 'owner');
    assert.equal(screen(profile, id).status, 'out_of_scope');
    assert.ok(!rule(id).entity_scope.includes('c_corporation'));
  }
  assert.equal(screen(profile, 'irc_179').status, 'potential_opportunity');
  assert.equal(screen(profile, 'irc_45b').status, 'potential_opportunity');
});

test('LLC labels and unknown federal classification do not imply pass-through or owner status', () => {
  for (const federal_tax_classification of ['llc', 'unknown', '', 'not_a_recognized_entity', '__proto__', 'constructor', 'toString']) {
    const results = evaluateRuleLibrary(positive({ federal_tax_classification }));
    assert.ok(results.every(entry => entry.status === 'needs_evidence'));
    assert.ok(results.every(entry => entry.reasons.some(reason => reason.includes('federal tax classification'))));
  }
  assert.equal(screen(positive({ federal_tax_classification: 'S corporation' }), 'irc_199a').status, 'potential_opportunity');
});

test('positive context only creates review candidates and preserves evidence requirements and disabled calculations', () => {
  const results = evaluateRuleLibrary(positive());
  assert.ok(results.every(entry => entry.status === 'potential_opportunity'));
  assert.ok(results.every(entry => !entry.legal_claim_activated && !entry.calculation_enabled && entry.missing_evidence.length > 0));
  assert.match(screen(positive(), 'irc_199a').reasons.join(' '), /owner-level review candidate/);
  const answers = Object.fromEntries(rule('irc_179').conditions.map(condition => [condition.flag, 'yes' as const]));
  const selected = evaluateRuleLibrary({ ...DEFAULT_PROFILE, opportunity_flags: answers });
  assert.deepEqual(selected.filter(entry => entry.status === 'potential_opportunity').map(entry => entry.rule_id), ['irc_179']);
});

test('no, unknown, malformed or contradictory answers require evidence and do not infer legal disqualification', () => {
  for (const answer of ['no', 'unknown', 'true'] as const) {
    const profile = positive();
    profile.opportunity_flags![rule('irc_179').conditions[0].flag] = answer as RuleAnswer;
    assert.equal(screen(profile, 'irc_179').status, 'needs_evidence');
  }
  const conflicting = positive({ health_benefits_offered: 'no' });
  assert.equal(screen(conflicting, 'irc_45r').status, 'needs_evidence');
  assert.equal(screen({ ...DEFAULT_PROFILE, activity: 'Restaurant with tipped staff, equipment purchases and retirement startup costs' }, 'irc_45b').status, 'needs_evidence');
});

test('2025 property timing, employer tip restrictions and owner-specific conditions remain explicit', () => {
  const conditions = (id: string) => rule(id).conditions.map(entry => entry.description).join(' ');
  assert.match(conditions('irc_168k'), /before January 20, 2025/);
  assert.match(conditions('irc_168k'), /after section 179/);
  assert.match(conditions('irc_179'), /more than 50%/);
  assert.match(conditions('irc_45b'), /barbering\/hair care, nail care, esthetics/);
  assert.match(conditions('irc_45b'), /distinguish tips from service charges/);
  assert.match(conditions('irc_199a'), /S-corporation reasonable compensation and partner guaranteed payments/);
  assert.match(conditions('irc_162l'), /more-than-2% S-corporation shareholder/);
  assert.match(conditions('irc_162l'), /W-2 box 1/);
  assert.match(conditions('irc_162l'), /partnership must reimburse.*guaranteed payments on Schedule K-1/);
  assert.match(conditions('irc_51'), /on or before December 31, 2025/);
  assert.match(conditions('irc_44'), /coordinate any section 190/);
});

test('manifest rejects missing, duplicate, unknown and misclassified rules and promoted review statuses', () => {
  const changes: ((manifest: Record<string, any>[]) => void)[] = [
    manifest => { manifest.pop(); }, manifest => { manifest.push(structuredClone(manifest[0])); },
    manifest => { manifest[1].id = manifest[0].id; }, manifest => { manifest[1].id = 'irc_invented'; },
    manifest => { manifest[0].tax_year = 2026; }, manifest => { manifest[0].type = 'deduction'; },
    manifest => { manifest[8].claimant = 'business'; }, manifest => { manifest[8].entity_scope.push('c_corporation'); },
    manifest => { manifest[1].fixture_verification = 'existing_45r_offline_fixture_flow'; },
    manifest => { manifest[1].live_e2e_status = 'verified'; }, manifest => { manifest[1].professional_review_status = 'approved'; },
    manifest => { manifest[1].verification_status = 'live_verified'; },
  ];
  for (const change of changes) rejects(change);
});

test('manifest rejects unsafe source URLs, missing provenance and duplicate or empty conditions', () => {
  for (const url of ['http://www.irs.gov/anything', 'https://irs.gov.example.com/source', 'https://attacker@www.irs.gov/source', 'javascript:alert(1)']) rejects(manifest => { manifest[0].sources[0].url = url; });
  rejects(manifest => { manifest[0].sources = []; });
  rejects(manifest => { manifest[0].sources[0].verified_at = 'not-a-date'; });
  rejects(manifest => { manifest[0].sources[0].tax_year = 2026; });
  rejects(manifest => { delete manifest[3].sources[0].notes; });
  rejects(manifest => { manifest[0].conditions = []; });
  rejects(manifest => { manifest[0].conditions.push(structuredClone(manifest[0].conditions[0])); });
  rejects(manifest => { manifest[0].missing_evidence = []; });
});

test('evaluation is repeatable, leaves profiles untouched and returns isolated result arrays', () => {
  const profile = positive();
  const before = structuredClone(profile);
  const first = evaluateRuleLibrary(profile);
  assert.deepEqual(first, evaluateRuleLibrary(profile));
  assert.deepEqual(profile, before);
  first[0].missing_evidence.length = 0;
  first[0].reasons.push('local result mutation');
  assert.deepEqual(evaluateRuleLibrary(profile), evaluateRuleLibrary(before));
  assert.ok(rule('irc_45r').missing_evidence.length > 0);
  assert.ok(Object.isFrozen(RULE_LIBRARY) && Object.isFrozen(rule('irc_45r').conditions) && Object.isFrozen(rule('irc_45r').sources[0]));
});
