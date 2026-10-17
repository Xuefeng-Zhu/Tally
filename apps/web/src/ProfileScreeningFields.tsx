import {useId} from 'react';
import type {Profile} from '../../../packages/contracts';
import type {RuleAnswer, RuleFlag} from '../../../packages/contracts/opportunity-flags';
import {RULE_LIBRARY} from '../../../packages/rules/library';

type Props={profile:Profile;onAnswer:(flag:RuleFlag,answer:RuleAnswer)=>void};
/** Owner-provided screening stays separate from confirmed document facts. */
export function ProfileScreeningFields({profile,onAnswer}:Props){
 const id=useId();
 const answer=(flag:RuleFlag):RuleAnswer=>flag==='health_benefits_offered'?profile.health_benefits_offered:profile.opportunity_flags?.[flag]??'unknown';
 return <details className="settings-profile-disclosure" data-testid="screening-questions">
  <summary><span><strong>Opportunity screening</strong><span>Review questions for the ten 2025 rules</span></span><span className="settings-disclosure-plus" aria-hidden="true">+</span></summary>
  <div className="settings-screening-content">
   <p className="settings-field-help">Save these answers with your business profile to guide the rule library. They identify review candidates; they do not confirm document facts, establish eligibility or calculate a tax benefit. Leave anything unresolved as Unknown.</p>
   {RULE_LIBRARY.map(rule=><details className="settings-screening-rule" key={rule.id} data-testid={`screening-${rule.id}`}>
    <summary><span><strong>{rule.title}</strong><span>{rule.claimant==='owner'?"Owner's review":"Business review"} · {rule.conditions.filter(condition=>answer(condition.flag)!=='unknown').length} of {rule.conditions.length} answered</span></span><span className="settings-disclosure-plus" aria-hidden="true">+</span></summary>
    <fieldset className="settings-fieldset settings-disclosure-fields">
     <legend className="settings-visually-hidden">{rule.title} screening answers</legend>
     {rule.conditions.map(condition=><div className="field settings-field settings-field-wide" key={condition.id}>
      <label htmlFor={`${id}-${rule.id}-${condition.id}`}>{condition.description}</label>
      <select id={`${id}-${rule.id}-${condition.id}`} data-screening-flag={condition.flag} value={answer(condition.flag)} onChange={event=>onAnswer(condition.flag,event.target.value as RuleAnswer)}>
       <option value="unknown">Unknown</option><option value="yes">Yes</option><option value="no">No</option>
      </select>
      {condition.flag==='health_benefits_offered'&&<p className="settings-field-help">Uses the same answer as People &amp; health benefits.</p>}
     </div>)}
     <p className="settings-field-help settings-field-wide">{rule.claimant_note} Source documents and professional review remain required.</p>
    </fieldset>
   </details>)}
  </div>
 </details>;
}
