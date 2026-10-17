import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { ANNUAL_IDS, type State } from '../packages/contracts';

const webUrl = process.env.TALLY_WEB_URL ?? 'http://127.0.0.1:5173';
const apiUrl = process.env.TALLY_API_URL ?? 'http://127.0.0.1:4318';
const artifacts = resolve(process.env.TALLY_ARTIFACTS_DIR ?? '.artifacts/browser');
async function state(): Promise<State> {
  const response = await fetch(`${apiUrl}/api/state`);
  assert.equal(response.status, 200);
  const body = await response.json();
  return body.state ?? body;
}
async function waitForState(predicate: (value: State) => boolean): Promise<State> {
  const end = Date.now() + 20_000;
  do {
    const current = await state();
    if (predicate(current)) return current;
    await delay(150);
  } while (Date.now() < end);
  throw new Error('Timed out waiting for the expected fixture state');
}

const initial = await state();
assert.equal(initial.profile_rev, 0, 'Use a fresh isolated TALLY_DATA_PATH for browser QA; the script changes local demo state.');
assert.equal(initial.documents.length, 0);
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors: string[] = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1024 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(webUrl);
  await page.waitForLoadState('networkidle');
  await page.getByTestId('profile-save').click();
  await waitForState(value => value.profile_rev === 1);
  await page.getByTestId('fixture-A').click();
  const a = await waitForState(value => value.opportunity?.stage === 'needs_coverage_statement');
  const id = a.opportunity!.opportunity_id;
  const card = page.getByTestId('opportunity-card');
  await card.waitFor({ state: 'visible' });
  assert.equal(await card.getAttribute('data-opportunity-id'), id);
  await page.getByTestId('primary-action').click();
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'fixture-controls');
  // In local fixture mode the UI directs the user to fixture intake when no external destination is configured.
  await page.getByTestId('fixture-B').click();
  const b = await waitForState(value => value.opportunity?.stage === 'evidence_updated');
  assert.equal(b.opportunity!.opportunity_id, id);
  assert.equal(b.opportunity!.reported_employer_share_basis_points, 8000);
  assert.equal(await page.getByTestId('opportunity-card').count(), 1);
  assert.equal(await card.getAttribute('data-opportunity-id'), id);
  await page.getByRole('button', { name: /Review remaining requirements/ }).click();
  await page.getByTestId('annual-requirements').waitFor({ state: 'visible' });
  assert.deepEqual(b.opportunity!.annual_requirements.map(check => check.requirement_id).sort(), [...ANNUAL_IDS].sort());
  assert.ok(b.opportunity!.annual_requirements.every(check => check.result === 'unknown'));
  const requirements = page.getByTestId('annual-requirements');
  for (const requirement of ANNUAL_IDS) {
    const row = requirements.locator(`[data-requirement-id="${requirement}"]`);
    await row.waitFor({ state: 'visible' });
    assert.match(await row.innerText(), /unknown/i);
  }
  await page.getByText('Inspect the evidence', { exact: false }).click();
  const links = page.getByTestId('evidence-link');
  assert.ok(await links.count() >= 2, 'Both fixture documents must have usable evidence links');
  const urls = new Set<string>();
  for (const link of await links.all()) {
    const href = await link.getAttribute('href');
    assert.ok(href);
    urls.add(new URL(href, webUrl).href);
  }
  for (const url of urls) {
    const response = await page.request.get(url);
    assert.equal(response.status(), 200, `Evidence URL ${url}`);
    assert.match(response.headers()['content-type'] ?? '', /pdf/i);
  }
  await page.screenshot({ path: resolve(artifacts, 'desktop-a-then-b.png'), fullPage: true });
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.getByTestId('opportunity-card').waitFor({ state: 'visible' });
  const refreshed = await state();
  assert.equal(refreshed.opportunity?.opportunity_id, id);
  assert.equal(refreshed.opportunity?.revision, b.opportunity!.revision);
  assert.equal(refreshed.profile_rev, 1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(artifacts, 'mobile-a-then-b.png'), fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  assert.equal(overflow, false, 'Mobile layout should not overflow horizontally');
  assert.deepEqual(errors, [], 'Browser runtime errors');
  console.log(`Browser fixture flow passed. Screenshots: ${artifacts}`);
} finally {
  await browser.close();
}
