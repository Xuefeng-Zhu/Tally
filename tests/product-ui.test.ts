import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_PROFILE, type State } from '../packages/contracts/index.js';
import { TallyEngine } from '../services/worker/core.js';
import { MemoryStore } from '../services/storage/store.js';
import { OpportunityCard } from '../apps/web/src/OpportunityCard.js';
import { OverviewPage } from '../apps/web/src/OverviewPage.js';
async function sample(){const engine=new TallyEngine(new MemoryStore());await engine.saveProfile(DEFAULT_PROFILE,0);await engine.analyze(['fixture-A','fixture-B']);await engine.processAll();return engine.state();}
const noop=()=>{};
function detail(state:State){return renderToStaticMarkup(createElement(OpportunityCard,{state,onNeedFixture:noop}));}
test('fresh product detail preserves the validated explanation and stated share without a credit estimate',async()=>{
 const state=await sample(),html=detail(state);assert.ok(state.opportunity);assert.ok(html.includes(state.opportunity.summary));assert.match(html,/80%/);assert.match(html,/Estimate unavailable/);assert.doesNotMatch(html,/fixture-A|fixture-B|\$0/);
});
test('a mismatched assessment is hidden until current even if the pending marker was lost',async()=>{
 const state=await sample();state.profile_rev++;state.pending_evaluation=null;const html=detail(state);assert.match(html,/Updating your review/);assert.doesNotMatch(html,/80%|What your records tell us|Go to documents/);assert.ok(!html.includes(state.opportunity!.summary));
 const overview=renderToStaticMarkup(createElement(OverviewPage,{state,onDocuments:noop,onSettings:noop,onOpportunity:noop}));assert.match(overview,/Your next steps are being updated/);assert.doesNotMatch(overview,/A potential opportunity based on your records/);
});
