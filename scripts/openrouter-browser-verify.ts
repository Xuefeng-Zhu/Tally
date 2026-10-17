import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import type { State } from '../packages/contracts/index.js';

const webUrl = 'http://127.0.0.1:5206';
const apiUrl = 'http://127.0.0.1:4346';
const artifacts = resolve(process.env.TALLY_ARTIFACTS_DIR ?? '.artifacts/openrouter');
await mkdir(artifacts, { recursive: true });
const checks: string[] = [], pageErrors: string[] = [], externalRequests: string[] = [];
const state = async (): Promise<State> => {
  const response = await fetch(`${apiUrl}/api/state`); assert.equal(response.status, 200);
  return response.json() as Promise<State>;
};
const waitState = async (predicate: (s: State) => boolean): Promise<State> => {
  const deadline = Date.now() + 45_000;
  do { const s = await state(); if (predicate(s)) return s; await delay(150); } while (Date.now() < deadline);
  throw new Error('ISOLATED_STATE_WAIT_TIMEOUT');
};
const browser = await chromium.launch({ headless: true });
let outcome = 'failed';
try {
  const initial = await state(); assert.equal(initial.profile_rev, 0); assert.equal(initial.documents.length, 0);
  checks.push('Fresh isolated profile and document state');
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (['127.0.0.1', 'localhost'].includes(url.hostname) || ['data:', 'blob:'].includes(url.protocol)) await route.continue();
    else { externalRequests.push(`${url.origin}${url.pathname}`); await route.abort(); }
  });
  const page = await context.newPage(); page.on('pageerror', e => pageErrors.push(e.message));
  await page.goto(webUrl); await page.waitForLoadState('networkidle');
  await page.getByTestId('nav-settings').click(); await page.getByTestId('settings-business').click();
  await page.getByTestId('profile-save').click(); await waitState(s => s.profile_rev === 1);
  checks.push('Synthetic bakery profile saved through browser');
  await page.getByTestId('open-sample-settings').click(); await page.getByTestId('fixture-A').click();
  const a = await waitState(s => s.opportunity?.stage === 'needs_coverage_statement' && s.pending_evaluation === null);
  await writeFile(resolve(artifacts, 'after-a.json'), JSON.stringify(a, null, 2));
  assert.equal(a.execution.extraction_mode, 'fixture'); assert.equal(a.execution.explanation_mode, 'live_openrouter');
  assert.equal(a.documents.length, 1); assert.equal(a.facts.length, 5);
  checks.push('First synthetic intake: five fixture facts, coverage needed, validated real OpenRouter explanation');
  const id = a.opportunity!.opportunity_id;
  await page.getByTestId('nav-opportunity').click();
  const card = page.getByTestId('opportunity-card'); await card.waitFor();
  await page.locator('.validated-summary').filter({ hasText: a.opportunity!.summary }).waitFor();
  await page.getByText('About this review', { exact: true }).click();
  await page.getByText(/Sample document analysis · OpenRouter explanation/).waitFor();
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo({ top: 0, behavior: 'instant' }); });
  await page.screenshot({ path: resolve(artifacts, '01-after-a.png'), fullPage: true, animations: 'disabled' });
  checks.push('Browser shows actual model summary and separate fixture/OpenRouter provenance');
  await page.getByTestId('open-sample-settings').click(); await page.getByTestId('fixture-B').click();
  const b = await waitState(s => s.opportunity?.stage === 'evidence_updated' && s.pending_evaluation === null);
  await writeFile(resolve(artifacts, 'after-b.json'), JSON.stringify(b, null, 2));
  assert.equal(b.execution.explanation_mode, 'live_openrouter'); assert.equal(b.execution.extraction_mode, 'fixture');
  assert.equal(b.opportunity!.opportunity_id, id); assert.equal(b.opportunity!.revision, a.opportunity!.revision + 1);
  assert.equal(b.ledger_rev, a.ledger_rev + 1); assert.equal(b.documents.length, 2); assert.equal(b.facts.length, 11);
  assert.equal(b.opportunity!.reported_employer_share_basis_points, 8000);
  assert.equal(b.opportunity!.estimate.amount_cents, null);
  assert.equal(b.opportunity!.evidence_checks.find(c => c.requirement_id === 'payment_to_coverage_match')?.result, 'unknown');
  assert.ok(b.opportunity!.annual_requirements.every(c => c.result === 'unknown'));
  checks.push('Second intake updates same opportunity and revision; 80% stated share; annual checks and payment match unresolved; no credit estimate');
  await page.getByTestId('nav-opportunity').click(); await page.locator('.validated-summary').filter({ hasText: b.opportunity!.summary }).waitFor();
  assert.equal(await card.count(), 1); assert.equal(await card.getAttribute('data-opportunity-id'), id);
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo({ top: 0, behavior: 'instant' }); });
  await page.screenshot({ path: resolve(artifacts, '02-after-b.png'), fullPage: true, animations: 'disabled' });
  await page.getByTestId('opportunity-evidence').click(); await page.getByTestId('evidence-link').first().waitFor();
  const links = page.getByTestId('evidence-link'); const urls = new Set<string>();
  for (const link of await links.all()) urls.add(new URL((await link.getAttribute('href'))!, webUrl).href);
  assert.equal(urls.size, 2);
  for (const url of urls) { const response = await page.request.get(url); assert.equal(response.status(), 200); assert.match(response.headers()['content-type'], /pdf/); }
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo({ top: 0, behavior: 'instant' }); });
  await page.screenshot({ path: resolve(artifacts, '03-evidence.png'), fullPage: true, animations: 'disabled' });
  checks.push('Both actual local synthetic source PDFs accessible from browser evidence links');
  await page.getByTestId('opportunity-requirements').click(); await page.getByTestId('annual-requirements').waitFor();
  assert.equal(await page.locator('[data-requirement-id]').count(), 8);
  await page.reload(); await page.waitForLoadState('networkidle');
  const reload = await state(); assert.equal(reload.opportunity!.revision, b.opportunity!.revision); assert.equal(reload.opportunity!.summary, b.opportunity!.summary);
  checks.push('Reload preserves opportunity revision and real model summary');
  await page.getByTestId('open-sample-settings').click(); await page.getByTestId('fixture-B').click(); await delay(700);
  const duplicate = await state(); assert.equal(duplicate.ledger_rev, b.ledger_rev); assert.equal(duplicate.opportunity!.revision, b.opportunity!.revision);
  const receipts = JSON.parse(await readFile(resolve(artifacts, 'openrouter-receipts.json'), 'utf8'));
  assert.equal(receipts.length, 2); assert.ok(receipts.every((r: { mode: string }) => r.mode === 'live_openrouter'));
  checks.push('Duplicate second intake creates no extra facts, card revision, or OpenRouter call');
  await page.getByTestId('nav-settings').click(); await page.getByTestId('settings-connections').click(); await page.getByText(/The last explanation used OpenRouter/).waitFor();
  checks.push('Connections identifies OpenRouter');
  await page.setViewportSize({ width: 390, height: 844 }); await page.getByTestId('nav-opportunity').click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo({ top: 0, behavior: 'instant' }); });
  await page.screenshot({ path: resolve(artifacts, '04-mobile.png'), fullPage: true, animations: 'disabled' });
  assert.deepEqual(pageErrors, []); assert.deepEqual(externalRequests, []);
  checks.push('390px browser layout has no horizontal overflow; zero page errors or external browser requests');
  outcome = 'passed'; console.log(JSON.stringify({ outcome, checks: checks.length, artifacts }));
} catch (error) {
  await writeFile(resolve(artifacts, 'browser-failure.json'), JSON.stringify({ code: error instanceof Error ? error.message : 'BROWSER_VERIFICATION_FAILED', checks }, null, 2));
  throw error;
} finally {
  await writeFile(resolve(artifacts, 'browser-result.json'), JSON.stringify({ capturedAt: new Date().toISOString(), outcome, boundary: 'real OpenRouter inference; synthetic fixture intake/extraction; no Box/AWS E2E', checks, pageErrors, externalRequests, recording: false }, null, 2));
  await browser.close();
}
