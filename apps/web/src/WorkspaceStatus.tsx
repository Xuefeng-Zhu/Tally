import type { Job } from '../../../packages/contracts';

const activeStatuses = new Set<Job['status']>(['queued', 'extracting', 'validating', 'ledger_committed', 'evaluating']);
export function WorkspaceStatus({jobs, busy}: {jobs: Job[]; busy: string | null}) {
  const needsAttention = jobs.some(job => job.status === 'failed' || job.status === 'needs_review');
  const active = jobs.some(job => activeStatuses.has(job.status));
  const label = busy
    ? needsAttention ? 'Working · needs attention' : 'Working with the records…'
    : active
      ? needsAttention ? 'Processing · needs attention' : 'Processing evidence…'
      : needsAttention ? 'Notebook needs attention' : 'Notebook up to date';
  const tone = needsAttention ? 'attention' : busy || active ? 'active' : '';
  return <span className={`workspace-status ${needsAttention ? 'needs-attention' : ''}`} role="status" data-testid="workspace-status"><span className={`status-dot ${tone}`} />{label}</span>;
}
