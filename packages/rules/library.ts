import libraryData from '../../rules/2025/opportunity-library.json';

export type RuleFlag = string;
export type RuleAnswer = 'yes' | 'no' | 'unknown';
export type RuleEntity = 'sole_proprietorship' | 'partnership' | 's_corporation' | 'c_corporation' | 'tax_exempt';
export type RuleScreeningProfile = {
  tax_year: number;
  federal_tax_classification: string;
  activity: string;
  health_benefits_offered?: string;
  operating_states: string[];
  opportunity_flags?: Partial<Record<RuleFlag, RuleAnswer>>;
};
export type RuleSource = { title: string; url: string; tax_year: 2025; verified_at: string; edition: '2025' | 'current_revision' | 'evergreen'; notes?: string };
export type RuleCondition = { id: string; description: string; flag: RuleFlag };
export type RuleDefinition = {
  id: string;
  title: string;
  type: 'credit' | 'deduction';
  tax_year: 2025;
  summary: string;
  scope_note: string;
  claimant_note: string;
  entity_scope: readonly RuleEntity[];
  claimant: 'business' | 'owner';
  sources: readonly RuleSource[];
  conditions: readonly RuleCondition[];
  missing_evidence: readonly string[];
  professional_review_status: 'not_reviewed';
  verification_status: 'source_checked_offline_tests_only';
  fixture_verification: 'existing_45r_offline_fixture_flow' | 'not_implemented';
  live_e2e_status: 'not_verified';
};
export type RuleScreenResult = {
  rule_id: string;
  status: 'potential_opportunity' | 'needs_evidence' | 'out_of_scope';
  reasons: string[];
  missing_evidence: string[];
  professional_review_status: 'not_reviewed';
  legal_claim_activated: false;
  calculation_enabled: false;
};

const requiredIds = ['irc_45r', 'irc_45e', 'irc_44', 'irc_190', 'irc_51', 'irc_179', 'irc_168k', 'irc_45b', 'irc_199a', 'irc_162l'] as const;
const entities: readonly RuleEntity[] = ['sole_proprietorship', 'partnership', 's_corporation', 'c_corporation', 'tax_exempt'];
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.length > 0 && value.every(nonempty);
const unique = (values: readonly unknown[]) => new Set(values).size === values.length;
function officialSource(url: unknown): boolean {
  if (!nonempty(url)) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password &&
      ['irs.gov', 'treasury.gov'].some(host => parsed.hostname === host || parsed.hostname.endsWith('.' + host));
  } catch { return false; }
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Validates the versioned static source manifest; it does not verify legal interpretation. */
export function parseRuleLibrary(input: unknown): readonly RuleDefinition[] {
  const invalid = () => { throw new Error('RULE_LIBRARY_INVALID: expected ten source-checked, professionally unreviewed 2025 opportunities'); };
  if (!Array.isArray(input) || input.length !== requiredIds.length) return invalid();
  const ownerIds = ['irc_199a', 'irc_162l'];
  const creditIds = ['irc_45r', 'irc_45e', 'irc_44', 'irc_51', 'irc_45b'];
  const ids = input.map(entry => record(entry) ? entry.id : null);
  if (!unique(ids) || !requiredIds.every(id => ids.includes(id))) return invalid();
  for (const rule of input) {
    if (!record(rule) || !nonempty(rule.title) || !nonempty(rule.summary) || !nonempty(rule.scope_note) || !nonempty(rule.claimant_note) || !['credit', 'deduction'].includes(String(rule.type)) || rule.tax_year !== 2025 ||
      !strings(rule.entity_scope) || !unique(rule.entity_scope) || !rule.entity_scope.every(entity => entities.includes(entity as RuleEntity)) ||
      rule.claimant !== (ownerIds.includes(String(rule.id)) ? 'owner' : 'business') || rule.type !== (creditIds.includes(String(rule.id)) ? 'credit' : 'deduction') || (ownerIds.includes(String(rule.id)) && rule.entity_scope.some(entity => entity === 'c_corporation' || entity === 'tax_exempt')) || !strings(rule.missing_evidence) ||
      rule.professional_review_status !== 'not_reviewed' || rule.verification_status !== 'source_checked_offline_tests_only' || rule.live_e2e_status !== 'not_verified' ||
      rule.fixture_verification !== (rule.id === 'irc_45r' ? 'existing_45r_offline_fixture_flow' : 'not_implemented')) return invalid();
    if (!Array.isArray(rule.sources) || rule.sources.length === 0 || !rule.sources.every(source => record(source) && nonempty(source.title) && officialSource(source.url) && source.tax_year === 2025 && nonempty(source.verified_at) && /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}Z)?$/.test(source.verified_at) && Number.isFinite(Date.parse(source.verified_at)) && ['2025', 'current_revision', 'evergreen'].includes(String(source.edition)) && (source.edition === '2025' || nonempty(source.notes)))) return invalid();
    if (!Array.isArray(rule.conditions) || rule.conditions.length === 0 || !rule.conditions.every(condition => record(condition) && nonempty(condition.id) && nonempty(condition.description) && nonempty(condition.flag) && /^[a-z][a-z0-9_]*$/.test(condition.flag)) || !unique(rule.conditions.map(condition => condition.id)) || !unique(rule.conditions.map(condition => condition.flag))) return invalid();
  }
  return freeze(structuredClone(input) as RuleDefinition[]);
}

/** Bundled JSON only: importing the library performs no filesystem, provider or network calls. */
export const RULE_LIBRARY: readonly RuleDefinition[] = parseRuleLibrary(libraryData);

function entityFor(value: unknown): RuleEntity | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase().replace(/[ -]+/g, '_');
  const aliases: Record<string, RuleEntity> = {
    sole_proprietor: 'sole_proprietorship', sole_proprietorship: 'sole_proprietorship',
    partnership: 'partnership', s_corporation: 's_corporation', s_corp: 's_corporation',
    c_corporation: 'c_corporation', c_corp: 'c_corporation', tax_exempt: 'tax_exempt',
  };
  return Object.hasOwn(aliases, normalized) ? aliases[normalized] : null;
}
function answerFor(profile: RuleScreeningProfile | null, flag: RuleFlag): RuleAnswer {
  const supplied = profile?.opportunity_flags?.[flag];
  const health = flag === 'health_benefits_offered' ? profile?.health_benefits_offered : undefined;
  if (supplied !== undefined && health !== undefined && supplied !== health && supplied !== 'unknown' && health !== 'unknown') return 'unknown';
  const value = supplied ?? health;
  return value === 'yes' || value === 'no' ? value : 'unknown';
}

/**
 * Deterministic, conservative triage of owner-provided answers. A potential result is
 * a review candidate only; it never activates an unreviewed claim or computes tax.
 * Activity text is deliberately not used to infer qualifying expenditures or hires.
 */
export function evaluateRuleLibrary(profile: RuleScreeningProfile | null): RuleScreenResult[] {
  const entity = entityFor(profile?.federal_tax_classification);
  return RULE_LIBRARY.map(rule => {
    const result: RuleScreenResult = {
      rule_id: rule.id, status: 'needs_evidence', reasons: [], missing_evidence: [...rule.missing_evidence],
      professional_review_status: 'not_reviewed', legal_claim_activated: false, calculation_enabled: false,
    };
    if (profile && Number.isInteger(profile.tax_year) && profile.tax_year !== rule.tax_year) {
      result.status = 'out_of_scope';
      result.reasons.push('This source-backed screening library applies only to tax year 2025.');
      return result;
    }
    if (entity && !rule.entity_scope.includes(entity)) {
      result.status = 'out_of_scope';
      result.reasons.push('The stated federal tax classification is outside this rule’s current library scope; separate professional review may be needed.');
      return result;
    }
    const answers = rule.conditions.map(condition => ({ condition, answer: answerFor(profile, condition.flag) }));
    const negative = answers.filter(entry => entry.answer === 'no');
    if (negative.length > 0) {
      result.reasons.push(...negative.map(({ condition }) => 'The supplied answer is no for this screening condition; review is needed: ' + condition.description));
    }
    if (!profile || !Number.isInteger(profile.tax_year)) result.reasons.push('The tax year must be confirmed as 2025.');
    if (!entity) result.reasons.push('Confirm the federal tax classification; an LLC label alone does not establish it.');
    const unknown = answers.filter(entry => entry.answer === 'unknown');
    result.reasons.push(...unknown.map(({ condition }) => 'Evidence is needed for: ' + condition.description));
    if (profile?.tax_year === 2025 && entity && unknown.length === 0 && negative.length === 0) {
      result.status = 'potential_opportunity';
      result.reasons.push(rule.claimant === 'owner' ?
        'The supplied answers identify an owner-level review candidate; they do not establish a business return claim.' :
        'The supplied answers identify a review candidate; source documents and professional review remain required.');
    }
    return result;
  });
}
