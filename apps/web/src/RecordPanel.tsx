import type { State } from '../../../packages/contracts';

const statusLabels: Record<string, string> = { queued: 'Queued', extracting: 'Extracting', validating: 'Validating', ledger_committed: 'Evidence saved', evaluating: 'Evaluating', completed: 'Complete', needs_review: 'Needs review', failed: 'Failed' };
type Props = { state: State; intakeMode: State['execution']['intake_mode']; busy: string | null; onLoad: (id: 'fixture-A' | 'fixture-B') => Promise<boolean>; onAnalyzeInbox: () => Promise<boolean>; onReconcile: () => Promise<boolean>; highlighted: boolean };
export function RecordPanel({state, intakeMode, busy, onLoad, onAnalyzeInbox, onReconcile, highlighted}: Props) {
  const fixtureMode = intakeMode === 'fixture';
  const intakeFailures = state.jobs.filter(job => job.kind === 'INGEST' && job.file_id !== null && (job.status === 'failed' || job.status === 'needs_review') && !state.documents.some(document => document.file_id === job.file_id));
  return <section className={`panel record-panel ${highlighted ? 'is-highlighted' : ''}`} id="fixture-controls" aria-labelledby="record-heading" tabIndex={-1}>
    <div className="section-heading"><span className="section-number">02</span><h2 id="record-heading">The records</h2></div>
    {fixtureMode ? <>
      <p className="panel-intro">Load a local simulation of each document to see the evidence change.</p>
      <div className="fixture-option"><span className="file-tab">A</span><div><strong>Payment & payroll</strong><p>Partial-period records</p></div><button className="button compact" data-testid="fixture-A" disabled={!!busy || !state.profile} onClick={() => void onLoad('fixture-A')}>{busy === 'fixture-A' ? 'Loading…' : 'Load fixture A'}</button></div>
      <div className="fixture-option"><span className="file-tab ochre">B</span><div><strong>Coverage statement</strong><p>Coverage & stated premium split</p></div><button className="button compact" data-testid="fixture-B" disabled={!!busy || !state.profile} onClick={() => void onLoad('fixture-B')}>{busy === 'fixture-B' ? 'Loading…' : 'Load fixture B'}</button></div>
      <p className="fixture-note">Fixture controls simulate ingestion locally. They do not upload files to Box.</p>
      {highlighted && !state.upload_url && <p className="destination-note" role="status">The original Box upload destination is pending. Load fixture B here to continue the local demonstration.</p>}
    </> : <>
      <p className="panel-intro">Open the configured Box inbox to add records, then analyze the current inbox here.</p>
      {state.upload_url ? <a className="button secondary full-width" data-testid="box-inbox" href={state.upload_url} target="_blank" rel="noreferrer">Open Box inbox<span aria-hidden="true">↗</span><span className="sr-only"> (opens in a new tab)</span></a> : <p className="destination-note" role="status">The Box inbox destination is not configured yet.</p>}
      <button className="button primary full-width" data-testid="analyze-inbox" disabled={!!busy || !state.profile || !state.upload_url} onClick={() => void onAnalyzeInbox()}>{busy === 'inbox' ? 'Queuing inbox…' : 'Analyze inbox'}<span aria-hidden="true">↗</span></button>
      <p className="field-note">{intakeMode === 'webhook' ? 'Webhook intake is selected. Analyze inbox also checks the current folder contents.' : 'Manual intake is selected. Analysis begins when you choose Analyze inbox.'}</p>
    </>}
    {!state.profile && <p className="field-note">Save your business context to begin.</p>}
    {state.documents.length > 0 && <div className="document-list"><h3>Source documents <span>{state.documents.length}</span></h3>{state.documents.map(document => <article className="document-row" key={document.file_id}>
      <span className="document-icon" aria-hidden="true">▤</span><div><a href={document.source_url} target="_blank" rel="noreferrer">{document.name}<span className="sr-only"> (opens in a new tab)</span><span aria-hidden="true"> ↗</span></a><span className={`document-status ${document.status === 'failed' || document.status === 'needs_review' ? 'attention' : ''}`}>{statusLabels[document.status] ?? document.status}</span>{document.error && <p className="document-error">{document.error}</p>}{document.aliases.length > 0 && <p className="field-note">{document.aliases.length} linked duplicate {document.aliases.length === 1 ? 'source' : 'sources'}</p>}</div>
    </article>)}</div>}
    {intakeFailures.length > 0 && <section className="intake-errors" aria-labelledby="intake-errors-heading" data-testid="intake-job-errors" role="status"><h3 id="intake-errors-heading">Sources needing attention</h3>{intakeFailures.map(job => <article className="document-row" key={job.job_id}>
      <span className="document-icon" aria-hidden="true">!</span><div><strong>File {job.file_id}</strong><span className="document-status attention">{statusLabels[job.status]}</span><p>We could not prepare this source for analysis. Review the file in Box before trying again.</p><p className="intake-error-code">Error code: <code>{job.error && /^[A-Z][A-Z0-9_]{0,99}$/.test(job.error) ? job.error : 'INTAKE_REVIEW_REQUIRED'}</code></p></div>
    </article>)}</section>}
    {state.pending_evaluation && <div className="reconcile-note"><p>Evidence is saved. An assessment update is pending.</p><button className="text-button" disabled={!!busy} onClick={() => void onReconcile()}>{busy === 'reconcile' ? 'Reconciling…' : 'Reconcile evidence'} <span aria-hidden="true">↻</span></button></div>}
  </section>;
}
