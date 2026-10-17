import {DEFAULT_PROFILE, type Profile} from './index.js';
const date = (s:unknown):s is string => typeof s==='string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s).toISOString().slice(0,10)===s;
const choices=['yes','no','unknown'];
export function validateProfile(value:unknown): Profile {
 if (!value || typeof value!=='object' || Array.isArray(value)) throw new Error('Profile must be an object.');
 const p=value as Record<string,unknown>; const keys=Object.keys(DEFAULT_PROFILE);
 if(Object.keys(p).some(k=>!keys.includes(k)) || keys.some(k=>!(k in p))) throw new Error('Profile has missing or unexpected fields.');
 if(p.display_name!==DEFAULT_PROFILE.display_name || p.activity!==DEFAULT_PROFILE.activity || p.tax_year!==2025 || p.legal_structure!=='llc' || p.federal_tax_classification!=='s_corporation' || p.source_type!=='synthetic_owner_provided') throw new Error('This demo is bound to the synthetic 2025 bakery profile.');
 if(JSON.stringify(p.operating_states)!=='["WA"]' || !Number.isSafeInteger(p.approximate_headcount) || Number(p.approximate_headcount)<0 || Number(p.approximate_headcount)>100 || !date(p.headcount_as_of) || (p.election_effective_date!==null && !date(p.election_effective_date))) throw new Error('Check profile dates, state and headcount.');
 for(const k of ['health_benefits_offered','owner_on_payroll','family_on_payroll','related_employers','prior_credit_history']) if(!choices.includes(String(p[k]))) throw new Error('Profile answers must be yes, no or unknown.');
 return structuredClone(p) as Profile;
}
export function plainObject(value:unknown):value is Record<string,unknown> {return Boolean(value && typeof value==='object' && !Array.isArray(value));}
