import { useState } from 'react';
import { emptyState } from '../../../packages/contracts';
import { OpportunityCard } from './OpportunityCard';
import { ProfilePanel } from './ProfilePanel';
import { RecordPanel } from './RecordPanel';
import { useWorkspace } from './useWorkspace';
import { WorkspaceStatus } from './WorkspaceStatus';

function TallyMark() { return <svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M11 9v22M19 9v22M27 9v22M7 26l26-12" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" /></svg>; }
const extractionLabels = {fixture:'Fixture',live_box_ai:'Live Box AI',not_run:'Not run'};
const intakeLabels = {fixture:'Fixture simulation',manual:'Manual Box inbox',webhook:'Box webhook'};
const explanationLabels = {fixture:'Fixture',live_bedrock:'Live Bedrock',deterministic_fallback:'Deterministic fallback',not_run:'Not run'};
export function App() {
  const workspace = useWorkspace();
  const state = workspace.state ?? emptyState();
  const [recordsHighlighted, setRecordsHighlighted] = useState(false);
  const fixtureMode = state.execution.intake_mode === 'fixture';
  function showRecords() {
    setRecordsHighlighted(true);
    const panel = document.getElementById('fixture-controls');
    panel?.scrollIntoView({behavior:'smooth',block:'center'});
    panel?.focus({preventScroll:true});
  }
  return <div className="app-shell">
    <a className="skip-link" href="#main">Skip to workspace</a>
    <header className="site-header"><a className="brand" href="/" aria-label="Tally home"><TallyMark /><span>Tally<span className="brand-period">.</span></span></a><span className="brand-description">Evidence, in order.</span><span className="demo-chip"><span aria-hidden="true" /> Synthetic demo</span></header>
    <main id="main">
      <div className="page-intro"><div><p className="eyebrow">Your business notebook <span aria-hidden="true">/</span> Tax year 2025</p><h1>Make sense of<br /><em>what comes next.</em></h1></div><div className="intro-aside"><span className="folio-mark" aria-hidden="true">§</span><p>Start with the records.<br />Follow the evidence.<br />Keep the open questions visible.</p></div></div>
      <aside className="demo-notice" aria-label="Demonstration context"><span className="notice-symbol" aria-hidden="true">✳</span><p>A synthetic business. Historical 2025 records. A working demonstration of how evidence changes the next step.</p><span className="mode-label">{fixtureMode ? 'Local fixture mode' : state.execution.intake_mode === 'webhook' ? 'Box webhook mode' : 'Manual Box inbox'}</span></aside>
      {workspace.error && <div className="error-banner" role="alert"><strong>That step needs another look.</strong><p>{workspace.error.message}</p>{workspace.error.details?.correlation_id && <span>Reference: {workspace.error.details.correlation_id}</span>}<p>Your saved records will appear when the local server reconnects.</p></div>}
      {workspace.loading ? <div className="loading-state" role="status"><TallyMark /><p>Opening your notebook…</p></div> : <div className="workspace-grid"><aside className="workspace-sidebar"><ProfilePanel profile={state.profile} busy={workspace.busy} onSave={workspace.saveProfile} /><RecordPanel state={state} intakeMode={state.execution.intake_mode} busy={workspace.busy} onLoad={workspace.loadFixture} onAnalyzeInbox={workspace.analyzeInbox} onReconcile={workspace.reconcile} highlighted={recordsHighlighted} /></aside><div className="workspace-main">
        <div className="workspace-heading"><div><span className="section-number">03</span><h2>The next step</h2></div><WorkspaceStatus jobs={state.jobs} busy={workspace.busy} /></div>
        {state.opportunity ? <OpportunityCard state={state} onNeedFixture={showRecords} /> : <section className="empty-notebook" aria-labelledby="empty-title"><div className="paper-stack" aria-hidden="true"><div className="paper-back" /><div className="paper-front"><span>A</span><i /><i /><i /><div className="paper-seal"><TallyMark /></div></div></div><p className="eyebrow">Every good next step has a source.</p><h2 id="empty-title">Start with the records.</h2><p>{fixtureMode ? 'Save your business context, then load a fixture.' : 'Save your business context, then analyze your Box inbox.'}<br />Tally will connect the evidence and keep the<br className="desktop-break" /> remaining questions in view.</p><button className="text-button" onClick={showRecords}>{fixtureMode ? 'Go to the local fixtures' : 'Go to Box inbox controls'} <span aria-hidden="true">↙</span></button><span className="empty-caption">No assessment before evidence.</span></section>}
        <div className="provenance-strip" aria-label="Execution details"><div><span>Intake</span><strong>{intakeLabels[state.execution.intake_mode]}</strong></div><div><span>Extraction</span><strong>{extractionLabels[state.execution.extraction_mode]}</strong></div><div><span>Explanation</span><strong>{explanationLabels[state.execution.explanation_mode]}</strong></div></div>
        {state.specification_status === 'interim_reconstructed' && <p className="interim-note"><span aria-hidden="true">◇</span> Interim reconstructed contracts & fixtures. Reconciliation with the original handoff is pending.</p>}
      </div></div>}
    </main>
    <footer className="site-footer"><span>Tally<span className="brand-period">.</span> <span className="footer-tagline">A little more clarity.</span></span><span>Synthetic data · Historical 2025 · Annual requirements unresolved</span></footer>
  </div>;
}
