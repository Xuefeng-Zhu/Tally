import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { DEFAULT_PROFILE, type State } from '../packages/contracts/index.js';
import { OPPORTUNITY_FLAGS, isOpportunityFlag, type OpportunityFlags, type RuleAnswer } from '../packages/contracts/opportunity-flags.js';
import { validateProfile } from '../packages/contracts/validation.js';
import { evaluateRuleLibrary, RULE_LIBRARY } from '../packages/rules/library.js';
import { createApi } from '../services/api/app.js';
import { FileStore } from '../services/storage/file-store.js';
import { MemoryStore, TallyEngine } from '../services/worker/core.js';
import { startServer } from '../apps/local-proxy/server.js';

function answersFor(ruleId: string, answer: RuleAnswer = 'yes'): OpportunityFlags {
  const rule = RULE_LIBRARY.find(entry => entry.id === ruleId);
  assert.ok(rule, `Expected catalog rule ${ruleId}`);
  return Object.fromEntries(rule.conditions.map(condition => [condition.flag, answer]));
}
const profileWith = (opportunity_flags: unknown) => ({ ...DEFAULT_PROFILE, opportunity_flags });
const screen179 = (flags: OpportunityFlags) => evaluateRuleLibrary({ ...DEFAULT_PROFILE, opportunity_flags: flags }).find(result => result.rule_id === 'irc_179')!;

test('profile flag allowlist matches catalog conditions and excludes prototype keys', () => {
  const catalogFlags = [...new Set(RULE_LIBRARY.flatMap(rule => rule.conditions.map(condition => condition.flag)))].sort();
  assert.deepEqual([...OPPORTUNITY_FLAGS].sort(), catalogFlags);
  for (const flag of catalogFlags) assert.equal(isOpportunityFlag(flag), true);
  for (const key of ['__proto__', 'constructor', 'prototype', 'toString', 'unlisted_condition', '', null, 1]) {
    assert.equal(isOpportunityFlag(key), false);
  }
});

test('local HTTP PUT saves screening answers and a fresh engine and restarted server reload them', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tally-profile-flags-http-'));
  const dataPath = join(directory, 'state.json');
  const priorMode = process.env.TALLY_EXECUTION_MODE;
  process.env.TALLY_EXECUTION_MODE = 'fixture';
  let running: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    running = await startServer({ port: 0, dataPath, webOrigin: 'http://127.0.0.1:5173' });
    const flags = answersFor('irc_179');
    const response = await fetch(`${running.url}/api/profile`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expected_profile_rev: 0, profile: profileWith(flags) }),
    });
    assert.equal(response.status, 201);
    const saved = await response.json() as State;
    assert.equal(saved.profile_rev, 1);
    assert.deepEqual(saved.profile?.opportunity_flags, flags);
    const fresh = await new TallyEngine(new FileStore(dataPath)).state();
    assert.deepEqual(fresh.profile, saved.profile);
    assert.equal(fresh.profile_rev, 1);
    assert.deepEqual(evaluateRuleLibrary(fresh.profile).filter(result => result.status === 'potential_opportunity').map(result => result.rule_id), ['irc_179']);
    assert.ok(evaluateRuleLibrary(fresh.profile).every(result => !result.legal_claim_activated && !result.calculation_enabled));
    await delay(40); // Let the fixture-only scheduling callback finish before restart/cleanup.
    await running.close();
    running = undefined;
    running = await startServer({ port: 0, dataPath, webOrigin: 'http://127.0.0.1:5173' });
    const reloaded = await (await fetch(`${running.url}/api/state`)).json() as State;
    assert.deepEqual(reloaded.profile?.opportunity_flags, flags);
    assert.equal(reloaded.profile_rev, 1);
    await delay(40);
  } finally {
    if (running) await running.close();
    if (priorMode === undefined) delete process.env.TALLY_EXECUTION_MODE;
    else process.env.TALLY_EXECUTION_MODE = priorMode;
    await rm(directory, { recursive: true, force: true });
  }
});

test('legacy profile PUT stays valid and does not inject an omitted optional flags field', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tally-profile-flags-legacy-'));
  try {
    const dataPath = join(directory, 'state.json');
    const engine = new TallyEngine(new FileStore(dataPath));
    let enqueued = 0;
    const api = createApi({ engine, enqueue: async () => { enqueued++; } });
    const response = await api({ method: 'PUT', path: '/api/profile', rawBody: JSON.stringify({ expected_profile_rev: 0, profile: DEFAULT_PROFILE }) });
    assert.equal(response.status, 201);
    assert.equal(enqueued, 1);
    assert.equal(Object.hasOwn(validateProfile(DEFAULT_PROFILE), 'opportunity_flags'), false);
    const reloaded = await new TallyEngine(new FileStore(dataPath)).state();
    assert.deepEqual(reloaded.profile, DEFAULT_PROFILE);
    assert.equal(Object.hasOwn(reloaded.profile!, 'opportunity_flags'), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('no and unknown answers remain evidence requests rather than candidates', () => {
  const yes = answersFor('irc_179');
  assert.equal(screen179(yes).status, 'potential_opportunity');
  for (const answer of ['no', 'unknown'] as const) {
    for (const flag of Object.keys(yes)) {
      const result = screen179({ ...yes, [flag]: answer });
      assert.equal(result.status, 'needs_evidence', `${flag}=${answer}`);
      assert.ok(result.reasons.length > 0);
      assert.ok(result.missing_evidence.length > 0);
      assert.equal(result.legal_claim_activated, false);
      assert.equal(result.calculation_enabled, false);
    }
  }
});

test('invalid JSON flags return 422 without persisted mutation or queue work', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'tally-profile-flags-invalid-'));
  try {
    const dataPath = join(directory, 'state.json');
    const engine = new TallyEngine(new FileStore(dataPath));
    await engine.saveProfile(DEFAULT_PROFILE, 0);
    const before = await readFile(dataPath, 'utf8');
    let enqueued = 0;
    const api = createApi({ engine, enqueue: async () => { enqueued++; } });
    const firstFlag = OPPORTUNITY_FLAGS[0];
    assert.ok(firstFlag);
    const cases: [string, unknown, RuleAnswer?][] = [
      ['null', null], ['array', []], ['nested array', [answersFor('irc_179')]],
      ['string', 'yes'], ['boolean', true], ['number', 1],
      ...['YES', '', null, true, 1, {}, []].map((value, index): [string, unknown] => [`invalid answer ${index}`, { [firstFlag]: value }]),
      ['unknown key', { unlisted_condition: 'yes' }],
      ['prototype key', JSON.parse('{"__proto__":"yes"}')],
      ['constructor key', JSON.parse('{"constructor":"yes"}')],
      ['prototype property', JSON.parse('{"prototype":"yes"}')],
      ['health Unknown versus Yes', { health_benefits_offered: 'yes' }, 'unknown'],
      ['health Yes versus Unknown', { health_benefits_offered: 'unknown' }, 'yes'],
      ['health Yes versus No', { health_benefits_offered: 'no' }, 'yes'],
      ['health No versus Yes', { health_benefits_offered: 'yes' }, 'no'],
    ];
    for (const [name, flags, healthAnswer] of cases) await t.test(name, async () => {
      const response = await api({ method: 'PUT', path: '/api/profile', rawBody: JSON.stringify({ expected_profile_rev: 1, profile: { ...profileWith(flags), ...(healthAnswer ? { health_benefits_offered: healthAnswer } : {}) } }) });
      assert.equal(response.status, 422);
      assert.equal((response.body as { code: string }).code, 'INVALID_PROFILE');
      assert.equal(enqueued, 0);
      assert.equal(await readFile(dataPath, 'utf8'), before, 'Rejected input must not write the persisted file');
      const reloaded = await new TallyEngine(new FileStore(dataPath)).state();
      assert.equal(reloaded.profile_rev, 1);
      assert.deepEqual(reloaded.profile, DEFAULT_PROFILE);
      assert.equal(reloaded.jobs.length, 0);
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('direct validation rejects non-JSON descriptors and inherited flags without invoking accessors', () => {
  const flag = OPPORTUNITY_FLAGS[0];
  let reads = 0;
  const inherited = Object.create({ [flag]: 'yes' });
  const customPrototype = Object.assign(Object.create({ custom: true }), { [flag]: 'yes' });
  const symbol = { [flag]: 'yes', [Symbol('hidden')]: 'yes' };
  const nonenumerable = Object.defineProperty({}, flag, { value: 'yes', enumerable: false });
  const accessor = Object.defineProperty({}, flag, { get: () => { reads++; return 'yes'; }, enumerable: true });
  for (const flags of [inherited, customPrototype, symbol, nonenumerable, accessor]) assert.throws(() => validateProfile(profileWith(flags)));
  assert.equal(reads, 0);
  const inheritedProfile = Object.assign(Object.create({ opportunity_flags: answersFor('irc_179') }), DEFAULT_PROFILE);
  assert.throws(() => validateProfile(inheritedProfile));
  const flagsAccessorProfile = Object.defineProperty({ ...DEFAULT_PROFILE }, 'opportunity_flags', { get: () => { reads++; return answersFor('irc_179'); }, enumerable: true });
  assert.throws(() => validateProfile(flagsAccessorProfile));
  assert.equal(reads, 0);
  const nullPrototype = Object.assign(Object.create(null), answersFor('irc_179'));
  assert.deepEqual(validateProfile(profileWith(nullPrototype)).opportunity_flags, answersFor('irc_179'), 'Own JSON data on a null-prototype map remains supported');
});

test('library screening ignores inherited answers and flag accessors', () => {
  const yes = answersFor('irc_179');
  assert.equal(screen179(Object.create(yes)).status, 'needs_evidence');
  let reads = 0;
  const accessorFlags = Object.fromEntries(Object.keys(yes).map(flag => [flag, 'yes']));
  Object.defineProperty(accessorFlags, Object.keys(yes)[0], { get: () => { reads++; return 'yes'; }, enumerable: true });
  assert.equal(screen179(accessorFlags as OpportunityFlags).status, 'needs_evidence');
  assert.equal(reads, 0);
  const inheritedContainer = Object.assign(Object.create({ opportunity_flags: yes }), DEFAULT_PROFILE);
  assert.equal(evaluateRuleLibrary(inheritedContainer).find(result => result.rule_id === 'irc_179')?.status, 'needs_evidence');
});

test('contradictory health answers stay unresolved, and screening flags cannot confirm annual health evidence', async () => {
  const healthFlags = answersFor('irc_45r');
  for (const [health_benefits_offered, flagAnswer] of [['yes', 'no'], ['no', 'yes'], ['unknown', 'yes'], ['yes', 'unknown']] as const) {
    const profile = { ...DEFAULT_PROFILE, health_benefits_offered, opportunity_flags: { ...healthFlags, health_benefits_offered: flagAnswer } };
    assert.throws(() => validateProfile(profile), /Health benefits screening answer must match/);
    assert.equal(evaluateRuleLibrary(profile).find(result => result.rule_id === 'irc_45r')?.status, 'needs_evidence', 'Unvalidated legacy conflicts must not become candidates');
  }
  for (const answer of ['yes', 'no', 'unknown'] as const) {
    const profile = validateProfile({ ...DEFAULT_PROFILE, health_benefits_offered: answer, opportunity_flags: { ...healthFlags, health_benefits_offered: answer } });
    assert.equal(profile.opportunity_flags?.health_benefits_offered, answer);
    assert.equal(evaluateRuleLibrary(profile).find(result => result.rule_id === 'irc_45r')?.status, answer === 'yes' ? 'potential_opportunity' : 'needs_evidence');
  }
  const allYes = Object.fromEntries(OPPORTUNITY_FLAGS.map(flag => [flag, 'yes']));
  const engine = new TallyEngine(new MemoryStore());
  const api = createApi({ engine, enqueue: async () => {} });
  const response = await api({ method: 'PUT', path: '/api/profile', rawBody: JSON.stringify({ expected_profile_rev: 0, profile: profileWith(allYes) }) });
  assert.equal(response.status, 201);
  await engine.analyze(['fixture-A', 'fixture-B']);
  await engine.processAll();
  const state = await engine.state();
  assert.equal(state.profile?.owner_on_payroll, 'unknown');
  assert.equal(state.profile?.family_on_payroll, 'unknown');
  assert.equal(state.opportunity?.annual_requirements.length, 8);
  assert.ok(state.opportunity?.annual_requirements.every(requirement => requirement.result === 'unknown'));
  assert.equal(state.opportunity?.estimate.amount_cents, null);
  assert.equal(state.opportunity?.evidence_checks.find(check => check.requirement_id === 'payment_to_coverage_match')?.result, 'unknown');
});
