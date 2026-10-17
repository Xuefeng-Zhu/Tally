import { ANNUAL_IDS, EVIDENCE_IDS, type Explanation, type Fact, type Opportunity } from '../../packages/contracts/index.js';
export type ExplanationContext={opportunity:Opportunity;facts:Fact[];previousSummary?:string};
export type ExplanationReceipt={mode:'live_bedrock'|'live_openrouter'|'deterministic_fallback';explanation:Explanation;usage:{inputTokens:number|null;outputTokens:number|null;totalTokens:number|null};reason?:string};
export function deterministicExplanation(context:ExplanationContext):Explanation {
  return {summary:context.opportunity.summary.slice(0,600),what_changed:context.previousSummary===context.opportunity.summary?'':context.opportunity.stage==='needs_coverage_statement'?'Payment and partial payroll evidence recorded. Coverage evidence is still needed.':'Evidence was re-evaluated. Annual requirements remain unresolved.',fact_ids:[...context.opportunity.fact_ids].slice(0,16),rule_ids:context.opportunity.annual_requirements.map(v=>v.requirement_id).filter(v=>(ANNUAL_IDS as readonly string[]).includes(v)).slice(0,8)};
}
const keys=['summary','what_changed','fact_ids','rule_ids'];
function numberTokens(text:string):string[] {return (text.match(/\d[\d,]*(?:\.\d+)?/g)??[]).map(v=>String(Number(v.replaceAll(',',''))));}
export type ExplanationClaimRule='eligibility_or_annual_claim'|'credit_amount_claim'|'professional_review_claim'|'unsupported_payment_match';
/** Safe rule/offset metadata only; no generated text is retained on the error. */
export class ExplanationClaimError extends Error {
  constructor(readonly claimRule:ExplanationClaimRule,readonly claimMatch:{start:number;end:number}) {
    super('EXPLANATION_CLAIM');this.name='ExplanationClaimError';
  }
}
function rejectClaim(rule:ExplanationClaimRule,expression:RegExp,text:string):void {
  const match=expression.exec(text);
  if(match)throw new ExplanationClaimError(rule,{start:match.index,end:match.index+match[0].length});
}
function paymentClaimText(summary:string,changed:string):string {
  // Only this complete output pair states unresolved matching with no companion
  // prose. Keep other pairs under the original guard, including pronouns in
  // what_changed that could contradict an uncertainty sentence in summary.
  const standalone=summary.trim().toLowerCase()==='payment matching remains unconfirmed.'&&!changed.trim();
  return (standalone?' '.repeat(summary.length):summary)+' '+changed;
}
/** A model describes deterministic findings; it cannot add amounts, IDs, or eligibility. */
export function validateExplanation(value:unknown,context:ExplanationContext):Explanation {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('EXPLANATION_NOT_OBJECT');
  const obj=value as Record<string,unknown>;
  if(Object.keys(obj).length!==4||!Object.keys(obj).every(k=>keys.includes(k)))throw new Error('EXPLANATION_FIELDS');
  if(typeof obj.summary!=='string'||typeof obj.what_changed!=='string'||!obj.summary.trim()||obj.summary.length>600||obj.what_changed.length>350)throw new Error('EXPLANATION_TEXT');
  const ids=(v:unknown,allow:readonly string[],max:number)=>Array.isArray(v)&&v.length<=max&&v.every(x=>typeof x==='string'&&allow.includes(x))&&new Set(v).size===v.length;
  if(!ids(obj.fact_ids,context.opportunity.fact_ids,16)||!ids(obj.rule_ids,[...ANNUAL_IDS,...EVIDENCE_IDS],8))throw new Error('EXPLANATION_REFERENCE');
  const text=obj.summary+' '+obj.what_changed;
  rejectClaim('eligibility_or_annual_claim',/\b(?:eligible|qualif(?:y|ies|ied)|guaranteed|entitled|confirmed credit|credit (?:is|of)|tax (?:savings|refund)|you (?:can|will) claim|annual (?:checks|requirements) (?:(?:are|were|have been|had been) )?(?:met|satisfied|resolved|complete|verified|supported)|(?:meets?|satisf(?:y|ies|ied)) (?:all (?:the )?)?(?:credit|eligibility) (?:requirements|conditions))\b/i,text);
  rejectClaim('credit_amount_claim',/\b(?:credit|refund|savings|tax benefit)\b.{0,40}\$?\s*\d/i,text);
  rejectClaim('professional_review_claim',/\b(?:professionally (?:reviewed|approved|verified)|(?:professional|legal|tax) review (?:is |was |has been )?(?:complete|completed|approved|passed)|IRS[- ](?:approved|verified|certified)|(?:IRS|(?:tax |legal )?professional|accountant|lawyer)\b.{0,25}\b(?:reviewed|approved|verified|certified)|(?:reviewed|approved|verified|certified)\b.{0,20}\bby\b.{0,25}\b(?:professional|accountant|lawyer|IRS))\b/i,text);
  const matchSupported=context.opportunity.evidence_checks.some(check=>check.requirement_id==='payment_to_coverage_match'&&check.result==='supported');
  if(!matchSupported)rejectClaim('unsupported_payment_match',/(?:payment.{0,35}(?:matches|matched|linked|reconciled|confirmed)|(?:matched|confirmed).{0,25}payment)/i,paymentClaimText(obj.summary as string,obj.what_changed as string));
  const allowedNumbers=new Set<string>();
  const add=(value:unknown)=>{if(value!==null&&value!==undefined)numberTokens(String(value)).forEach(v=>allowedNumbers.add(v));};
  add(context.opportunity.tax_year);
  for(const fact of context.facts.filter(f=>context.opportunity.fact_ids.includes(f.fact_id))){
    add(fact.value);add(fact.as_of_date);add(fact.relevant_period.start);add(fact.relevant_period.end);
    if(typeof fact.value==='number'&&['USD_cents','basis_points'].includes(fact.unit))add(fact.value/100);
  }
  const share=context.opportunity.reported_employer_share_basis_points;
  if(share!==null)add(share/100);
  if(numberTokens(text).some(token=>!allowedNumbers.has(token)))throw new Error('EXPLANATION_NUMBER');
  return obj as Explanation;
}
export function parseCompleteExplanation(text:string,context:ExplanationContext):Explanation {return validateExplanation(JSON.parse(text),context);}
