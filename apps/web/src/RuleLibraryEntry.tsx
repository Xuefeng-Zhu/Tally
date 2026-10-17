import { Icon } from './Icons';
import { entityLabels, officialRuleSource, screeningLabels, sourceEditionLabels, type LibraryEntry } from './ruleLibraryPresentation';

export function RuleLibraryEntry({ entry: { rule, screening }, index, onReviewHealthCredit }: {
  entry: LibraryEntry; index: number; onReviewHealthCredit: () => void;
}) {
  const documentWorkflow = rule.fixture_verification === 'existing_45r_offline_fixture_flow';
  const missing = screening.missing_evidence.length ? screening.missing_evidence : rule.missing_evidence;
  return <details className="surface rule-entry" data-testid="library-rule" data-rule-id={rule.id}>
    <summary>
      <span className="rule-index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
      <span className="rule-entry-heading">
        <span className="rule-entry-meta"><span className={`rule-kind ${rule.type}`}>{rule.type === 'credit' ? 'Credit' : 'Deduction'}</span><span>2025</span><span>{rule.claimant === 'owner' ? 'Owner’s return' : 'Business claim'}</span></span>
        <strong>{rule.title}</strong>
        <span className="rule-workflow-label">{documentWorkflow ? 'Sample document workflow tested' : 'Profile screening only'}</span>
      </span>
      <span className={`rule-screening ${screening.status}`}>{screeningLabels[screening.status]}</span>
      <Icon name="chevron" size={17}/>
    </summary>
    <div className="rule-entry-content">
      <div className="rule-claimant-note"><Icon name="building" size={18}/><p><strong>{rule.claimant === 'owner' ? 'Claimed by the owner.' : 'Claimed by the business.'}</strong> {rule.claimant_note}</p></div>
      <p className="rule-summary">{rule.summary}</p>
      <div className="rule-detail-grid">
        <section aria-labelledby={`${rule.id}-conditions`}>
          <h3 id={`${rule.id}-conditions`}>Who this rule is for</h3>
          <p className="rule-entity-scope">{rule.entity_scope.map(entity => entityLabels[entity]).join(' · ')}</p>
          <p className="rule-scope-note">{rule.scope_note}</p>
          <ul className="rule-checklist">{rule.conditions.map(condition => <li key={condition.id}>{condition.description}</li>)}</ul>
          <div className="rule-profile-check"><h4>Profile check</h4><ul>{screening.reasons.map((reason, reasonIndex) => <li key={reasonIndex}>{reason}</li>)}</ul></div>
        </section>
        <section aria-labelledby={`${rule.id}-evidence`}>
          <h3 id={`${rule.id}-evidence`}>Evidence still needed</h3>
          <ul className="rule-checklist">{missing.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ul>
          {documentWorkflow && <button className="text-button rule-workflow-link" onClick={onReviewHealthCredit}>Open health credit workflow <Icon name="arrow" size={15}/></button>}
        </section>
      </div>
      <div className="rule-review-grid">
        <section className="rule-source-panel" aria-labelledby={`${rule.id}-sources`}>
          <h3 id={`${rule.id}-sources`}>Official sources</h3>
          <ul>{rule.sources.map((source, sourceIndex) => {
            const url = officialRuleSource(source.url);
            return <li key={sourceIndex}>{url ? <a href={url} target="_blank" rel="noopener noreferrer">{source.title}<Icon name="arrow" size={13}/><span className="sr-only"> (opens in a new tab)</span></a> : <span>{source.title} · Link unavailable</span>}<span className="rule-source-edition">{sourceEditionLabels[source.edition]}</span>{source.notes && <p className="rule-source-note">{source.notes}</p>}</li>;
          })}</ul>
        </section>
        <section className="rule-verification" aria-label="Review and testing status">
          <dl><div><dt>Source review</dt><dd>Official sources checked</dd></div><div><dt>Professional review</dt><dd>Pending</dd></div><div><dt>Testing</dt><dd>{documentWorkflow ? 'Sample document flow + offline checks' : 'Offline profile checks only'}</dd></div><div><dt>Live end-to-end</dt><dd>Not verified</dd></div><div><dt>Eligibility & amounts</dt><dd>Not determined</dd></div></dl>
        </section>
      </div>
    </div>
  </details>;
}
