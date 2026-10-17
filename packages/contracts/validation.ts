import {DEFAULT_PROFILE, type Profile} from './index.js';
import {isOpportunityFlag, isRuleAnswer, type OpportunityFlags} from './opportunity-flags.js';
const date = (s:unknown):s is string => typeof s==='string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s).toISOString().slice(0,10)===s;
export function validateProfile(value:unknown): Profile {
 if (!plainRecord(value)) throw new Error('Profile must be an object.');
 const p=value as Record<string,unknown>; const keys=Object.keys(DEFAULT_PROFILE);
 const descriptors=Object.getOwnPropertyDescriptors(p);
 if(Reflect.ownKeys(p).some(key=>typeof key!=='string'||!descriptors[key].enumerable||!('value' in descriptors[key]))) throw new Error('Profile fields must be own JSON values.');
 if(Object.keys(p).some(k=>!keys.includes(k)&&k!=='opportunity_flags') || keys.some(k=>!Object.hasOwn(p,k))) throw new Error('Profile has missing or unexpected fields.');
 if(p.display_name!==DEFAULT_PROFILE.display_name || p.activity!==DEFAULT_PROFILE.activity || p.tax_year!==2025 || p.legal_structure!=='llc' || p.federal_tax_classification!=='s_corporation' || p.source_type!=='synthetic_owner_provided') throw new Error('This demo is bound to the synthetic 2025 bakery profile.');
 if(JSON.stringify(p.operating_states)!=='["WA"]' || !Number.isSafeInteger(p.approximate_headcount) || Number(p.approximate_headcount)<0 || Number(p.approximate_headcount)>100 || !date(p.headcount_as_of) || (p.election_effective_date!==null && !date(p.election_effective_date))) throw new Error('Check profile dates, state and headcount.');
 for(const k of ['health_benefits_offered','owner_on_payroll','family_on_payroll','related_employers','prior_credit_history']) if(!isRuleAnswer(p[k])) throw new Error('Profile answers must be yes, no or unknown.');
 if(Object.hasOwn(p,'opportunity_flags')) {
  validateOpportunityFlags(p.opportunity_flags);
  if(Object.hasOwn(p.opportunity_flags,'health_benefits_offered')&&p.opportunity_flags.health_benefits_offered!==p.health_benefits_offered) throw new Error('Health benefits screening answer must match the shared profile answer.');
 }
 return structuredClone(p) as Profile;
}
export function plainObject(value:unknown):value is Record<string,unknown> {return Boolean(value && typeof value==='object' && !Array.isArray(value));}

function plainRecord(value:unknown):value is Record<string,unknown> {
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const prototype=Object.getPrototypeOf(value);return prototype===Object.prototype||prototype===null;
}
function validateOpportunityFlags(value:unknown):asserts value is OpportunityFlags {
 if(!plainRecord(value))throw new Error('Screening answers must be an object.');
 const descriptors=Object.getOwnPropertyDescriptors(value);
 for(const key of Reflect.ownKeys(value)){
  if(typeof key!=='string'||!isOpportunityFlag(key))throw new Error('Screening answer key is not in the rule library.');
  const descriptor=descriptors[key];
  if(!descriptor.enumerable||!('value' in descriptor)||!isRuleAnswer(descriptor.value))throw new Error('Screening answers must be yes, no or unknown own JSON values.');
 }
}
