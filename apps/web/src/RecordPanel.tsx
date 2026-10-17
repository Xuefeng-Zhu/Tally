import type { State } from '../../../packages/contracts';

const statusLabels: Record<string, string> = { queued: 'Queued', extracting: 'Extracting', validating: 'Validating', ledger_committed: 'Evidence saved', evaluating: 'Evaluating', completed: 'Complete', needs_review: 'Needs review', failed: 'Failed' };
type Props = { state: State; busy: string | null; onLoad: (id: 'fixture-A' | 'fixture-B') => Promise<boolean>; onReconcile: () => Promise<boolean>; highlighted: boolean };
export function RecordPanel({state, busy, onLoad, onReconcile, highlighted}: Props) {
  return <section className={`panel record-panel ${highlighted ? 'is-highlighted' : ''}`} id="fixture-controls" aria-labelledby="record-heading" tabIndex={-1}>
    <div className="section-heading"><span className="section-number">02</span><h2 id="record-heading">The records</h2></div>
    <p className="panel-intro">Load a local simulation of each document to see the evidence change.</p>
    <div className="fixture-option"><span className="file-tab">A</span><div><strong>Payment & payroll</strong><p>Partial-period records</p></div><button className="button compact" data-testid="fixture-A" disabled={!!busy || !state.profile} onClick={() => void onLoad('fixture-A')}>{busy === 'fixture-A' ? 'Loading…' : 'Load fixture A'}</button></div>
    <div className="fixture-option"><span className="file-tab ochre">B</span><div><strong>Coverage statement</strong><p>Coverage & stated premium split</p></div><button className="button compact" data-testid="fixture-B" disabled={!!busy || !state.profile} onClick={() => void onLoad('fixture-B')}>{busy === 'fixture-B' ? 'Loading…' : 'Load fixture B'}</button></div>
    {!state.profile && <p className="field-note">Save your business context to begin.</p>}
    <p className="fixture-note">Fixture controls simulate ingestion locally. They do not upload files to Box.</p>
    {highlighted && !state.upload_url && <p className="destination-note" role="status">The original Box upload destination is pending. Load fixture B here to continue the local demonstration.</p>}
    {state.documents.length > 0 && <div className="document-list"><h3>Source documents <span>{state.documents.length}</span></h3>{state.documents.map(document => <article className="document-row" key={document.file_id}>
      <span className="document-icon" aria-hidden="true">▤</span><div><a href={document.source_url} target="_blank" rel="noreferrer">{document.name}<span className="sr-only"> (opens in a new tab)</span><span aria-hidden="true"> ↗</span></a><span className={`document-status ${document.status === 'failed' || document.status === 'needs_review' ? 'attention' : ''}`}>{statusLabels[document.status] ?? document.status}</span>{document.error && <p className="document-error">{document.error}</p>}{document.aliases.length > 0 && <p className="field-note">{document.aliases.length} linked duplicate {document.aliases.length === 1 ? 'source' : 'sources'}</p>}</div>
    </article>)}</div>}
    {state.pending_evaluation && <div className="reconcile-note"><p>Evidence is saved. An assessment update is pending.</p><button className="text-button" disabled={!!busy} onClick={() => void onReconcile()}>{busy === 'reconcile' ? 'Reconciling…' : 'Reconcile evidence'} <span aria-hidden="true">↻</span></button></div>}
  </section>;
}
