import { useEffect, useId, useState } from 'react';
import { DEFAULT_PROFILE, type Profile } from '../../../packages/contracts';

type Props = { profile: Profile | null; busy: string | null; onSave: (profile: Profile) => Promise<boolean> };
export function ProfilePanel({ profile, busy, onSave }: Props) {
  const [draft, setDraft] = useState<Profile>(profile ?? DEFAULT_PROFILE);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const id = useId();
  useEffect(() => { if (!dirty) setDraft(profile ?? DEFAULT_PROFILE); }, [profile, dirty]);
  function update<K extends keyof Profile>(key: K, value: Profile[K]) {
    setDraft(current => ({...current, [key]: value}));
    setDirty(true);
    setSaved(false);
  }
  return <section className="panel profile-panel" aria-labelledby={`${id}-heading`}>
    <div className="section-heading"><span className="section-number">01</span><h2 id={`${id}-heading`}>Your business</h2></div>
    <p className="panel-intro">A little context for the records.</p>
    <form data-testid="profile-form" onSubmit={async event => {
      event.preventDefault();
      if (await onSave(draft)) { setDirty(false); setSaved(true); }
    }}>
      <label htmlFor={`${id}-name`}>Business name</label>
      <input id={`${id}-name`} value={draft.display_name} onChange={event => update('display_name', event.target.value)} required maxLength={120} />
      <label htmlFor={`${id}-activity`}>What you do</label>
      <input id={`${id}-activity`} value={draft.activity} onChange={event => update('activity', event.target.value)} required maxLength={160} />
      <div className="field-pair">
        <div><label htmlFor={`${id}-state`}>Operating state</label><input id={`${id}-state`} value={draft.operating_states.join(', ')} onChange={event => update('operating_states', event.target.value.toUpperCase().split(',').map(value => value.trim()).filter(Boolean))} pattern="[A-Za-z ,]+" maxLength={40} required /></div>
        <div><label htmlFor={`${id}-people`}>Approx. headcount</label><input id={`${id}-people`} type="number" min="1" max="10000" step="1" value={draft.approximate_headcount} onChange={event => update('approximate_headcount', Number(event.target.value))} required /></div>
      </div>
      <label htmlFor={`${id}-benefits`}>Health benefits offered?</label>
      <select id={`${id}-benefits`} value={draft.health_benefits_offered} onChange={event => update('health_benefits_offered', event.target.value as Profile['health_benefits_offered'])}><option value="yes">Yes</option><option value="no">No</option><option value="unknown">Unknown</option></select>
      <details className="profile-details"><summary>Additional profile details</summary>
        <p className="field-note">LLC · S corporation · historical tax year 2025</p>
        <label htmlFor={`${id}-asof`}>Headcount as of</label><input id={`${id}-asof`} type="date" value={draft.headcount_as_of} onChange={event => update('headcount_as_of', event.target.value)} required />
        <label htmlFor={`${id}-election`}>S corporation election effective date</label><input id={`${id}-election`} type="date" value={draft.election_effective_date ?? ''} onChange={event => update('election_effective_date', event.target.value || null)} />
        {([
          ['owner_on_payroll', 'Owner on payroll?'], ['family_on_payroll', 'Family on payroll?'],
          ['related_employers', 'Related employers?'], ['prior_credit_history', 'Prior credit history?'],
        ] as const).map(([key, label]) => <div key={key}><label htmlFor={`${id}-${key}`}>{label}</label><select id={`${id}-${key}`} value={draft[key]} onChange={event => update(key, event.target.value as Profile[typeof key])}><option value="unknown">Unknown</option><option value="yes">Yes</option><option value="no">No</option></select></div>)}
      </details>
      <button className="button secondary full-width" data-testid="profile-save" type="submit" disabled={!!busy || (!dirty && !!profile)}>{busy === 'profile' ? 'Saving context…' : !profile ? 'Save business context' : dirty ? 'Save changes' : 'Context saved'}<span aria-hidden="true">↗</span></button>
      <span className="save-message" role="status">{saved ? 'Business context saved.' : 'Synthetic owner-provided context'}</span>
    </form>
  </section>;
}
