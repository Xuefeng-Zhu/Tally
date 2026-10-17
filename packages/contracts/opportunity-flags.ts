import libraryData from '../../rules/2025/opportunity-library.json';

export const RULE_ANSWERS = Object.freeze(['yes', 'no', 'unknown'] as const);
export type RuleAnswer = typeof RULE_ANSWERS[number];
const reserved = new Set(['__proto__', 'prototype', 'constructor', ...Object.getOwnPropertyNames(Object.prototype)]);
const flags = libraryData.flatMap(rule => rule.conditions.map(condition => condition.flag));
if (!flags.length || flags.some(flag => !/^[a-z][a-z0-9_]*$/.test(flag) || reserved.has(flag))) throw new Error('RULE_LIBRARY_FLAGS_INVALID');
/** The versioned catalog is the single source of accepted screening keys for API and UI. */
export const OPPORTUNITY_FLAGS: readonly string[] = Object.freeze([...new Set(flags)]);
export type RuleFlag = typeof OPPORTUNITY_FLAGS[number];
export type OpportunityFlags = Partial<Record<RuleFlag, RuleAnswer>>;
const allowed = new Set(OPPORTUNITY_FLAGS);
export function isOpportunityFlag(value: unknown): value is RuleFlag { return typeof value === 'string' && allowed.has(value); }
export function isRuleAnswer(value: unknown): value is RuleAnswer { return typeof value === 'string' && RULE_ANSWERS.some(answer => answer === value); }
