import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_PROFILE } from '../packages/contracts/index.js';
import { RULE_LIBRARY } from '../packages/rules/library.js';
import { RuleLibraryPage } from '../apps/web/src/RuleLibraryPage.js';
import { RuleLibraryEntry } from '../apps/web/src/RuleLibraryEntry.js';
import { filterLibrary, libraryEntries, officialRuleSource } from '../apps/web/src/ruleLibraryPresentation.js';

const noop = () => {};
const page = (profile: typeof DEFAULT_PROFILE | null = DEFAULT_PROFILE) => renderToStaticMarkup(createElement(RuleLibraryPage, { profile, onReviewHealthCredit: noop, onEditProfile: noop }));

test('library renders ten distinct rules without turning them into ten assessed opportunities', () => {
  const html = page();
  assert.equal((html.match(/data-testid="library-rule"/g) ?? []).length, 10);
  for (const rule of RULE_LIBRARY) assert.ok(html.includes(`data-rule-id="${rule.id}"`), rule.id);
  assert.match(html, /Explore 10 federal tax rules/);
  assert.match(html, /9 rules have offline profile checks only/);
  assert.equal((html.match(/>Not determined</g) ?? []).length, 10);
  assert.equal((html.match(/>Not verified</g) ?? []).length, 10);
  assert.doesNotMatch(html, /class="opportunity-preview"|class="opportunity-card"|refund estimate|\$[0-9]/i);
});

test('a missing profile keeps the library readable and all checks unresolved', () => {
  const html = page(null), entries = libraryEntries(null);
  assert.equal(entries.length, 10);
  assert.ok(entries.every(entry => entry.screening.status === 'needs_evidence'));
  assert.match(html, /Add business profile/);
  assert.match(html, /Add a profile to guide the checks/);
  assert.doesNotMatch(html, /Potential fit/);
});

test('credits and deductions filter independently, and evidence search retains only matching rules', () => {
  const entries = libraryEntries(DEFAULT_PROFILE);
  const credits = filterLibrary(entries, '', 'credit'), deductions = filterLibrary(entries, '', 'deduction');
  assert.ok(credits.length > 0 && deductions.length > 0);
  assert.equal(credits.length + deductions.length, 10);
  assert.ok(credits.every(entry => entry.rule.type === 'credit'));
  assert.ok(deductions.every(entry => entry.rule.type === 'deduction'));
  const text = RULE_LIBRARY[0].missing_evidence[0];
  const matches = filterLibrary(entries, `  ${text.toUpperCase()}  `, 'all');
  assert.ok(matches.some(entry => entry.rule.id === RULE_LIBRARY[0].id));
  assert.equal(filterLibrary(entries, 'no-such-rule-or-evidence', 'all').length, 0);
});

test('owner-level rules retain their claimant and entity qualifications', () => {
  const entry = libraryEntries(DEFAULT_PROFILE).find(entry => entry.rule.claimant === 'owner');
  assert.ok(entry);
  const html = renderToStaticMarkup(createElement(RuleLibraryEntry, { entry, index: 0, onReviewHealthCredit: noop }));
  assert.match(html, /Owner’s return|Owner&#x27;s return/);
  assert.match(html, /Claimed by the owner/);
  assert.ok(html.includes(entry.rule.claimant_note));
  assert.ok(html.includes(entry.rule.scope_note));
  assert.doesNotMatch(html, /s_corporation|sole_proprietorship|c_corporation/);
  assert.match(html, /Professional review/);
  assert.match(html, />Pending</);
});

test('source editions and notes distinguish evergreen and older current-revision guidance', () => {
  const html = page();
  assert.match(html, /Official sources/);
  assert.doesNotMatch(html, /Official 2025 sources/);
  assert.match(html, /Evergreen guidance/);
  assert.match(html, /Current revision/);
  for (const rule of RULE_LIBRARY) for (const source of rule.sources) {
    if (source.notes) assert.ok(html.includes(source.notes.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll("'", '&#x27;')), source.title);
    assert.ok(officialRuleSource(source.url), source.url);
  }
});

test('only the existing health-credit rule links into the document workflow', () => {
  const html = page();
  assert.equal((html.match(/Open health credit workflow/g) ?? []).length, 1);
  assert.equal((html.match(/Sample document workflow tested/g) ?? []).length, 1);
  assert.equal((html.match(/Profile screening only/g) ?? []).length, 9);
  assert.equal((html.match(/>Offline profile checks only</g) ?? []).length, 9);
});

test('official source links reject unsafe schemes, credentials and lookalike domains', () => {
  assert.equal(officialRuleSource('https://www.irs.gov/instructions/i8941'), 'https://www.irs.gov/instructions/i8941');
  for (const value of ['javascript:alert(1)', 'http://www.irs.gov', 'https://irs.gov.evil.test/rule', 'https://irs.gov@evil.test/rule', 'https://user@www.irs.gov/rule', 'https://www.irs.gov:8443/rule']) assert.equal(officialRuleSource(value), null);
});
