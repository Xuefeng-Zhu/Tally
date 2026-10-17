import { useCallback, useEffect, useRef, useState } from 'react';
import type { Profile, State } from '../../../packages/contracts';
import { RequestError, requestState } from './api';

const ACTIVE_STATUSES = new Set(['queued', 'extracting', 'validating', 'ledger_committed', 'evaluating']);
export function useWorkspace() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState<RequestError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const stateRef = useRef<State | null>(null);
  const mounted = useRef(false);
  const mutation = useRef(false);
  const generation = useRef(0);
  const accept = useCallback((next: State) => {
    stateRef.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    mounted.current = true;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | null = null;
    let failures = 0;
    const poll = async () => {
      if (mutation.current) { timer = setTimeout(poll, 2000); return; }
      controller = new AbortController();
      const currentGeneration = generation.current;
      try {
        const next = await requestState('/api/state', undefined, 'GET', controller.signal);
        if (!alive || currentGeneration !== generation.current) return;
        accept(next);
        setError(null);
        failures = 0;
      } catch (cause) {
        if (!alive || controller.signal.aborted || currentGeneration !== generation.current) return;
        failures++;
        setError(cause instanceof RequestError ? cause : new RequestError('Could not reach the local Tally server.'));
      } finally {
        if (alive) {
          setLoading(false);
          const current = stateRef.current;
          const active = current?.pending_evaluation || current?.jobs.some(job => ACTIVE_STATUSES.has(job.status));
          timer = setTimeout(poll, failures ? Math.min(30000, 3000 * 2 ** Math.min(failures, 4)) : active ? 2000 : 10000);
        }
      }
    };
    void poll();
    return () => { alive = false; mounted.current = false; clearTimeout(timer); controller?.abort(); };
  }, [accept]);

  const run = useCallback(async (name: string, path: string, body: unknown, method = 'POST') => {
    if (mutation.current) return false;
    mutation.current = true;
    generation.current++;
    setBusy(name);
    setError(null);
    try {
      const next = await requestState(path, body, method);
      if (mounted.current) accept(next);
      return true;
    } catch (cause) {
      if (mounted.current) setError(cause instanceof RequestError ? cause : new RequestError('The request could not reach the local server.'));
      return false;
    } finally {
      mutation.current = false;
      if (mounted.current) setBusy(null);
    }
  }, [accept]);

  return {
    state, error, busy, loading,
    saveProfile: (profile: Profile) => run('profile', '/api/profile', {expected_profile_rev: stateRef.current?.profile_rev ?? 0, profile}, 'PUT'),
    loadFixture: (id: 'fixture-A' | 'fixture-B') => run(id, '/api/demo/analyze', {file_ids: [id]}),
    analyzeInbox: () => run('inbox', '/api/demo/analyze', {}),
    reconcile: () => run('reconcile', '/api/demo/reconcile', {}),
  };
}
