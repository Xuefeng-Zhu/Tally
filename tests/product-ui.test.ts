import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_PROFILE, type State } from '../packages/contracts/index.js';
import { TallyEngine } from '../services/worker/core.js';
import { MemoryStore } from '../services/storage/store.js';
import { OpportunityCard } from '../apps/web/src/OpportunityCard.js';
import { OverviewPage } from '../apps/web/src/OverviewPage.js';
import { EvidencePanel } from '../apps/web/src/EvidencePanel.js';
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

test('local PDF proof stays distinct from native references without changing its quoted source or assessment',async()=>{
 const state=await sample(),fact=state.facts.find(item=>state.opportunity!.fact_ids.includes(item.fact_id)&&item.source.excerpt_validation==='matched'&&item.source.excerpt);assert.ok(fact);
 const baseline=renderToStaticMarkup(createElement(EvidencePanel,{state}));assert.doesNotMatch(baseline,/PDF text verified locally/);
 const sourceBefore=structuredClone(fact.source),summary=state.opportunity!.summary;
 fact.source.verification_method='local_pdf_text_match';
 const html=renderToStaticMarkup(createElement(EvidencePanel,{state}));
 assert.match(html,/PDF text verified locally · Not a native Box citation/);
 assert.ok(html.includes(sourceBefore.excerpt!));assert.ok(html.includes('data-testid="evidence-link"'));
 assert.deepEqual({...fact.source,verification_method:undefined},{...sourceBefore,verification_method:undefined});
 const review=detail(state);assert.match(review,/locally verified PDF text/);assert.ok(review.includes(summary));assert.match(review,/Estimate unavailable/);
});
