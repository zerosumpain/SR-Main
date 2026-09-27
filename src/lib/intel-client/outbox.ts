// The writer half of the intel outbox (`drive_intel_outbox`).
//
// Main never writes intel rows itself. It says what should happen, as a row, and
// SR-Jkai-Core's maintenance process drains the table and does it — the same
// functions Main used to call in-process, now called in one place. A row in the
// database every application already shares needs no service auth and survives
// either process restarting mid-handover; that is why this is a table and not
// an HTTP call.
//
// The contract (SR-Jkai-Core `docs/specs/2026-09-27-intel-basics.md`):
//
//   kind           ref                  payload            result written by Core
//   file-changed   workflow_files id    FileChangedJob     { status, noteId }
//   file-deleted   workflow_files id    —                  { notesDeleted, entitiesRemoved, … }
//   policy-resync  folder path          { ids? }           syncSourcePolicy's counts
//   extract        caller ref           ExtractJob         { status, noteId, entityCount }
//   note           caller ref           NoteJob            { noteId }
//   mail-purge     Gmail account id     { email, spaceId } { notes, entities, embeddings, files }
//
// Core claims each row with FOR UPDATE SKIP LOCKED, awaits the work, and writes
// `result`. An unknown kind or a malformed payload is marked once and never
// retried. Processed rows are pruned after 7 days, so a caller that wants an
// outcome must read it within that window.
import { and, desc, eq, sql } from 'drizzle-orm';
import { db, type DbExecutor } from '$lib/db';
import { driveIntelOutbox } from '$lib/db/schema';
import type { ExtractJob, FileChangedJob, NoteJob } from './types';

export const INTEL_JOB_KINDS = [
  'file-changed',
  'file-deleted',
  'policy-resync',
  'extract',
  'note',
  'mail-purge',
] as const;
export type IntelJobKind = (typeof INTEL_JOB_KINDS)[number];

/** Core's attempt ceiling: a row that has failed this often is left for a human. */
const MAX_ATTEMPTS = 5;

type Payloads = {
  'file-changed': FileChangedJob;
  'file-deleted': undefined;
  'policy-resync': { ids?: string[] } | undefined;
  extract: ExtractJob;
  note: NoteJob;
  'mail-purge': { email: string; spaceId: string };
};

/**
 * Queue one job for Core and return its row id.
 *
 * Pass `executor` to enqueue inside a caller's transaction, so the job exists
 * exactly when the caller's own write does.
 */
export async function enqueueIntelJob<K extends IntelJobKind>(
  kind: K,
  ref: string,
  payload: Payloads[K],
  executor: DbExecutor = db,
): Promise<number> {
  const [row] = await executor
    .insert(driveIntelOutbox)
    .values({ kind, ref, payload: (payload ?? null) as unknown })
    .returning({ id: driveIntelOutbox.id });
  return row.id;
}

export type IntelJobState<T> =
  | { id: number; state: 'pending'; payload: unknown }
  | { id: number; state: 'done'; payload: unknown; result: T }
  | { id: number; state: 'failed'; payload: unknown; error: string };

type Row = {
  id: number;
  payload: unknown;
  processedAt: Date | null;
  result: unknown;
  attempts: number;
  lastError: string | null;
};

function stateOf<T>(row: Row): IntelJobState<T> {
  if (row.processedAt) return { id: row.id, state: 'done', payload: row.payload, result: row.result as T };
  if (row.attempts >= MAX_ATTEMPTS) {
    return { id: row.id, state: 'failed', payload: row.payload, error: row.lastError ?? 'failed' };
  }
  return { id: row.id, state: 'pending', payload: row.payload };
}

const COLUMNS = {
  id: driveIntelOutbox.id,
  payload: driveIntelOutbox.payload,
  processedAt: driveIntelOutbox.processedAt,
  result: driveIntelOutbox.result,
  attempts: driveIntelOutbox.attempts,
  lastError: driveIntelOutbox.lastError,
};

/** One job's state. Null when the row is gone (pruned a week after it ran). */
export async function intelJobResult<T = unknown>(id: number): Promise<IntelJobState<T> | null> {
  const [row] = await db.select(COLUMNS).from(driveIntelOutbox).where(eq(driveIntelOutbox.id, id)).limit(1);
  return row ? stateOf<T>(row) : null;
}

/** The newest job of a kind for a ref — how a caller finds the outcome of what it queued. */
export async function latestIntelJob<T = unknown>(kind: IntelJobKind, ref: string): Promise<IntelJobState<T> | null> {
  const [row] = await db
    .select(COLUMNS)
    .from(driveIntelOutbox)
    .where(and(eq(driveIntelOutbox.kind, kind), eq(driveIntelOutbox.ref, ref)))
    .orderBy(desc(driveIntelOutbox.id))
    .limit(1);
  return row ? stateOf<T>(row) : null;
}

/** True while a job for this ref is still waiting for Core — so a caller does not queue it twice. */
export async function hasPendingIntelJob(kind: IntelJobKind, ref: string): Promise<boolean> {
  const [row] = await db
    .select({ id: driveIntelOutbox.id })
    .from(driveIntelOutbox)
    .where(
      and(
        eq(driveIntelOutbox.kind, kind),
        eq(driveIntelOutbox.ref, ref),
        sql`${driveIntelOutbox.processedAt} IS NULL`,
        sql`${driveIntelOutbox.attempts} < ${MAX_ATTEMPTS}`,
      ),
    )
    .limit(1);
  return !!row;
}
