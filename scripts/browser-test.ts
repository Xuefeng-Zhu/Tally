import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, type Page } from 'playwright';
import { ANNUAL_IDS, emptyState, type State } from '../packages/contracts/index.js';

const webUrl = process.env.TALLY_WEB_URL ?? 'http://127.0.0.1:5173';
const apiUrl = process.env.TALLY_API_URL ?? 'http://127.0.0.1:4318';
for (const value of [webUrl, apiUrl]) {
  const url = new URL(value);
  assert.ok(url.protocol === 'http:' && ['127.0.0.1','localhost'].includes(url.hostname), 'Browser QA must use local HTTP origins.');
}
const artifacts = resolve(process.env.TALLY_ARTIFACTS_DIR ?? '.artifacts/redesign');
const errors: string[] = [];
const external: string[] = [];
const captures: string[] = [];
async function state(): Promise<State> {
  const response = await fetch(`${apiUrl}/api/state`);
  assert.equal(response.status, 200);
  const body = await response.json();
  return body.state ?? body;
}
async function waitForState(predicate: (value: State) => boolean): Promise<State> {
  const deadline = Date.now() + 20_000;
  do { const current = await state(); if (predicate(current)) return current; await delay(150); } while (Date.now() < deadline);
  throw new Error('Timed out waiting for the fixture state.');
}
async function screenshot(page: Page, name: string) {
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo({ top: 0, behavior: 'instant' }); });
  await page.screenshot({ path: resolve(artifacts, name), fullPage: true, animations: 'disabled' });
  captures.push(name);
}
async function noOverflow(page: Page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, 'Layout should not overflow horizontally.');
}
async function noSampleControls(page: Page) {
  assert.equal(await page.getByTestId('fixture-A').count(), 0, 'Sample controls belong only in Settings / Sample workspace.');
  assert.equal(await page.getByTestId('fixture-B').count(), 0);
}
async function verifyPdfLinks(page: Page) {
  const links = page.getByTestId('evidence-link');
  assert.ok(await links.count() > 0);
  const urls = new Set<string>();
  for (const link of await links.all()) {
    const href = await link.getAttribute('href'); assert.ok(href);
    urls.add(new URL(href, webUrl).href);
  }
  for (const url of urls) {
    const response = await page.request.get(url);
    assert.equal(response.status(), 200, `Evidence URL ${url}`);
    assert.match(response.headers()['content-type'] ?? '', /pdf/i);
  }
}
const initial = await state();
assert.equal(initial.profile_rev, 0, 'Use a fresh isolated TALLY_DATA_PATH. This test changes only its selected local fixture state.');
assert.equal(initial.documents.length, 0);
assert.equal(initial.execution.intake_mode, 'fixture', 'This browser journey is restricted to fixture execution.');
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (['127.0.0.1','localhost'].includes(url.hostname) || ['data:','blob:'].includes(url.protocol)) await route.continue();
    else { external.push(`${url.protocol}//${url.hostname}${url.pathname}`); await route.abort(); }
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(webUrl); await page.waitForLoadState('networkidle');
  await page.getByTestId('overview-page').waitFor({ state: 'visible' });
  await noSampleControls(page);
  await screenshot(page, '01-overview-empty-desktop.png');
  await page.getByTestId('nav-documents').click();
  await page.getByTestId('documents-page').waitFor({ state: 'visible' });
  await noSampleControls(page);
  await screenshot(page, '02-documents-empty-desktop.png');
  await page.getByTestId('nav-settings').click();
  await page.getByTestId('settings-business').click();
  await page.getByTestId('profile-save').waitFor({ state: 'visible' });
  await noSampleControls(page);
  await screenshot(page, '03-settings-business-desktop.png');
  await page.getByTestId('profile-save').click();
  await waitForState(value => value.profile_rev === 1);
  await page.getByTestId('open-sample-settings').click();
  await page.getByTestId('fixture-A').waitFor({ state: 'visible' });
  await screenshot(page, '04-settings-samples-desktop.png');
  await page.getByTestId('fixture-A').click();
  const a = await waitForState(value => value.opportunity?.stage === 'needs_coverage_statement');
  const id = a.opportunity!.opportunity_id;
  await page.getByTestId('nav-opportunity').click();
  await page.getByTestId('opportunity-card').waitFor({ state: 'visible' });
  await page.getByTestId('nav-overview').click();
  await page.getByTestId('overview-page').waitFor({ state: 'visible' });
  await noSampleControls(page);
  await screenshot(page, '05-overview-after-a-desktop.png');
  await page.getByTestId('nav-opportunity').click();
  const card = page.getByTestId('opportunity-card');
  await card.waitFor({ state: 'visible' });
  assert.equal(await card.getAttribute('data-opportunity-id'), id);
  await page.getByTestId('opportunity-summary').click();
  await page.getByTestId('primary-action').click();
  await page.getByTestId('documents-page').waitFor({ state: 'visible' });
  await page.getByTestId('document-row-fixture-A').waitFor({ state: 'visible' });
  await noSampleControls(page);
  await page.getByTestId('nav-opportunity').click();
  await page.getByTestId('opportunity-evidence').click();
  await page.getByTestId('evidence-link').first().waitFor({ state: 'visible' });
  await verifyPdfLinks(page);
  await screenshot(page, '06-opportunity-evidence-a-desktop.png');
  await page.getByTestId('open-sample-settings').click();
  await page.getByTestId('fixture-B').click();
  const b = await waitForState(value => value.opportunity?.stage === 'evidence_updated');
  assert.equal(b.opportunity!.opportunity_id, id);
  assert.equal(b.opportunity!.reported_employer_share_basis_points, 8000);
  assert.equal(b.opportunity!.estimate.amount_cents, null);
  assert.equal(b.opportunity!.evidence_checks.find(check => check.requirement_id === 'payment_to_coverage_match')?.result, 'unknown');
  await page.getByTestId('nav-opportunity').click();
  await page.getByTestId('opportunity-summary').click();
  await page.getByTestId('primary-action').filter({ hasText: 'Review annual requirements' }).waitFor({ state: 'visible' });
  await page.getByTestId('nav-overview').click();
  await screenshot(page, '07-overview-updated-desktop.png');
  await noSampleControls(page);
  await page.getByTestId('nav-documents').click();
  for (const file of ['fixture-A','fixture-B']) await page.getByTestId(`document-row-${file}`).waitFor({ state: 'visible' });
  await page.getByTestId('document-row-fixture-B').click();
  await page.getByTestId('document-detail').waitFor({ state: 'visible' });
  const sourceHref = await page.getByTestId('document-source-link').getAttribute('href');
  assert.ok(sourceHref);
  assert.equal((await page.request.get(new URL(sourceHref, webUrl).href)).status(), 200);
  await screenshot(page, '08-documents-inbox-desktop.png');
  await page.getByTestId('nav-opportunity').click();
  await card.waitFor({ state: 'visible' });
  assert.equal(await page.getByTestId('opportunity-card').count(), 1);
  assert.equal(await card.getAttribute('data-opportunity-id'), id);
  await page.getByTestId('opportunity-summary').click();
  await screenshot(page, '09-opportunity-summary-desktop.png');
  await page.getByTestId('primary-action').click();
  const requirements = page.getByTestId('annual-requirements');
  await requirements.waitFor({ state: 'visible' });
  assert.deepEqual(b.opportunity!.annual_requirements.map(check => check.requirement_id).sort(), [...ANNUAL_IDS].sort());
  assert.ok(b.opportunity!.annual_requirements.every(check => check.result === 'unknown'));
  for (const requirement of ANNUAL_IDS) {
    const row = requirements.locator(`[data-requirement-id="${requirement}"]`);
    await row.waitFor({ state: 'visible' }); assert.match(await row.innerText(), /unknown/i);
  }
  await screenshot(page, '10-opportunity-requirements-desktop.png');
  await page.getByTestId('opportunity-evidence').click();
  await verifyPdfLinks(page);
  await screenshot(page, '11-opportunity-evidence-desktop.png');
  await page.reload(); await page.waitForLoadState('networkidle');
  const refreshed = await state();
  assert.equal(refreshed.profile_rev, 1);
  assert.equal(refreshed.opportunity?.opportunity_id, id);
  assert.equal(refreshed.opportunity?.revision, b.opportunity!.revision);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId('nav-overview').click(); await noOverflow(page);
  const sampleIndicatorVisible = await page.locator('.sample-indicator').evaluate(element => { const box = element.getBoundingClientRect(); const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2); return box.width > 0 && box.height > 0 && (element === hit || element.contains(hit)); });
  assert.equal(sampleIndicatorVisible, true, 'The mobile sample label must remain visible above the header.');
  await screenshot(page, '12-overview-mobile.png');
  await page.getByTestId('nav-documents').click();
  await page.getByTestId('document-row-fixture-B').click();
  await page.getByTestId('document-detail').waitFor({ state: 'visible' });
  await noOverflow(page);
  await screenshot(page, '13-documents-mobile.png');
  await page.getByTestId('nav-opportunity').click();
  await page.getByTestId('opportunity-requirements').click(); await noOverflow(page);
  await requirements.waitFor({ state: 'visible' });
  await screenshot(page, '14-opportunity-requirements-mobile.png');
  await page.getByTestId('nav-settings').click(); await page.getByTestId('settings-business').click(); await noOverflow(page);
  await screenshot(page, '15-settings-mobile.png');
  await context.close();

  // Render pending/error responses locally without changing persistent fixture state.
  for (const mode of ['loading','error'] as const) {
    const mockContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    let release: () => void = () => {};
    const gate = new Promise<void>(done => { release = done; });
    await mockContext.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (!['127.0.0.1','localhost'].includes(url.hostname)) { external.push(url.href); await route.abort(); return; }
      if (url.pathname === '/api/state') {
        if (mode === 'loading') await gate;
        await route.fulfill({ status: mode === 'error' ? 503 : 200, contentType: 'application/json', body: JSON.stringify(mode === 'error' ? {code:'LOCAL_QA_UNAVAILABLE',message:'The local service is unavailable. Please try again.',correlation_id:'redesign-local-qa',retryable:true} : emptyState()) });
      } else await route.continue();
    });
    const mockPage = await mockContext.newPage();
    mockPage.on('pageerror', error => errors.push(error.message));
    await mockPage.goto(webUrl, { waitUntil: 'domcontentloaded' });
    await mockPage.getByTestId(mode === 'loading' ? 'workspace-loading' : 'workspace-error').waitFor({ state: 'visible' });
    await screenshot(mockPage, mode === 'loading' ? '16-loading-desktop.png' : '17-error-desktop.png');
    release();
    if (mode === 'loading') await mockPage.waitForLoadState('networkidle');
    await mockContext.close();
  }
  assert.deepEqual(errors, [], 'Browser runtime errors');
  assert.deepEqual(external, [], 'The local fixture app must request no external resources.');
  await writeFile(resolve(artifacts, 'redesign-manifest.json'), JSON.stringify({captured_at:new Date().toISOString(),runtime:process.version,synthetic_data:true,mode:'isolated_local_fixture',original_bundle_status:'not_obtained_or_read',opportunity_id:id,profile_rev:b.profile_rev,ledger_rev:b.ledger_rev,annual_unknowns:8,browser_errors:errors,external_requests:external,captures},null,2));
  console.log(`Product browser flow passed. ${captures.length} screenshots: ${artifacts}`);
} finally { await browser.close(); }
