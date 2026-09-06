// Durable record of every nightly intel sweep.
//
// The sweep used to report itself with a single console line that printed the
// NUMBER of errors and threw the messages away:
//
//   [intel:engine] sweep — 0 gmail threads (0 extracted), 3105 scored, … 1 errors
//
// So the Gmail stage failed on the same SQL bug every night from the day it
// shipped, and the only evidence was a digit in a journal nobody reads. There
// was nowhere to look, and nothing to look at even if you knew where.
//
// Follows the house rule the other two nightly engines follow (see
// $lib/workflowdoctor/types and $lib/selfimprove/types): engine state lives in
// the DATASTORE, so there is no dedicated table, no `drizzle-kit push`, and no
// CI TTY-prompt risk on deploy.
import { ensureCollection, upsertRecord, queryRecords } from '$lib/datastore';
import type { PermissionSet } from '$lib/datastore';
import { redactSensitive } from '$lib/security/sensitive';

/** Actor every intel-engine datastore write runs as. */
export const SYSTEM_ACTOR = 'system';

/** Pinned — renaming this orphans every historical run. */
export const INTEL_RUNS_COLLECTION = 'intel_runs';

const PERMISSIONS: PermissionSet = {
  read: ['owner', 'jkai', 'system'],
  write: ['system', 'owner'],
  delete: ['owner', 'system'],
};

/** How many past runs the dashboard asks for. */
export const RUN_HISTORY_LIMIT = 30;

/**
 * Local YYYY-MM-DD. The run window is judged against the local clock, so the
 * once-a-day key has to be local too — a UTC key rolls over mid-window during
 * BST and would let the sweep run twice on the same night.
 */
export function localDayOf(now = new Date()): string {
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}

/** One stage of the sweep, and what became of it. */
export interface IntelStageResult {
  stage:
    | 'gmail'
    | 'mail-rules'
    | 'embeddings'
    | 'resolve'
    | 'adjudicate'
    | 'taxonomy'
    | 'confidence'
    | 'watchlist'
    | 'conflation'
    | 'lenses';
  ok: boolean;
  /** Stage-specific tallies, e.g. `{ threads: 412, extracted: 150 }`. */
  counts?: Record<string, number>;
  /** The actual failure message. The whole point of this module. */
  error?: string;
  ms: number;
}

export interface IntelRunData {
  /** ISO instant the sweep started. */
  startedAt: string;
  finishedAt?: string;
  /** Local YYYY-MM-DD the sweep is FOR — the once-a-day key. */
  day: string;
  /** 'scheduled' (nightly) or 'manual' (someone pressed the button). */
  trigger: 'scheduled' | 'manual';
  status: 'running' | 'ok' | 'partial' | 'failed';
  stages: IntelStageResult[];
  totalMs?: number;
  [k: string]: unknown;
}

/**
 * Overall status from the stage results. `partial` is a real and common
 * outcome and must not read as either success or total failure: a night where
 * Gmail dies but confidence, watchlist and lenses all succeed is not a working
 * night, and it is not a dead engine either.
 */
export function statusFrom(stages: IntelStageResult[]): IntelRunData['status'] {
  if (!stages.length) return 'failed';
  const failed = stages.filter((s) => !s.ok).length;
  if (failed === 0) return 'ok';
  return failed === stages.length ? 'failed' : 'partial';
}

/** Idempotent; safe on every boot and again at run start. */
export async function ensureIntelRunCollection(): Promise<void> {
  await ensureCollection(
    INTEL_RUNS_COLLECTION,
    {
      name: 'Intel Runs',
      description:
        'One record per nightly intel sweep — per-stage counts, timings, and the full text of any failure.',
      isSystem: true,
      defaultPermissions: PERMISSIONS,
    },
    SYSTEM_ACTOR,
  );
}

/**
 * Persist a run under its day key, so a restart mid-window updates the same
 * record rather than littering the history with partial duplicates.
 *
 * Errors are scrubbed through `redactSensitive` before they are stored: a
 * failure message can quote a row, a header or a token, and this record is
 * readable by jkai. Reuses the shared detector deliberately — three drifting
 * copies of that logic already exist and this is not a fourth.
 */
export async function recordIntelRun(data: IntelRunData): Promise<void> {
  const safe: IntelRunData = {
    ...data,
    stages: data.stages.map((s) => (s.error ? { ...s, error: redactSensitive(s.error) } : s)),
  };
  await upsertRecord(
    INTEL_RUNS_COLLECTION,
    { key: `${data.day}:${data.trigger}`, data: safe as Record<string, unknown> },
    SYSTEM_ACTOR,
  );
}

/** Most recent runs, newest first. */
export async function listIntelRuns(limit = RUN_HISTORY_LIMIT): Promise<IntelRunData[]> {
  const { records } = await queryRecords(
    INTEL_RUNS_COLLECTION,
    { sort: { path: 'startedAt', dir: 'desc' }, limit },
    SYSTEM_ACTOR,
  );
  return records.map((r) => r.data as unknown as IntelRunData);
}

/**
 * Has a scheduled sweep already run (or started) on this local day?
 *
 * The engine's in-memory `lastRunDay` cannot answer this: the sweep blocks the
 * event loop long enough to fail the workflow-engine health probe, systemd's
 * watchdog restarts the service, and the fresh process comes back with the flag
 * reset — still inside the run window, so it swept again. Eight times on the
 * trot, each one a fresh Gmail bill. The answer has to outlive the process.
 *
 * Note the deliberate asymmetry: a run that is still marked `running` counts as
 * having happened. A sweep killed halfway therefore waits for the following
 * night rather than restarting immediately, which is the safe direction — an
 * immediate retry is precisely the loop this is here to break, and nothing is
 * lost by waiting, because the Gmail backfill resumes from where it stopped
 * and every other stage is idempotent.
 */
export async function hasScheduledRunFor(day: string): Promise<boolean> {
  try {
    const { records } = await queryRecords(
      INTEL_RUNS_COLLECTION,
      { filters: [{ path: 'day', op: 'eq', value: day }], limit: 5 },
      SYSTEM_ACTOR,
    );
    return records.some((r) => (r.data as { trigger?: string })?.trigger === 'scheduled');
  } catch {
    // Never let a bookkeeping read stop the night's work. Worst case is the
    // pre-existing behaviour: the in-memory guard alone.
    return false;
  }
}
