import type {Check} from '../../packages/contracts/index.js';

export type ExplanationClaimRule='eligibility_or_annual_claim'|'credit_amount_claim'|'professional_review_claim'|'unsupported_payment_match'|'unsupported_annualization';
/** Rule/offset metadata only; generated text is never retained on an error. */
export class ExplanationClaimError extends Error {
  constructor(readonly claimRule:ExplanationClaimRule,readonly claimMatch:{start:number;end:number}) {
    super('EXPLANATION_CLAIM');this.name='ExplanationClaimError';
  }
}
function reject(rule:ExplanationClaimRule,match:{index:number;0:string}):never {
  throw new ExplanationClaimError(rule,{start:match.index,end:match.index+match[0].length});
}
function rejectPattern(rule:ExplanationClaimRule,pattern:RegExp,text:string):void {
  const match=pattern.exec(text);if(match)reject(rule,match);
}
type Clause={text:string;start:number};
function clauses(text:string):Clause[]{
  // Each predicate is checked independently; payment/annual antecedents remain
  // available across punctuation, newlines and both output fields.
  // Commas can contain parenthetical negation or inherited predicates, so they
  // must stay in the same assertion ("confirmed, as is the payment").
  return [...text.matchAll(/[^.;!?\n]+/g)].map(match=>({text:match[0],start:match.index}));
}
const bridge=new Set('is are was were be been being has have had do does did can could will would should must may might remain remains remaining appear appears seem seems yet still currently previously now fully already successfully independently reliably conclusively explicitly definitively clearly ever not never no longer without only to'.split(' '));
function negation(prefix:string):{negated:boolean;ambiguous:boolean}{
  const words=(prefix.toLowerCase().match(/[a-z]+(?:['’][a-z]+)?/g)??[]).map(word=>word.replace('’',"'"));
  let count=0;
  for(let index=words.length-1;index>=0;index--){
    const word=words[index];
    if(['not','never','no','without','cannot'].includes(word)||word.endsWith("n't")){count++;continue;}
    if(!bridge.has(word))break;
  }
  const inversion=/\b(?:not\s+true|false|untrue|incorrect|inaccurate)\b/i.test(prefix);
  const notOnly=/\bnot\s+only\b[^.;,!?\n]*$/i.test(prefix);
  const negativePrefix=/\b(?:non|not)[-‐‑–—]\s*$/i.test(prefix);
  return {negated:count===1||negativePrefix,ambiguous:count>1||inversion||notOnly};
}
function located(match:RegExpMatchArray,clause:Clause):{index:number;0:string}{return{index:clause.start+match.index!,0:match[0]};}
const paymentSubject=/\b(?:payments?|payment\s+match(?:ing)?|matching|reconciliation)\b/i;
const annualSubject=/\b(?:annual|full[- ]year)\s+(?:checks|requirements|conditions)\b/i;
const pronoun=/\b(?:it|they|this|that|these|those|the\s+match|the\s+link)\b/i;
const negativeOperator=/\b(?:not|never|no|none|without|cannot|[a-z]+n['’]t)\b/i;
function uncertainInversion(prefix:string,suffix:string):boolean{
  // A negator separated from an uncertainty adjective by unfamiliar prose is
  // ambiguous, not permission to call the match established. Check either side
  // for inversions such as "No payment is unmatched" or "Unmatched it is not".
  return negativeOperator.test(prefix)||negativeOperator.test(suffix)||/\b(?:anything\s+but|false|untrue|incorrect|inaccurate)\b/i.test(prefix+' '+suffix);
}
function assertNoContradiction(text:string,subject:RegExp,rule:ExplanationClaimRule):void{
  if(!subject.test(text))return;
  // A terminal auxiliary inherits its missing predicate: "not matched, but it
  // now is" reverses the uncertainty without repeating "matched". Reject
  // either polarity of bare ellipsis; explicit negative predicates remain scoped.
  const adverb='(?:now|currently|already|actually|indeed|still|also|fully|clearly|certainly|definitely|yet|not|never|no longer|so|too)';
  const ellipsis=new RegExp(`(?:${subject.source}|${pronoun.source})(?:\\s+${adverb}){0,3}\\s+(?:is|are|was|were|has|have|does|do|did)(?:\\s+${adverb}){0,3}\\s*(?=,|$)`,'i');
  for(const clause of clauses(text)){
    if(pronoun.test(clause.text)){
      const match=/\b(?:false|untrue|incorrect|inaccurate)\b/i.exec(clause.text);
      if(match)reject(rule,located(match,clause));
    }
    const reversal=ellipsis.exec(clause.text)??/\b(?:not\s+anymore|no\s+longer)\s*(?=,|$)/i.exec(clause.text);
    if(reversal)reject(rule,located(reversal,clause));
  }
}

function assertPaymentPredicates(text:string,checks:Check[]):void{
  if(checks.some(check=>check.requirement_id==='payment_to_coverage_match'&&check.result==='supported'))return;
  assertNoContradiction(text,paymentSubject,'unsupported_payment_match');
  const hasPayment=paymentSubject.test(text);
  const supported=(id:string)=>checks.some(check=>check.requirement_id===id&&check.result==='supported');
  for(const clause of clauses(text)){
    const subjectHere=paymentSubject.test(clause.text);
    for(const match of clause.text.matchAll(/\b(?:unmatched|unconfirmed|unlinked|unreconciled|unresolved)\b/gi)){
      if(!subjectHere&&!hasPayment)continue;
      const polarity=negation(clause.text.slice(0,match.index));
      if(polarity.negated||polarity.ambiguous||uncertainInversion(clause.text.slice(0,match.index),clause.text.slice(match.index!+match[0].length)))reject('unsupported_payment_match',located(match,clause));
    }
    for(const match of clause.text.matchAll(/\b(?:re[- ]?)?(?:match|matches|matched|link|links|linked|reconcile|reconciles|reconciled|confirm|confirms|confirmed|resolved)\b/gi)){
      const prefix=clause.text.slice(0,match.index);
      // Bare "match"/"link" can be nouns. Their affirmative verb/copula forms
      // remain blocked without rejecting "payment match remains unconfirmed".
      if(/^(?:match|link)$/i.test(match[0])&&prefix.trim()&&!/\b(?:does|do|did|may|might|can|could|will|would|should|must|we|i|you|they|is|are)(?:\s+(?:a|the))?\s*$/i.test(prefix))continue;
      const explicitOther=!paymentSubject.test(clause.text)&&!pronoun.test(clause.text)&&(
        (/\b(?:premium\s+(?:components|breakdown)|contributions?)\b/i.test(prefix)&&supported('stated_premium_breakdown'))||
        (/\bcoverage\s+(?:period|dates)\b/i.test(prefix)&&supported('coverage_period'))||
        (/\b(?:partial\s+)?payroll\b/i.test(prefix)&&supported('partial_payroll'))
      );
      if(explicitOther)continue;
      // In a comma-delimited evidence list, a pre-nominal adjective binds to
      // its own noun phrase ("reconciled stated premium components, a recorded
      // payment"). Do not extend it to a later list item or inherited assertion.
      const localStart=clause.text.lastIndexOf(',',match.index)+1;
      const nextComma=clause.text.indexOf(',',match.index!+match[0].length);
      const local=clause.text.slice(localStart,nextComma<0?undefined:nextComma);
      const suffix=clause.text.slice(match.index!+match[0].length,nextComma<0?undefined:nextComma);
      const otherModifier=!paymentSubject.test(local)&&!pronoun.test(local)&&
        !/\b(?:as|so)\s+(?:is|are|was|were)\b/i.test(clause.text)&&(
          (/^\s+(?:stated\s+)?premium\s+(?:components|breakdown)\b/i.test(suffix)&&supported('stated_premium_breakdown'))||
          (/^\s+coverage\s+(?:period|dates)\b/i.test(suffix)&&supported('coverage_period'))
        );
      if(otherModifier)continue;
      if(!subjectHere&&!hasPayment&&!pronoun.test(prefix))continue;
      const polarity=negation(prefix);
      if(polarity.negated&&!polarity.ambiguous)continue;
      reject('unsupported_payment_match',located(match,clause));
    }
  }
}
function assertAnnualPredicates(text:string):void{
  assertNoContradiction(text,annualSubject,'eligibility_or_annual_claim');
  const hasAnnual=annualSubject.test(text);
  for(const clause of clauses(text)){
    if(!annualSubject.test(clause.text)&&!(hasAnnual&&pronoun.test(clause.text)))continue;
    for(const match of clause.text.matchAll(/\b(?:unresolved|unverified|unsupported|incomplete|unmet|unsatisfied)\b/gi)){
      const polarity=negation(clause.text.slice(0,match.index));
      if(polarity.negated||polarity.ambiguous||uncertainInversion(clause.text.slice(0,match.index),clause.text.slice(match.index!+match[0].length)))reject('eligibility_or_annual_claim',located(match,clause));
    }
    for(const match of clause.text.matchAll(/\b(?:met|satisfied|fulfilled|established|resolved|complete|completed|verified|supported)\b/gi)){
      const prefix=clause.text.slice(0,match.index),suffix=clause.text.slice(match.index!+match[0].length);
      // A pre-nominal adjective can describe sourced period evidence while a
      // later annual requirement is explicitly unresolved. Keep that scope;
      // "supported annual requirements" and later affirmative verbs still fail.
      const evidenceModifier=match[0].toLowerCase()==='supported'&&
        /^\s+(?:partial[- ]period|partial\s+payroll|monthly|coverage|premium)\s+evidence\b/i.test(suffix)&&
        !annualSubject.test(prefix)&&!pronoun.test(prefix)&&
        /\b(?:unresolved|unverified|unsupported|incomplete|unmet|unsatisfied)\b[^.;!?\n]{0,70}\b(?:annual|full[- ]year)\s+(?:checks|requirements|conditions)\b/i.test(suffix);
      if(evidenceModifier)continue;
      const polarity=negation(prefix);
      if(polarity.negated&&!polarity.ambiguous)continue;
      reject('eligibility_or_annual_claim',located(match,clause));
    }
  }
}
export function assertExplanationClaims(summary:string,changed:string,checks:Check[]):void{
  const text=summary+' '+changed;
  rejectPattern('eligibility_or_annual_claim',/\b(?:eligible|qualif(?:y|ies|ied)|guaranteed|entitled|confirmed credit|credit (?:is|of)|tax (?:savings|refund)|you (?:can|will) claim|(?:meets?|satisf(?:y|ies|ied)) (?:all (?:the )?)?(?:credit|eligibility) (?:requirements|conditions))\b/i,text);
  assertAnnualPredicates(text);
  rejectPattern('credit_amount_claim',/\b(?:credit|refund|savings|tax benefit)\b.{0,40}\$?\s*\d/i,text);
  rejectPattern('professional_review_claim',/\b(?:professionally (?:reviewed|approved|verified)|(?:professional|legal|tax) review (?:is |was |has been )?(?:complete|completed|approved|passed)|IRS[- ](?:approved|verified|certified)|(?:IRS|(?:tax |legal )?professional|accountant|lawyer)\b.{0,25}\b(?:reviewed|approved|verified|certified)|(?:reviewed|approved|verified|certified)\b.{0,20}\bby\b.{0,25}\b(?:professional|accountant|lawyer|IRS))\b/i,text);
  assertPaymentPredicates(text,checks);
  // A sourced partial-period number cannot become an annual payroll/FTE figure.
  rejectPattern('unsupported_annualization',/\b(?:annual|full[- ]year)\s+(?:(?:payroll|gross|fica|employee|total|fte)\s+){0,3}(?:payroll|wages|hours|fte|headcount)\b[^.;!?\n]{0,35}(?:\$\s*)?\d/i,text);
  rejectPattern('unsupported_annualization',/\b(?:annual|full[- ]year)\s+(?:(?:payroll|gross|fica|employee|total|fte)\s+){0,3}(?:payroll|wages|hours|fte|headcount)\b[^.;!?\n]{0,60}\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand|calculated|derived|annualized)\b/i,text);
}
