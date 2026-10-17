import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import type { State } from '../packages/contracts/index.js';

// Run only against a separate local fixture pair with fresh TALLY_DATA_PATH.
const webUrl = process.env.TALLY_WEB_URL ?? 'http://127.0.0.1:5174';
const apiUrl = process.env.TALLY_API_URL ?? 'http://127.0.0.1:4319';
for (const value of [webUrl,apiUrl]) {
  const url = new URL(value);
  assert.ok(['127.0.0.1','localhost'].includes(url.hostname) && url.protocol === 'http:', 'Capture must use loopback HTTP only');
}
const artifacts = resolve(process.env.TALLY_ARTIFACTS_DIR ?? '.artifacts/review');
const errors: string[] = [];
const blockedExternal: string[] = [];
const states: Record<string, {profile_rev:number;ledger_rev:number;stage:string|null;opportunity_id:string|null;annual_unknown_count:number}> = {};
async function state(): Promise<State> {
  const response = await fetch(`${apiUrl}/api/state`);
  assert.equal(response.status,200);
  const body = await response.json();
  return body.state ?? body;
}
function record(label:string,value:State) {
  states[label] = {profile_rev:value.profile_rev,ledger_rev:value.ledger_rev,stage:value.opportunity?.stage??null,opportunity_id:value.opportunity?.opportunity_id??null,annual_unknown_count:value.opportunity?.annual_requirements.filter(check=>check.result==='unknown').length??0};
}
async function waitForState(predicate:(value:State)=>boolean):Promise<State> {
  const end=Date.now()+20_000;
  do {const current=await state();if(predicate(current))return current;await delay(150);} while(Date.now()<end);
  throw new Error('Timed out waiting for the required fixture capture state');
}
const initial = await state();
assert.equal(initial.profile_rev,0,'Capture requires a fresh isolated state file; do not use .data/state.json');
assert.equal(initial.documents.length,0);
await mkdir(artifacts,{recursive:true});
const browser = await chromium.launch({headless:true});
try {
  const page = await browser.newPage({viewport:{width:1440,height:1024},deviceScaleFactor:1});
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(['127.0.0.1','localhost'].includes(url.hostname) || ['data:','blob:'].includes(url.protocol))await route.continue();
    else {blockedExternal.push(`${url.protocol}//${url.hostname}${url.pathname}`);await route.abort('blockedbyclient');}
  });
  await page.goto(webUrl);
  await page.waitForLoadState('networkidle');
  await page.getByTestId('profile-save').waitFor({state:'visible'});
  record('empty',initial);
  assert.equal(await page.getByTestId('opportunity-card').count(),0);
  await page.screenshot({path:resolve(artifacts,'01-empty-desktop.png'),fullPage:true});
  await page.getByTestId('profile-save').click();
  record('profile_saved',await waitForState(value=>value.profile_rev===1));
  await page.getByRole('button',{name:/Context saved/}).waitFor({state:'visible'});
  assert.equal(await page.getByTestId('opportunity-card').count(),0);
  await page.screenshot({path:resolve(artifacts,'02-context-saved-desktop.png'),fullPage:true});
  await page.getByTestId('fixture-A').click();
  const a = await waitForState(value=>value.opportunity?.stage==='needs_coverage_statement');
  record('fixture_a',a);
  await page.getByRole('button',{name:/Upload coverage statement/}).waitFor({state:'visible'});
  await page.screenshot({path:resolve(artifacts,'03-fixture-a-desktop.png'),fullPage:true});
  await page.getByTestId('fixture-B').click();
  const b = await waitForState(value=>value.opportunity?.stage==='evidence_updated');
  record('fixture_b',b);
  assert.equal(b.opportunity!.opportunity_id,a.opportunity!.opportunity_id);
  assert.equal(b.opportunity!.annual_requirements.filter(check=>check.result==='unknown').length,8);
  assert.equal(b.opportunity!.reported_employer_share_basis_points,8000);
  await page.getByRole('button',{name:/Review remaining requirements/}).click();
  await page.getByTestId('annual-requirements').waitFor({state:'visible'});
  await page.getByText('Inspect the evidence',{exact:false}).click();
  await page.getByTestId('evidence-link').first().waitFor({state:'visible'});
  await page.screenshot({path:resolve(artifacts,'04-fixture-b-expanded-desktop.png'),fullPage:true});
  await page.locator('.evidence-panel').screenshot({path:resolve(artifacts,'06-evidence-detail-desktop.png')});
  await page.getByTestId('remaining-requirements').screenshot({path:resolve(artifacts,'07-annual-unknowns-desktop.png')});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  await page.screenshot({path:resolve(artifacts,'05-fixture-b-expanded-mobile.png'),fullPage:true});
  await page.getByTestId('remaining-requirements').screenshot({path:resolve(artifacts,'08-annual-unknowns-mobile.png')});
  assert.deepEqual(errors,[]);
  assert.deepEqual(blockedExternal,[],'The local fixture app should request no external resources');
  await writeFile(resolve(artifacts,'capture-manifest.json'),JSON.stringify({captured_at:new Date().toISOString(),runtime:process.version,mode:'local_fixture',synthetic_data:true,original_bundle_status:'not_obtained_or_read',web_url:webUrl,api_url:apiUrl,states,browser_errors:errors,external_requests:blockedExternal},null,2));
  console.log(`Review screenshots saved to ${artifacts}`);
} finally { await browser.close(); }
