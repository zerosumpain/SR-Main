/**
 * Structured evidence emitted by repo-mode builds.
 *
 * This is intentionally a pure module: the orchestrator writes the payloads
 * into the ordinary log stream and the browser reads the same contract. A
 * malformed or older log can therefore degrade to "pending" without making
 * the build screen fail to render.
 */
export type RepoVerificationPhase =
  | 'feedback_gate'
  | 'release_candidate'
  | 'publish'
  | 'ci'
  | 'deploy';

export type RepoVerificationStatus =
  | 'pending'
  | 'running'
  | 'passed'
  | 'failed'
  | 'reused_passed'
  | 'reused_failed';

export interface RepoVerificationEvent {
  version: 1;
  phase: RepoVerificationPhase;
  label: string;
  status: RepoVerificationStatus;
  command?: string;
  detail?: string;
  durationMs?: number;
}

export interface RepoVerificationLog {
  id: number;
  type: string;
  content: string;
}

const PHASES: readonly RepoVerificationPhase[] = [
  'feedback_gate',
  'release_candidate',
  'publish',
  'ci',
  'deploy',
] as const;

const STATUSES: readonly RepoVerificationStatus[] = [
  'pending',
  'running',
  'passed',
  'failed',
  'reused_passed',
  'reused_failed',
] as const;

export function parseRepoVerification(content: string): RepoVerificationEvent | null {
  try {
    const value = JSON.parse(content) as Partial<RepoVerificationEvent>;
    if (
      value.version === 1 &&
      typeof value.phase === 'string' &&
      PHASES.includes(value.phase as RepoVerificationPhase) &&
      typeof value.status === 'string' &&
      STATUSES.includes(value.status as RepoVerificationStatus) &&
      typeof value.label === 'string'
    ) {
      return value as RepoVerificationEvent;
    }
  } catch {
    // Older and human-authored log rows are not verification events.
  }
  return null;
}

/** Latest persisted event for each phase, ordered by log id. */
export function latestRepoVerification(
  logs: RepoVerificationLog[],
): Partial<Record<RepoVerificationPhase, RepoVerificationEvent>> {
  const latest: Partial<Record<RepoVerificationPhase, RepoVerificationEvent>> = {};
  for (const log of [...logs].sort((a, b) => a.id - b.id)) {
    if (log.type !== 'verification') continue;
    const event = parseRepoVerification(log.content);
    if (event) latest[event.phase] = event;
  }
  return latest;
}

export function verificationIsGreen(status: RepoVerificationStatus): boolean {
  return status === 'passed' || status === 'reused_passed';
}
