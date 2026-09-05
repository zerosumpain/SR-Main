/**
 * Coverage — the word that keeps "I found no activity" from being read as
 * "there was no activity".
 *
 * Pure: takes the shape of a connection plus the clock, returns one of the
 * closed coverage words from the query contract. Used by the jkai toolset on
 * every response and by nothing that persists, so a change here changes what
 * the model is told, not what is stored.
 */
import type { ActivityCoverage } from '../contracts/query';

/** A live source whose last success is older than this is reported stale. */
export const STALE_AFTER_MS = 36 * 60 * 60 * 1000;

export interface CoverageInput {
  status: string;
  mode: string;
  /** Evidence modes the provider can emit, from its manifest. */
  evidenceModes: readonly string[];
  lastSyncSucceededAt: Date | string | null;
  /** Whether the consumer asking is allowed to read this connection at all. */
  readable: boolean;
}

export function connectionCoverage(input: CoverageInput, now: Date = new Date()): ActivityCoverage {
  if (!input.readable) return 'unavailable';
  if (['disconnected', 'erasing', 'error', 'action_required'].includes(input.status)) {
    return 'unavailable';
  }
  if (!input.lastSyncSucceededAt) return 'unavailable';
  const snapshotOnly =
    input.evidenceModes.length > 0 &&
    input.evidenceModes.every((mode) => mode === 'provider_snapshot');
  if (snapshotOnly) return 'snapshot_only';
  // Archives do not go stale — nothing was ever promised to refresh them.
  if (input.mode !== 'import') {
    const age = now.getTime() - new Date(input.lastSyncSucceededAt).getTime();
    if (age > STALE_AFTER_MS) return 'stale';
  }
  return 'complete';
}

/**
 * Roll per-connection coverage up to one word for a whole answer. Any
 * unreadable or absent source makes the picture partial; every source being
 * unavailable makes it unavailable; otherwise the weakest present word wins.
 */
export function overallCoverage(parts: readonly ActivityCoverage[]): ActivityCoverage {
  if (parts.length === 0) return 'unavailable';
  if (parts.every((part) => part === 'unavailable')) return 'unavailable';
  if (parts.some((part) => part === 'unavailable')) return 'partial';
  if (parts.some((part) => part === 'stale')) return 'stale';
  if (parts.some((part) => part === 'partial')) return 'partial';
  if (parts.some((part) => part === 'snapshot_only')) return 'snapshot_only';
  return 'complete';
}
