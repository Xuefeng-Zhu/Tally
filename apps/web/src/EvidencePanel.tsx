import type { Document, Fact, State } from '../../../packages/contracts';

const factLabels: Record<string, string> = { reported_employer_share_basis_points: 'Reported employer premium share', recorded_payment_amount: 'Recorded insurance payment', recorded_payment_date: 'Recorded payment date', payroll_total_hours: 'Recorded payroll hours', payroll_gross_wages: 'Partial payroll wages', payroll_worker_count: 'Recorded payroll workers', stated_total_premium: 'Stated total premium', stated_employer_contribution: 'Stated employer contribution', stated_employee_contribution: 'Stated employee contribution', insurance_payment: 'Recorded insurance payment', insurance_payment_amount: 'Insurance payment amount', insurance_payment_amount_cents:'Insurance payment amount', payment_date: 'Payment date', payroll_hours: 'Recorded payroll hours', payroll_wages: 'Partial payroll wages', payroll_wages_cents: 'Partial payroll wages', coverage_start: 'Coverage begins', coverage_end: 'Coverage ends', coverage_period: 'Coverage period', total_premium: 'Stated total premium', total_premium_cents:'Stated total premium', employer_premium: 'Stated employer premium', employer_premium_cents:'Stated employer premium', employee_premium:'Stated employee premium', employee_premium_cents:'Stated employee premium', employer_share_basis_points: 'Stated employer share' };
export function humanize(value: string) { return value.replace(/_/g, ' ').replace(/^./, initial => initial.toUpperCase()); }
function factValue(fact: Fact): string {
  if (fact.value_state === 'unknown' || fact.value === null) return 'Unknown';
  if (fact.unit === 'USD_cents' && typeof fact.value === 'number') return new Intl.NumberFormat('en-US', {style:'currency',currency:'USD'}).format(fact.value / 100);
  if (fact.unit === 'basis_points' && typeof fact.value === 'number') return `${fact.value / 100}%`;
  if (fact.unit === 'hours') return `${fact.value} hours`;
  if (typeof fact.value === 'boolean') return fact.value ? 'Yes' : 'No';
  return String(fact.value);
}
const activeSourceStatuses = new Set<Document['status']>(['ledger_committed', 'evaluating', 'completed']);

export function resolveEvidenceSource(documents: Document[], fact: Fact): Document | undefined {
  if (!fact.source.sha256) return undefined;
  const currentMatches = documents.filter(document =>
    document.sha256 === fact.source.sha256 &&
    document.accepted_version === document.file_version_id &&
    activeSourceStatuses.has(document.status)
  );
  // A canonical fact may outlive its original file through an unchanged content alias.
  return currentMatches.find(document => document.file_id === fact.source.file_id)
    ?? currentMatches.find(document => document.aliases.includes(fact.source.file_id ?? ''))
    ?? currentMatches[0];
}

export function EvidencePanel({state}: {state: State}) {
  const ids = new Set(state.opportunity?.fact_ids ?? []);
  const facts = state.facts.filter(fact => ids.has(fact.fact_id) || fact.verification_state === 'needs_review');
  return <section className="evidence-panel"><div className="section-heading"><h2>Source evidence</h2><span className="muted">{facts.length} recorded details</span></div>
    <div className="evidence-body"><p className="field-note">Each fact keeps its source, period, and verification state. Partial records do not establish annual requirements.</p>
      {facts.length === 0 ? <p>No active facts are attached to this assessment.</p> : <div className="fact-list">{facts.map(fact => {
        const source = resolveEvidenceSource(state.documents, fact);
        const locator = fact.source.locator;
        const page = locator.kind === 'verified_page' && locator.page !== null ? `Verified page ${locator.page}` : locator.kind === 'file_only' ? 'File-level reference' : 'Page reference unavailable';
        return <article className="fact-row" key={fact.fact_id}>
          <div className="fact-title"><h3>{factLabels[fact.fact_type] ?? humanize(fact.fact_type)}</h3><strong>{factValue(fact)}</strong></div>
          <div className="fact-meta"><span className={fact.verification_state === 'needs_review' ? 'review-state' : ''}>{fact.verification_state==='source_supported'?'Matches the document':fact.verification_state==='derived'?'Calculated from these records':fact.verification_state==='needs_review'?'Needs attention':humanize(fact.verification_state)}</span><span>{fact.relevant_period.scope==='partial_period'?'Part of the year':fact.relevant_period.scope==='point_in_time'?'Recorded date':humanize(fact.relevant_period.scope)}{fact.relevant_period.start ? ` · ${fact.relevant_period.start}` : ''}{fact.relevant_period.end ? ` to ${fact.relevant_period.end}` : ''}</span></div>
          {fact.source.excerpt && <blockquote>“{fact.source.excerpt}”</blockquote>}
          {source ? <a className="source-link" data-testid="evidence-link" href={source.source_url} target="_blank" rel="noreferrer">{source.name} <span aria-hidden="true">↗</span><span className="sr-only"> (opens in a new tab)</span></a> : <span className="field-note">{fact.source.kind === 'owner_provided' ? 'Synthetic owner-provided context' : fact.source.kind === 'deterministic_derivation' ? 'Derived from referenced input facts' : 'Source link unavailable'}</span>}
          {(fact.source.kind === 'box_document' || fact.source.kind === 'fixture_document') && <span className="locator">{page}{fact.source.excerpt_validation === 'matched' ? ' · excerpt matched' : fact.source.excerpt_validation === 'failed' ? ' · excerpt needs review' : ''}</span>}
        </article>;
      })}</div>}
    </div>
  </section>;
}
