import type { ApiError, State } from '../../../packages/contracts';

export class RequestError extends Error {
  constructor(message: string, public details?: ApiError) { super(message); }
}

export async function requestState(path = '/api/state', body?: unknown, method = 'POST', signal?: AbortSignal): Promise<State> {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const details = payload?.error ?? payload;
    throw new RequestError(details?.message ?? `The request could not be completed (${response.status}).`, details);
  }
  const state = payload?.state ?? payload;
  if (!state || !Array.isArray(state.documents) || typeof state.profile_rev !== 'number') {
    throw new RequestError('Tally received an unexpected response. Please try again.');
  }
  return state as State;
}
