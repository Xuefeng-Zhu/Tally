import type { Profile } from '../../../packages/contracts';
import { RULE_LIBRARY, evaluateRuleLibrary } from '../../../packages/rules/library';

export type LibraryRule = typeof RULE_LIBRARY[number];
export type LibraryScreening = ReturnType<typeof evaluateRuleLibrary>[number];
export type LibraryEntry = { rule: LibraryRule; screening: LibraryScreening };
export type RuleTypeFilter = 'all' | 'credit' | 'deduction';

export function libraryEntries(profile: Profile | null): LibraryEntry[] {
  const screening = new Map(evaluateRuleLibrary(profile).map(result => [result.rule_id, result]));
  return RULE_LIBRARY.map(rule => ({ rule, screening: screening.get(rule.id)! }));
}

export function filterLibrary(entries: readonly LibraryEntry[], query: string, type: RuleTypeFilter): LibraryEntry[] {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter(({ rule }) => {
    if (type !== 'all' && rule.type !== type) return false;
    const text = [rule.title, rule.id.replaceAll('_', ' '), rule.claimant, ...rule.entity_scope,
      ...rule.conditions.map(condition => condition.description), ...rule.missing_evidence].join(' ').toLocaleLowerCase();
    return words.every(word => text.includes(word));
  });
}

export function officialRuleSource(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !(url.hostname === 'irs.gov' || url.hostname.endsWith('.irs.gov'))) return null;
    return url.href;
  } catch { return null; }
}

export const entityLabels: Record<LibraryRule['entity_scope'][number], string> = {
  sole_proprietorship: 'Sole proprietors', partnership: 'Partnerships', s_corporation: 'S corporations',
  c_corporation: 'C corporations', tax_exempt: 'Tax-exempt organizations',
};

export const sourceEditionLabels: Record<LibraryRule['sources'][number]['edition'], string> = {
  '2025': '2025 edition', current_revision: 'Current revision', evergreen: 'Evergreen guidance',
};

export const screeningLabels: Record<LibraryScreening['status'], string> = {
  potential_opportunity: 'Potential fit · evidence needed',
  needs_evidence: 'Needs evidence',
  out_of_scope: 'Outside this profile',
};
