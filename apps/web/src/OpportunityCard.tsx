import { useId, useRef, useState } from 'react';
import { ANNUAL_IDS, type State } from '../../../packages/contracts';
import { EvidencePanel } from './EvidencePanel';

const annualLabels: Record<string,string> = {
  annual_fte: 'Annual full-time equivalents', annual_fica_wages: 'Annual FICA wages', owner_family_exclusions: 'Owner & family exclusions', related_employer_aggregation: 'Related employer aggregation', shop_or_exception: 'SHOP coverage or an exception', qualifying_arrangement: 'Qualifying contribution arrangement', credit_period: 'Two-year credit period', annual_net_premiums_and_limits: 'Annual net premiums & limits',
};
const evidenceLabels: Record<string,string> = {recorded_insurance_payment:'Recorded insurance payment',partial_payroll:'Partial payroll records',coverage_period:'Coverage period',stated_premium_breakdown:'Stated premium split',payment_to_coverage_match:'Payment-to-coverage match'};
const resultLabels = {supported:'Supported',not_met:'Not met',unknown:'Unknown',conflicting:'Conflicting'};
const symbols = {supported:'✓',not_met:'×',unknown:'?',conflicting:'!'};

export function OpportunityCard({state, onNeedFixture}: {state: State; onNeedFixture: () => void}) {
  const opportunity = state.opportunity;
  const [expanded, setExpanded] = useState(false);
  const annualRef = useRef<HTMLHeadingElement>(null);
  const id = useId();
  if (!opportunity) return null;
  const needsCoverage = opportunity.next_action.id === 'upload_coverage_statement';
  function primaryAction() {
    if (needsCoverage) {
      if (state.upload_url) window.open(state.upload_url, '_blank', 'noopener,noreferrer');
      else onNeedFixture();
    } else {
      setExpanded(true);
      setTimeout(() => { annualRef.current?.scrollIntoView({behavior:'smooth',block:'nearest'}); annualRef.current?.focus({preventScroll:true}); }, 0);
    }
  }
  return <article className="opportunity-card" data-testid="opportunity-card" data-opportunity-id={opportunity.opportunity_id} aria-labelledby={`${id}-title`}>
    <div className="card-topline"><span className="opportunity-badge"><span aria-hidden="true">✧</span> Potential opportunity</span><span className="rule-label">IRC §45R · 2025</span></div>
    <div className="opportunity-intro"><p className="eyebrow">Small business, clearer records</p><h2 id={`${id}-title`}>Small employer health<br className="desktop-break" /> insurance tax credit</h2><p className="card-summary">{opportunity.summary}</p></div>
    <div className="assessment-note"><span className="note-mark" aria-hidden="true">i</span><p>{opportunity.stage === 'needs_review' ? 'Some current evidence needs review. Earlier records remain in the source history.' : opportunity.stage === 'evidence_updated' ? 'The evidence has been updated. Annual requirements still need to be resolved.' : 'The records point to a question worth exploring. More coverage evidence is needed.'}</p></div>
    <section className="checks-section" aria-labelledby={`${id}-evidence`}><div className="subsection-heading"><h3 id={`${id}-evidence`}>What the records support</h3><span>Document evidence</span></div><div className="check-list">{opportunity.evidence_checks.map(check => <div className="check-row" key={check.requirement_id}><span className={`check-icon ${check.result}`} aria-hidden="true">{symbols[check.result]}</span><div><span className="check-title">{evidenceLabels[check.requirement_id] ?? check.requirement_id.replace(/_/g,' ')}</span><p>{check.reason}</p></div><span className={`result-label ${check.result}`}>{resultLabels[check.result]}</span></div>)}</div></section>
    {opportunity.reported_employer_share_basis_points !== null && <div className="share-note"><span>Stated employer premium share</span><strong>{opportunity.reported_employer_share_basis_points / 100}%</strong><p>A stated split does not establish a qualifying annual arrangement.</p></div>}
    <div className="next-step"><div><span className="eyebrow">Your next step</span><p>{needsCoverage ? 'Add the coverage statement to connect the records.' : opportunity.stage === 'needs_review' ? 'Review the evidence and remaining annual questions.' : 'Review what is still needed for the annual assessment.'}</p></div><button className="button primary" data-testid="primary-action" onClick={primaryAction} aria-expanded={!needsCoverage ? expanded : undefined} aria-controls={!needsCoverage ? `${id}-annual` : 'fixture-controls'}>{opportunity.next_action.label}<span aria-hidden="true">↗</span></button></div>
    <EvidencePanel state={state} />
    <section className={`annual-panel ${expanded ? 'expanded' : ''}`} id={`${id}-annual`} data-testid="remaining-requirements" aria-labelledby={`${id}-annual-title`}>
      <button className="annual-toggle" onClick={() => setExpanded(value => !value)} aria-expanded={expanded} aria-controls={`${id}-annual-body`}><span><span className="tiny-symbol" aria-hidden="true">◷</span> Annual requirements <span className="unresolved-label">Unresolved</span></span><span className="expand-symbol" aria-hidden="true">{expanded ? '−' : '+'}</span></button>
      <div id={`${id}-annual-body`} hidden={!expanded}>
        <div className="annual-content"><h3 id={`${id}-annual-title`} ref={annualRef} tabIndex={-1}>The annual picture is still open.</h3><p className="annual-intro">Document evidence and annual requirements are separate. These checks need full-year information and further review.</p><div data-testid="annual-requirements" className="annual-list">{ANNUAL_IDS.map(requirementId => {
          const check = opportunity.annual_requirements.find(item => item.requirement_id === requirementId);
          const result = check?.result ?? 'unknown';
          return <div className="annual-row" key={requirementId} data-requirement-id={requirementId}><div><strong>{annualLabels[requirementId]}</strong><p>{check?.reason ?? 'Annual information has not been established.'}</p></div><span className={`annual-result ${result}`}>{resultLabels[result]}</span></div>;
        })}</div><div className="estimate-note"><span aria-hidden="true">—</span><div><strong>Annual estimate unavailable</strong><p>{opportunity.estimate.reason}</p></div></div></div>
      </div>
    </section>
    <footer className="card-footer"><span>Historical 2025 demonstration</span><span>Evidence revision {opportunity.revision}</span></footer>
  </article>;
}
