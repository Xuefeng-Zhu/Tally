import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_PROFILE} from '../packages/contracts/index.js';
import {MemoryStore,TallyEngine} from '../services/worker/core.js';
import {ExplanationClaimError,validateExplanation,type ExplanationContext} from '../services/providers/explanation.js';

async function afterA():Promise<ExplanationContext>{
  const engine=new TallyEngine(new MemoryStore());await engine.saveProfile(DEFAULT_PROFILE,0);await engine.analyze(['fixture-A']);await engine.processAll();
  const state=await engine.state();assert.ok(state.opportunity);return{opportunity:state.opportunity,facts:state.facts};
}
const value=(context:ExplanationContext,summary:string,what_changed='')=>({summary,what_changed,fact_ids:context.opportunity.fact_ids,rule_ids:['payment_to_coverage_match']});

test('the complete uncertainty field is grounded in actual A matching unknowns and does not promote support',async()=>{
  const context=await afterA(),before=structuredClone(context);
  assert.equal(context.opportunity.evidence_checks.find(check=>check.requirement_id==='payment_to_coverage_match')?.result,'unknown');
  assert.ok(!context.facts.some(fact=>fact.fact_type.startsWith('coverage_')));
  for(const [summary,changed] of [['Payment matching remains unconfirmed.',''],['  PAYMENT MATCHING REMAINS UNCONFIRMED.  ','  ']] as const){
    const explanation=value(context,summary,changed);assert.deepEqual(validateExplanation(explanation,context),explanation);
  }
  assert.deepEqual(context,before);
});

test('uncertainty never exempts another field or mixed, negated, framed and affirmative payment claims',async()=>{
  const context=await afterA();
  for(const summary of [
    'The payment match is confirmed.','The payment is matched to coverage.','Confirmed payment is linked to coverage.',
    'The payment is reconfirmed.','The payment is re-confirmed.','The payment is not unconfirmed.',
    "The payment isn't unmatched.",'The payment isn’t unconfirmed.','No unmatched payment remains.',
    'It is not true that the payment is unconfirmed.','Payment matching remains unconfirmed. The payment is confirmed.',
    'Payment matching remains unconfirmed; the payment is confirmed.','False: payment matching remains unconfirmed.',
    'Payment matching remains unconfirmed?','Payment matching remains unconfirmed. Annual requirements remain unresolved.',
  ])assert.throws(()=>validateExplanation(value(context,summary),context),/EXPLANATION_CLAIM/,summary);
  for(const changed of ['The payment is confirmed.','It has been confirmed against coverage.','That statement is false; it is confirmed.','You are eligible.','Annual requirements are satisfied.','The tax review is complete.']){
    assert.throws(()=>validateExplanation(value(context,'Payment matching remains unconfirmed.',changed),context),/EXPLANATION_CLAIM/,changed);
  }
  for(const summary of ['It has been confirmed against coverage.','That statement is false; it is confirmed.','Payment and partial payroll evidence are recorded.']){
    assert.throws(()=>validateExplanation(value(context,summary,'Payment matching remains unconfirmed.'),context),/EXPLANATION_CLAIM/,summary);
  }
});

test('claim failures identify the exact rule and matched offset without including generated text on the error',async()=>{
  const context=await afterA();
  for(const [summary,rule,match] of [
    ['You are eligible.','eligibility_or_annual_claim','eligible'],
    ['A credit amount is 1200.','credit_amount_claim','credit amount is 1200'],
    ['Professional review is complete.','professional_review_claim','Professional review is complete'],
    ['The payment is confirmed.','unsupported_payment_match','payment is confirmed'],
  ] as const){
    let captured:unknown;try{validateExplanation(value(context,summary),context);}catch(error){captured=error;}
    assert.ok(captured instanceof ExplanationClaimError);assert.equal(captured.message,'EXPLANATION_CLAIM');assert.equal(captured.claimRule,rule);
    assert.equal(summary.slice(captured.claimMatch.start,captured.claimMatch.end),match);
    assert.ok(!JSON.stringify(captured).includes(summary));
  }
});

test('complete uncertainty text cannot bypass references, numbers or source/professional claims',async()=>{
  const context=await afterA();
  assert.throws(()=>validateExplanation({...value(context,'Payment matching remains unconfirmed.'),fact_ids:['invented']},context),/EXPLANATION_REFERENCE/);
  assert.throws(()=>validateExplanation(value(context,'Payment matching remains unresolved.','A recorded payment of 999 is shown.'),context),/EXPLANATION_NUMBER/);
  assert.throws(()=>validateExplanation(value(context,'Payment matching remains unconfirmed.','A recorded payment of 999 is shown.'),context),/EXPLANATION_CLAIM/);
  assert.throws(()=>validateExplanation(value(context,'Payment matching remains unconfirmed.','IRS approved the evidence.'),context),/EXPLANATION_CLAIM/);
});
