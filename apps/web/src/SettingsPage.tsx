import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import type { Profile, State } from '../../../packages/contracts';
import { ProfilePanel } from './ProfilePanel';
import './settings.css';

export type SettingsSection = 'business' | 'connections' | 'samples';
export type SettingsPageProps = {
  state: State;
  busy: string | null;
  onSave: (profile: Profile) => Promise<boolean>;
  onLoad: (id: 'fixture-A' | 'fixture-B') => Promise<boolean>;
  onReconcile: () => Promise<boolean>;
  initialSection?: SettingsSection;
};

export function SettingsPage({state, busy, onSave, onLoad, onReconcile, initialSection = 'business'}: SettingsPageProps) {
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const id = useId();
  const fixtureMode = state.execution.intake_mode === 'fixture';
  const tabs: {id: SettingsSection; label: string}[] = [
    {id:'business',label:'Business profile'},
    {id:'connections',label:'Connections'},
    ...(fixtureMode ? [{id:'samples' as const,label:'Sample workspace'}] : []),
  ];
  const currentSection = section === 'samples' && !fixtureMode ? 'business' : section;
  useEffect(() => { setSection(initialSection); }, [initialSection]);

  function moveTab(event: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = tabs.findIndex(tab => tab.id === currentSection);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    setSection(tabs[next].id);
    document.getElementById(`${id}-tab-${tabs[next].id}`)?.focus();
  }

  return <div className="settings-page">
    <header className="settings-page-header"><h1>Settings</h1><p className="muted">Your business context and connections, in one place.</p></header>
    <div className="settings-tabs" role="tablist" aria-label="Settings sections" onKeyDown={moveTab}>
      {tabs.map(tab => <button key={tab.id} id={`${id}-tab-${tab.id}`} type="button" role="tab" data-testid={`settings-${tab.id}`} aria-selected={currentSection === tab.id} aria-controls={`${id}-panel-${tab.id}`} tabIndex={currentSection === tab.id ? 0 : -1} onClick={() => setSection(tab.id)}>{tab.label}</button>)}
    </div>
    <div className="settings-tab-panel" id={`${id}-panel-${currentSection}`} role="tabpanel" aria-labelledby={`${id}-tab-${currentSection}`}>
      {currentSection === 'business' && <ProfilePanel profile={state.profile} busy={busy} onSave={onSave} />}
      {currentSection === 'connections' && <Connections state={state} />}
      {currentSection === 'samples' && fixtureMode && <SampleWorkspace state={state} busy={busy} onLoad={onLoad} onReconcile={onReconcile} />}
    </div>
  </div>;
}

function Connections({state}: {state: State}) {
  const explanationRan = ['live_bedrock','live_openrouter'].includes(state.execution.explanation_mode);
  return <section className="surface settings-connections" aria-labelledby="connections-heading">
    <header className="settings-section-header"><div><h2 id="connections-heading">Connections</h2><p className="muted">Where your records and explanations come from.</p></div></header>
    <article className="settings-connection-row">
      <div className="settings-service-icon settings-box-icon" aria-hidden="true">box</div>
      <div className="settings-connection-body"><div className="settings-connection-title"><h3>Box inbox</h3><span className="status-chip">{state.upload_url ? 'Inbox configured' : 'Not connected'}</span></div><p className="muted">{state.upload_url ? 'A destination is configured for your business documents. Connection access is verified when you analyze the inbox.' : 'Connect a Box inbox to bring your business documents into Tally.'}</p>{state.upload_url && <a className="text-button" href={state.upload_url} target="_blank" rel="noreferrer" data-testid="settings-box-inbox">Open Box inbox <span aria-hidden="true">↗</span><span className="settings-visually-hidden"> (opens in a new tab)</span></a>}</div>
    </article>
    <article className="settings-connection-row">
      <div className="settings-service-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" stroke="currentColor" strokeWidth="1.5" /></svg></div>
      <div className="settings-connection-body"><div className="settings-connection-title"><h3>AI explanations</h3><span className="status-chip">{explanationRan ? 'Previously used' : state.execution.explanation_mode === 'fixture' ? 'Sample mode' : 'Not verified'}</span></div><p className="muted">{explanationRan ? `The last explanation used ${state.execution.explanation_mode === 'live_openrouter' ? 'OpenRouter' : 'Amazon Bedrock'}. It summarizes the evidence while annual checks remain separate.` : state.execution.explanation_mode === 'fixture' ? 'This workspace is using local sample explanations.' : state.execution.explanation_mode === 'deterministic_fallback' ? 'The latest explanation used the built-in fallback. Provider access is not verified here.' : 'A live explanation has not run in this workspace.'}</p></div>
    </article>
    <footer className="settings-connection-footer"><span aria-hidden="true">↗</span><p>Connection setup is handled separately. You do not need to enter credentials here.</p></footer>
  </section>;
}

function SampleWorkspace({state, busy, onLoad, onReconcile}: Pick<SettingsPageProps,'state'|'busy'|'onLoad'|'onReconcile'>) {
  const samples = [
    {id:'fixture-A' as const,title:'Payment & payroll sample',description:'A recorded insurance payment and a partial payroll period.',label:'Add payment & payroll sample'},
    {id:'fixture-B' as const,title:'Coverage statement sample',description:'The coverage period and a stated employer and employee premium split.',label:'Add coverage statement sample'},
  ];
  return <section className="surface settings-samples" aria-labelledby="samples-heading">
    <header className="settings-section-header"><div><h2 id="samples-heading">Try a sample workspace</h2><p className="muted">See how a second document changes the next step.</p></div><span className="status-chip settings-sample-chip">Local samples</span></header>
    <p className="settings-sample-intro">Use these fictional records to explore Tally. Start with the payment and payroll records, then add the coverage statement.</p>
    <div className="settings-sample-list">{samples.map(sample => {
      const source = state.documents.find(document => document.file_id === sample.id);
      const sourceNeedsReview = source && ['failed','needs_review'].includes(source.status);
      return <article className="settings-sample-card" key={sample.id}>
        <div className="settings-sample-icon" aria-hidden="true"><svg viewBox="0 0 32 40" fill="none"><path d="M5 2h15l8 8v28H5V2Z" stroke="currentColor" strokeWidth="1.4" /><path d="M20 2v9h8M10 19h13M10 25h13M10 31h8" stroke="currentColor" strokeWidth="1.4" /></svg></div>
        <div><div className="settings-sample-title"><h3>{sample.title}</h3>{source && <span className="settings-loaded-state">{sourceNeedsReview ? 'Needs review' : source.status === 'completed' ? 'Added' : 'Processing'}</span>}</div><p className="muted">{sample.description}</p><button className="button button-secondary" data-testid={sample.id} disabled={!!busy || !state.profile} onClick={() => void onLoad(sample.id)}>{busy === sample.id ? 'Adding sample…' : sample.label}<span aria-hidden="true">↗</span></button></div>
      </article>;
    })}</div>
    {!state.profile && <p className="settings-sample-guidance" role="status">Save your business profile before adding samples.</p>}
    {state.pending_evaluation && <div className="settings-pending-update"><p>An assessment update is pending.</p><button className="text-button" disabled={!!busy} onClick={() => void onReconcile()}>{busy === 'reconcile' ? 'Updating…' : 'Update assessment'} <span aria-hidden="true">↻</span></button></div>}
    <p className="settings-sample-footnote">Sample documents use local extraction. Connections shows the source of the latest explanation.</p>
  </section>;
}
