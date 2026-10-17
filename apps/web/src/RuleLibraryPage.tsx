import { useMemo, useState } from 'react';
import type { Profile } from '../../../packages/contracts';
import { Icon } from './Icons';
import { RuleLibraryEntry } from './RuleLibraryEntry';
import { filterLibrary, libraryEntries, type RuleTypeFilter } from './ruleLibraryPresentation';

export function RuleLibraryPage({ profile, onReviewHealthCredit, onEditProfile }: {
  profile: Profile | null; onReviewHealthCredit: () => void; onEditProfile: () => void;
}) {
  const [query, setQuery] = useState('');
  const [type, setType] = useState<RuleTypeFilter>('all');
  const entries = useMemo(() => libraryEntries(profile), [profile]);
  const visible = useMemo(() => filterLibrary(entries, query, type), [entries, query, type]);
  const profileOnly = entries.filter(({ rule }) => rule.fixture_verification === 'not_implemented').length;
  const filters: { id: RuleTypeFilter; label: string; count: number }[] = [
    { id: 'all', label: 'All rules', count: entries.length },
    { id: 'credit', label: 'Credits', count: entries.filter(({ rule }) => rule.type === 'credit').length },
    { id: 'deduction', label: 'Deductions', count: entries.filter(({ rule }) => rule.type === 'deduction').length },
  ];
  return <div className="page-enter rule-library-page" data-testid="rule-library-page">
    <div className="page-title"><div><h1>Rule library</h1><p>Explore {entries.length} federal tax rules for your 2025 review.</p></div><span className="year-label">2025 · Federal</span></div>
    <section className="rule-library-intro" aria-labelledby="library-intro-title">
      <span className="rule-library-symbol"><Icon name="library" size={27}/></span>
      <div><h2 id="library-intro-title">Start with the right questions.</h2><p>Your saved profile guides these checks. Each rule keeps its claimant, evidence needs and official sources together. Eligibility and amounts remain unresolved.</p></div>
      <button className="text-button" onClick={onEditProfile}>{profile ? 'Review business profile' : 'Add business profile'}<Icon name="arrow" size={15}/></button>
    </section>
    <div className="rule-testing-note"><Icon name="clock" size={17}/><p>{profileOnly} rules have offline profile checks only. The health-credit workflow also has sample-document tests. Live end-to-end checks are not verified.</p></div>
    <section className="rule-library-index" aria-label="Federal tax rule library">
      <div className="rule-library-toolbar">
        <div className="rule-type-filters" role="group" aria-label="Filter by rule type">{filters.map(filter => <button key={filter.id} aria-pressed={type === filter.id} onClick={() => setType(filter.id)}>{filter.label}<span>{filter.count}</span></button>)}</div>
        <div className="rule-search"><label className="sr-only" htmlFor="rule-library-search">Search rules</label><input id="rule-library-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search rules or evidence…" autoComplete="off"/></div>
      </div>
      <div className="rule-library-result-count" role="status" aria-live="polite"><span>{visible.length} of {entries.length} rules</span><span>{profile ? 'Based on your saved business profile' : 'Add a profile to guide the checks'}</span></div>
      <div className="rule-library-list">{visible.length ? visible.map(entry => <RuleLibraryEntry key={entry.rule.id} entry={entry} index={entries.findIndex(item => item.rule.id === entry.rule.id)} onReviewHealthCredit={onReviewHealthCredit}/>) : <div className="surface rule-library-empty"><Icon name="library" size={30}/><h2>No rules match this search.</h2><p>Try a different term or return to the full library.</p><button className="button button-secondary" onClick={() => { setQuery(''); setType('all'); }}>Show all rules</button></div>}</div>
    </section>
  </div>;
}
