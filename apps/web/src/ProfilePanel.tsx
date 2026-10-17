import { createContext, useContext, useId, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { CONTEXT, DEFAULT_PROFILE, type Profile } from '../../../packages/contracts';
import './settings.css';

type Props = {
  profile: Profile | null;
  busy: string | null;
  onSave: (profile: Profile) => Promise<boolean>;
};

type DraftState = {
  draft: { businessId: string; profile: Profile } | null;
  saveResult: 'idle' | 'saved' | 'failed';
};
type DraftStore = { state: DraftState; setState: Dispatch<SetStateAction<DraftState>> };
const emptyDraftState: DraftState = { draft: null, saveResult: 'idle' };
const ProfileDraftContext = createContext<DraftStore | null>(null);

/** Keeps only unsaved context in memory for this fixed business across page navigation. */
export function ProfileDraftProvider({children}: {children: ReactNode}) {
  const [state, setState] = useState<DraftState>(emptyDraftState);
  return <ProfileDraftContext.Provider value={{state, setState}}>{children}</ProfileDraftContext.Provider>;
}

const choiceFields = [
  ['owner_on_payroll', 'Owner on payroll?'],
  ['family_on_payroll', 'Family on payroll?'],
  ['related_employers', 'Related employers?'],
  ['prior_credit_history', 'Prior credit history?'],
] as const;

export function ProfilePanel({ profile, busy, onSave }: Props) {
  const sharedStore = useContext(ProfileDraftContext);
  const [localState, setLocalState] = useState<DraftState>(emptyDraftState);
  const {state: draftState, setState: setDraftState} = sharedStore ?? {state: localState, setState: setLocalState};
  const storedDraft = draftState.draft?.businessId === CONTEXT.business_id ? draftState.draft.profile : null;
  const draft = storedDraft ?? profile ?? DEFAULT_PROFILE;
  const dirty = storedDraft !== null;
  const saveResult = draftState.saveResult;
  const id = useId();

  function update<K extends keyof Profile>(key: K, value: Profile[K]) {
    setDraftState(current => {
      const previous = current.draft?.businessId === CONTEXT.business_id ? current.draft.profile : profile ?? DEFAULT_PROFILE;
      return {draft: {businessId: CONTEXT.business_id, profile: {...previous, [key]: value}}, saveResult: 'idle'};
    });
  }

  return <section className="surface settings-profile" aria-labelledby={`${id}-heading`}>
    <header className="settings-section-header">
      <div><h2 id={`${id}-heading`}>Business details</h2><p className="muted">The context behind your documents and opportunities.</p></div>
      <span className="status-chip settings-sample-chip">Sample business</span>
    </header>
    <form data-testid="profile-form" onInvalidCapture={event => {
      const details = (event.target as HTMLElement).closest('details');
      if (details) details.open = true;
    }} onSubmit={async event => {
      event.preventDefault();
      const submittedDraft = storedDraft;
      const saved = await onSave(draft);
      setDraftState(current => {
        // Preserve any edits made while the submitted profile was being saved.
        if (saved && current.draft !== null && current.draft.profile !== submittedDraft) return current;
        return saved ? {draft: null, saveResult: 'saved'} : {...current, saveResult: 'failed'};
      });
    }}>
      <dl className="settings-identity" aria-label="Fixed sample business identity">
        <div className="settings-identity-wide"><dt>Business name</dt><dd>{draft.display_name}</dd></div>
        <div><dt>What you do</dt><dd>{draft.activity}</dd></div>
        <div><dt>Operating state</dt><dd>{draft.operating_states.join(', ')}</dd></div>
      </dl>
      <p className="settings-field-help">This sample workspace uses a fixed business identity. You can update the context below.</p>

      <details className="settings-profile-disclosure">
        <summary><span><strong>People & health benefits</strong><span>Headcount and the benefits you offer</span></span><span className="settings-disclosure-plus" aria-hidden="true">+</span></summary>
        <fieldset className="settings-fieldset settings-disclosure-fields">
          <legend className="settings-visually-hidden">People and health benefits</legend>
          <div className="field settings-field">
            <label htmlFor={`${id}-people`}>Approx. headcount</label>
            <input id={`${id}-people`} type="number" min="0" max="100" step="1" value={Number.isNaN(draft.approximate_headcount) ? '' : draft.approximate_headcount} onChange={event => update('approximate_headcount', event.target.valueAsNumber)} required />
          </div>
          <div className="field settings-field">
            <label htmlFor={`${id}-asof`}>Headcount as of</label>
            <input id={`${id}-asof`} type="date" value={draft.headcount_as_of} onChange={event => update('headcount_as_of', event.target.value)} required />
          </div>
          <div className="field settings-field settings-field-wide">
            <label htmlFor={`${id}-benefits`}>Health benefits offered?</label>
            <select id={`${id}-benefits`} value={draft.health_benefits_offered} onChange={event => update('health_benefits_offered', event.target.value as Profile['health_benefits_offered'])}>
              <option value="yes">Yes</option><option value="no">No</option><option value="unknown">Unknown</option>
            </select>
            <p className="settings-field-help">Approximate headcount is context. Annual workforce requirements still need full-year records.</p>
          </div>
        </fieldset>
      </details>

      <details className="settings-profile-disclosure">
        <summary><span><strong>Tax & ownership</strong><span>Business structure and annual context</span></span><span className="settings-disclosure-plus" aria-hidden="true">+</span></summary>
        <fieldset className="settings-fieldset settings-disclosure-fields">
          <legend className="settings-visually-hidden">Tax and ownership</legend>
          <dl className="settings-identity settings-tax-identity settings-field-wide" aria-label="Fixed sample tax details">
            <div><dt>Tax year</dt><dd>{draft.tax_year}</dd></div>
            <div><dt>Legal structure</dt><dd>{draft.legal_structure === 'llc' ? 'LLC' : draft.legal_structure}</dd></div>
            <div className="settings-identity-wide"><dt>Federal tax classification</dt><dd>{draft.federal_tax_classification === 's_corporation' ? 'S corporation' : draft.federal_tax_classification}</dd></div>
          </dl>
          <div className="field settings-field settings-field-wide">
            <label htmlFor={`${id}-election`}>S corporation election effective date</label>
            <input id={`${id}-election`} type="date" value={draft.election_effective_date ?? ''} onChange={event => update('election_effective_date', event.target.value || null)} />
            <p className="settings-field-help">Leave blank if the effective date is unknown.</p>
          </div>
          {choiceFields.map(([key, label]) => <div className="field settings-field" key={key}>
            <label htmlFor={`${id}-${key}`}>{label}</label>
            <select id={`${id}-${key}`} value={draft[key]} onChange={event => update(key, event.target.value as Profile[typeof key])}>
              <option value="unknown">Unknown</option><option value="yes">Yes</option><option value="no">No</option>
            </select>
          </div>)}
          <dl className="settings-identity settings-tax-identity settings-field-wide"><div className="settings-identity-wide"><dt>Profile source</dt><dd>{draft.source_type === 'synthetic_owner_provided' ? 'Synthetic owner-provided context' : draft.source_type}</dd></div></dl>
        </fieldset>
      </details>

      <footer className="settings-form-footer">
        <div className={`settings-save-state ${saveResult === 'failed' ? 'settings-save-failed' : ''}`} role="status">{busy === 'profile' ? 'Saving your business context…' : saveResult === 'saved' ? 'Your business profile is saved.' : saveResult === 'failed' ? 'This step needs attention. Check the message above before trying again.' : dirty ? 'You have unsaved changes.' : profile ? 'All changes saved.' : 'Review your details, then save to begin.'}</div>
        <button className="button button-primary" data-testid="profile-save" type="submit" disabled={!!busy || (!dirty && !!profile)}>{busy === 'profile' ? 'Saving…' : profile ? 'Save changes' : 'Save business profile'}<span aria-hidden="true">↗</span></button>
      </footer>
    </form>
  </section>;
}
