import type { CommitFact, FileFact, ReleaseStats } from './types';

/**
 * On 2026-08-08 the deploy stamp was missing. The ingester compared this commit
 * with the empty tree and recorded the whole existing repository as new work.
 * The previous successful deploy was c75b8be5; these facts are its git diff.
 */
const ROOT_SNAPSHOT_SHA = '34aa25fa616c4e1a4ec1ad9ddb9ba9964df12024';
const PREVIOUS_SHA = 'c75b8be5c60bdf263d7f1e084137af9c6d95e1ab';
const FILES: FileFact[] = [
  { path: 'src/lib/jkai/hermes-client.ts', status: 'M', insertions: 7, deletions: 0 },
  { path: 'src/lib/jkai/hermes-frames.test.ts', status: 'M', insertions: 30, deletions: 0 },
  { path: 'src/lib/jkai/hermes-frames.ts', status: 'M', insertions: 30, deletions: 0 },
  { path: 'src/lib/server/models/settings.ts', status: 'M', insertions: 26, deletions: 0 },
  { path: 'src/routes/admin/ops/engine/+page.server.ts', status: 'M', insertions: 6, deletions: 1 },
  { path: 'src/routes/admin/ops/engine/+page.svelte', status: 'M', insertions: 69, deletions: 1 },
  { path: 'src/routes/api/admin/chat-engine/+server.ts', status: 'A', insertions: 27, deletions: 0 },
  { path: 'src/routes/api/workflows/orchestrator/chat/+server.ts', status: 'M', insertions: 40, deletions: 10 },
];

export function correctedStats(sha: string, stats: ReleaseStats): ReleaseStats {
  if (sha !== ROOT_SNAPSHOT_SHA) return stats;
  return { ...stats, commits: 1, files: FILES.length, insertions: 235, deletions: 12, prs: [150] };
}

export function correctedFacts(
  sha: string,
  prevSha: string | null,
  commits: CommitFact[],
  files: FileFact[],
): { prevSha: string | null; commits: CommitFact[]; files: FileFact[]; corrected: boolean } {
  if (sha !== ROOT_SNAPSHOT_SHA) return { prevSha, commits, files, corrected: false };
  return {
    prevSha: PREVIOUS_SHA,
    commits: commits.filter((commit) => commit.sha === ROOT_SNAPSHOT_SHA),
    files: FILES,
    corrected: true,
  };
}
