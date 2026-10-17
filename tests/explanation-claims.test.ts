import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_PROFILE} from '../packages/contracts/index.js';
import {MemoryStore,TallyEngine} from '../services/worker/core.js';
import {ExplanationClaimError,ExplanationReferenceError,validateExplanation,type ExplanationContext} from '../services/providers/explanation.js';
async function bakery(withB=false):Promise<ExplanationContext>{
 const engine=new TallyEngine(new MemoryStore());await engine.saveProfile(DEFAULT_PROFILE,0);await engine.analyze(withB?['fixture-A','fixture-B']:['fixture-A']);await engine.processAll();const state=await engine.state();assert.ok(state.opportunity);return{opportunity:state.opportunity,facts:state.facts};
}
const value=(context:ExplanationContext,summary:string,what_changed='')=>({summary,what_changed,fact_ids:context.opportunity.fact_ids,rule_ids:['payment_to_coverage_match']});
test('whole uncertainty tokens and scoped negative predicates preserve unknown matching in both fields',async()=>{
 const context=await bakery(),before=structuredClone(context);
 assert.equal(context.opportunity.evidence_checks.find(c=>c.requirement_id==='payment_to_coverage_match')?.result,'unknown');
 for(const summary of ['The recorded payment remains unmatched.','An unconfirmed payment is recorded; coverage evidence is still needed.','The payment remains unconfirmed, unlinked and unreconciled.','Payment matching remains unresolved.','The payment has not been confirmed against coverage.','The payment has not yet been matched to coverage.','Coverage has not been matched to the payment.','The payment was never matched.','The payment is not yet linked.',"The payment isn't confirmed.",'The payment isn’t matched.','Payment matching remains unconfirmed. Annual requirements remain unresolved.']){
  const explanation=value(context,summary,'Partial payroll evidence is recorded.');assert.deepEqual(validateExplanation(explanation,context),explanation,summary);
  assert.doesNotThrow(()=>validateExplanation(value(context,'Partial payroll evidence is recorded.',summary),context),summary);
 }
 assert.deepEqual(context,before);
});
test('affirmations, re-forms, negated uncertainty and contradictory statements stay rejected',async()=>{
 const context=await bakery();
 for(const summary of ['The payment match is confirmed.','The payment is matched to coverage.','Confirmed payment is linked to coverage.','The payment is reconfirmed.','The payment is re-confirmed.','The payment is re confirmed.','The payment is not unconfirmed.',"The payment isn't unmatched.",'The payment isn’t unconfirmed.','No unmatched payment remains.','The payment is no longer unlinked.','The payment has never been unreconciled.','The payment does not remain unmatched.','It is not true that the payment is unconfirmed.','False: payment matching remains unconfirmed.','Payment matching remains unconfirmed; the payment is confirmed.','The payment is not only matched but confirmed.','The payment is confirmed to be unmatched.','Payment matching remains unresolved.\nIt is confirmed.','The payment is not never matched.','No payment remains unmatched.','The payment is not considered unmatched.','The payment cannot be considered unconfirmed.','Unmatched is not what this payment is.','The payment is anything but unmatched.','The payment does match coverage.','We confirm the payment.','Payment matching is resolved.','The payment is a match.'])assert.throws(()=>validateExplanation(value(context,summary),context),/EXPLANATION_CLAIM/,summary);
 for(const changed of ['The payment is confirmed.','It has been confirmed against coverage.','That statement is false; it is confirmed.','That statement is false.']){
  assert.throws(()=>validateExplanation(value(context,'Payment matching remains unconfirmed.',changed),context),/EXPLANATION_CLAIM/,changed);
  assert.throws(()=>validateExplanation(value(context,changed,'Payment matching remains unconfirmed.'),context),/EXPLANATION_CLAIM/,changed);
 }
});
test('bare auxiliary reversals cannot turn payment or annual uncertainty into support',async()=>{
 const context=await bakery();
 for(const summary of [
  'Payment is not matched, but it now is.','The payment has not been matched, but it is now.',
  'Payment remains unmatched. Actually, it is.','Payment remains unmatched. It is not.',
  'Payment remains unmatched. Not anymore.','Payment is not matched, but the payment now is.',
  'Annual requirements are not met, but they now are.','Annual requirements have not been met, but they are now.',
  'Annual requirements are not met. Actually, they are.','Annual requirements remain unresolved. They are not.',
 ])assert.throws(()=>validateExplanation(value(context,summary),context),/EXPLANATION_CLAIM/,summary);
 for(const [uncertainty,reversal] of [
  ['Payment has not been matched.','But it now is.'],
  ['Annual requirements have not been met.','Actually, they are.'],
  ['Annual requirements remain unresolved.','They are now.'],
 ] as const){
  assert.throws(()=>validateExplanation(value(context,uncertainty,reversal),context),/EXPLANATION_CLAIM/);
  assert.throws(()=>validateExplanation(value(context,reversal,uncertainty),context),/EXPLANATION_CLAIM/);
 }
 for(const summary of ['The payment has not yet been matched to coverage.','Annual requirements have not been met.'])assert.doesNotThrow(()=>validateExplanation(value(context,summary,'Partial payroll evidence is recorded.'),context));
});
test('supported premium and coverage predicates stay separate from unknown payment matching',async()=>{
 const context=await bakery(true);
 assert.doesNotThrow(()=>validateExplanation(value(context,'The recorded payment remains unmatched. Premium components are reconciled. Coverage dates are confirmed.','Annual requirements remain unresolved.'),context));
 assert.doesNotThrow(()=>validateExplanation(value(context,'Partial-period coverage, reconciled stated premium components, a recorded insurance payment, and partial payroll are supported. Payment matching and annual requirements remain unresolved; no eligibility conclusion or credit estimate is available.','No prior summary was provided; current findings document supported partial-period evidence and unresolved matching and annual requirements.'),context));
 for(const summary of ['Reconciled stated premium components, as is the payment.','Reconciled stated premium components with the payment.','The payment is confirmed coverage dates.'])assert.throws(()=>validateExplanation(value(context,summary),context),/EXPLANATION_CLAIM/,summary);
 assert.throws(()=>validateExplanation(value(context,'The payment and premium components are reconciled.'),context),/EXPLANATION_CLAIM/);
 for(const summary of ['Coverage dates are matched to the payment.','Premium components are confirmed as linked to the payment.','Partial payroll confirms the payment.','Coverage dates are confirmed, as is the payment.','Premium components are confirmed, and so is the payment.','The payment is not, as previously thought, unmatched.','False, the payment remains unmatched.','The payment remains unmatched, which is incorrect.'])assert.throws(()=>validateExplanation(value(context,summary),context),/EXPLANATION_CLAIM/,summary);
 assert.throws(()=>validateExplanation(value(context,'The payment remains unmatched.','Premium components are matched to it.'),context),/EXPLANATION_CLAIM/);
 const a=await bakery();assert.throws(()=>validateExplanation(value(a,'The payment remains unmatched. Coverage dates are confirmed.'),a),/EXPLANATION_CLAIM/);
});
test('annual predicates handle adverbs and negation; partial numbers cannot become annual figures',async()=>{
 const context=await bakery();
 for(const summary of ['Annual requirements remain unresolved.','Annual requirements have not been met.','Annual requirements remain incomplete and unsupported.'])assert.doesNotThrow(()=>validateExplanation(value(context,summary),context),summary);
 assert.doesNotThrow(()=>validateExplanation(value(context,'The recorded payment remains unmatched.','No prior summary was provided; current findings document supported partial-period evidence and unresolved matching and annual requirements.'),context));
 for(const summary of ['Supported annual requirements are recorded.','Supported partial-period evidence and annual requirements are recorded.','Current findings document supported partial-period evidence and unresolved matching and annual requirements; those requirements are verified.'])assert.throws(()=>validateExplanation(value(context,summary),context),/EXPLANATION_CLAIM/,summary);
 for(const summary of ['All annual requirements have been fully verified.','The annual requirements are now satisfied.','Annual requirements are no longer unresolved.','Annual requirements are not incomplete.','Annual requirements remain unresolved. They are supported.','Annual payroll wages are $4,000.','Full-year payroll wages are 4000.','Annual FTE is 4.','No annual requirements remain unresolved.','Annual requirements cannot be considered incomplete.','Annual requirements have been fulfilled.','Annual FTE is four.','Annual payroll wages are four thousand dollars.','Annual FTE has been calculated from the partial payroll.'])assert.throws(()=>validateExplanation(value(context,summary),context),/EXPLANATION_CLAIM/,summary);
});
test('claim rule metadata identifies original offsets without retaining generated text',async()=>{
 const context=await bakery();
 for(const [summary,rule,match] of [['You are eligible.','eligibility_or_annual_claim','eligible'],['A credit amount is 1200.','credit_amount_claim','credit amount is 1200'],['Professional review is complete.','professional_review_claim','Professional review is complete'],['The payment is confirmed.','unsupported_payment_match','confirmed'],['Annual payroll wages are $4,000.','unsupported_annualization','Annual payroll wages are $4,000']] as const){
  let captured:unknown;try{validateExplanation(value(context,summary),context);}catch(error){captured=error;}
  assert.ok(captured instanceof ExplanationClaimError);assert.equal(captured.message,'EXPLANATION_CLAIM');assert.equal(captured.claimRule,rule);assert.equal(summary.slice(captured.claimMatch.start,captured.claimMatch.end),match);assert.ok(!JSON.stringify(captured).includes(summary));
 }
});
test('reference failures preserve exact validation and trusted index metadata for both fields',async()=>{
 const context=await bakery();let captured:unknown;
 try{validateExplanation({...value(context,'Payment matching remains unresolved.'),fact_ids:['invented',context.opportunity.fact_ids[0],context.opportunity.fact_ids[0],42],rule_ids:['invented-rule']},context);}catch(error){captured=error;}
 assert.ok(captured instanceof ExplanationReferenceError);assert.equal(captured.referenceIssues.length,2);assert.deepEqual(captured.referenceIssues[0],{field:'fact_ids',notArray:false,actualCount:4,maxItems:16,nonStringIndexes:[3],unknownIdIndexes:[0],duplicateIndexes:[2]});assert.deepEqual(captured.referenceIssues[1].unknownIdIndexes,[0]);assert.ok(!JSON.stringify(captured).includes('invented'));
});
test('all output validation branches stay fail-closed, including bounds and selected-source numbers',async()=>{
 const context=await bakery(),base=value(context,'Payment matching remains unresolved.');
 for(const invalid of [null,[],42,'text'])assert.throws(()=>validateExplanation(invalid,context),/EXPLANATION_NOT_OBJECT/);
 for(const invalid of [{...base,extra:true},{summary:'x'}])assert.throws(()=>validateExplanation(invalid,context),/EXPLANATION_FIELDS/);
 for(const invalid of [{...base,summary:''},{...base,summary:'   '},{...base,summary:42},{...base,summary:'x'.repeat(601)},{...base,what_changed:'x'.repeat(351)}])assert.throws(()=>validateExplanation(invalid,context),/EXPLANATION_TEXT/);
 assert.doesNotThrow(()=>validateExplanation({...base,summary:'x'.repeat(600),what_changed:'x'.repeat(350)},context));
 for(const invalid of [{...base,fact_ids:null},{...base,fact_ids:[{}]},{...base,fact_ids:Array(17).fill(context.opportunity.fact_ids[0])},{...base,rule_ids:Array(9).fill('partial_payroll')}])assert.throws(()=>validateExplanation(invalid,context),/EXPLANATION_REFERENCE/);
 assert.throws(()=>validateExplanation(value(context,'A recorded payment of 999 is shown.'),context),/EXPLANATION_NUMBER/);
 assert.doesNotThrow(()=>validateExplanation(value(context,'The recorded payment amount is 1200. Partial payroll wages are 4000.'),context));
 const excluded=structuredClone(context);excluded.opportunity.fact_ids=excluded.opportunity.fact_ids.filter(id=>!id.endsWith('payroll_worker_count'));assert.throws(()=>validateExplanation(value(excluded,'The worker count is 4.'),excluded),/EXPLANATION_NUMBER/);
 for(const summary of ['You are eligible.','The records were IRS-approved.','A guaranteed tax refund of twelve dollars is available.'])assert.throws(()=>validateExplanation(value(context,summary),context),/EXPLANATION_CLAIM/);
});
