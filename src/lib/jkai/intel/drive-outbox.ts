import { and, asc, eq, isNull, lt, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { driveIntelOutbox } from '$lib/db/schema';

/**
 * The Intelligence side of the Drive → Intel contract.
 *
 * Drive writes a row saying what happened to a file; this drains it and calls
 * the same functions Drive used to call in-process. Both halves are here in Main
 * today — Drive still has its own copy of everything — so until Drive is routed
 * this consumer simply finds nothing, and behaviour is unchanged.
 *
 * WHY a table rather than an HTTP call: the gateway in front of each extracted
 * application deliberately refuses a client-supplied identity, and nothing in
 * this estate has a service-to-service auth path yet. A row in the database both
 * applications already share needs neither, and it survives either process
 * restarting mid-handover, which an HTTP call does not.
 *
 * Two of the three kinds are operations whose result Drive never used. The third,
 * file-deleted, DID use its result — /drive reports how much of the graph went
 * with the file — so the consumer writes what it did back onto the row and Drive
 * reads it from there. Eventually consistent rather than synchronous, which is
 * what keeps a delete from depending on this process being up.
 *
 * The kinds:
 *
 *   file-changed   a file was created, renamed or re-indexed  -> queueIntelExtraction
 *   file-deleted   a file went away                           -> deleteDerivedIntel
 *   policy-resync  a folder's files need their policy applied -> syncSourcePolicy
 *
 * `/api/drive/folders` is NOT here: it returns its sync result to the browser,
 * so it stays in Main with the rest of the folder-policy surface.
 */

const BATCH = 50;
/** Rows stay briefly after draining, so a double drain is visible rather than silent. */
const KEEP_PROCESSED_MS = 24 * 60 * 60 * 1000;
// Short: a file deletion's confirmation reads its result off one of these rows,
// and half a minute is not a confirmation. The query is an indexed lookup on a
// table that is almost always empty.
const TICK_MS = 3_000;

let timer: ReturnType<typeof setInterval> | null = null;
let started = false;
let draining = false;

export type DriveIntelKind = 'file-changed' | 'file-deleted' | 'policy-resync';

/** Called by Drive. Kept here so both sides agree on the kinds by construction. */
export async function enqueueDriveIntel(
  kind: DriveIntelKind,
  ref: string,
  payload?: Record<string, unknown>,
): Promise<void> {
  await db.insert(driveIntelOutbox).values({ kind, ref, payload: payload ?? null });
}

async function handle(row: { kind: string; ref: string; payload: unknown }): Promise<unknown> {
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  if (row.kind === 'file-deleted') {
    // AWAITED, not queued, and the counts are kept: /drive shows what went with
    // the file, and reads them back off this row. deleteDerivedIntel is the same
    // function the route used to call in-process.
    const { deleteDerivedIntel } = await import('./auto-extract');
    return await deleteDerivedIntel('file', row.ref);
  }
  if (row.kind === 'policy-resync') {
    const { syncSourcePolicy } = await import('./source-policy.server');
    const ids = Array.isArray(payload.ids) ? (payload.ids as string[]) : undefined;
    return await syncSourcePolicy(row.ref, ids);
  }
  if (row.kind === 'file-changed') {
    const { queueIntelExtraction } = await import('./auto-extract');
    // The payload carries what queueIntelExtraction needs; Drive built it from
    // the same row it just wrote, so it does not have to be re-derived here.
    queueIntelExtraction(payload as never);
    return null;
  }
  throw new Error(`unknown drive-intel kind: ${row.kind}`);
}

/**
 * Drain one batch. Each row is marked processed on its own, so one poisonous row
 * cannot block the rest, and `attempts` makes a repeatedly failing row visible
 * instead of it retrying forever in silence.
 */
export async function drainDriveIntelOutbox(): Promise<{ processed: number; failed: number }> {
  if (draining) return { processed: 0, failed: 0 };
  draining = true;
  let processed = 0;
  let failed = 0;
  try {
    const rows = await db
      .select()
      .from(driveIntelOutbox)
      .where(and(isNull(driveIntelOutbox.processedAt), lt(driveIntelOutbox.attempts, 5)))
      .orderBy(asc(driveIntelOutbox.id))
      .limit(BATCH);

    for (const row of rows) {
      try {
        const result = await handle(row);
        await db
          .update(driveIntelOutbox)
          .set({ processedAt: new Date(), result: (result ?? null) as never })
          .where(eq(driveIntelOutbox.id, row.id));
        processed += 1;
      } catch (err) {
        failed += 1;
        await db
          .update(driveIntelOutbox)
          .set({
            attempts: sql`${driveIntelOutbox.attempts} + 1`,
            lastError: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
          })
          .where(eq(driveIntelOutbox.id, row.id));
      }
    }

    if (rows.length) {
      await db
        .delete(driveIntelOutbox)
        .where(
          and(
            sql`${driveIntelOutbox.processedAt} is not null`,
            lt(driveIntelOutbox.processedAt, new Date(Date.now() - KEEP_PROCESSED_MS)),
          ),
        );
    }
  } finally {
    draining = false;
  }
  return { processed, failed };
}

export function startDriveIntelOutbox(): void {
  if (started) return;
  started = true;
  void drainDriveIntelOutbox().catch((err) =>
    console.warn('[drive-intel] first drain failed:', err instanceof Error ? err.message : err),
  );
  timer = setInterval(() => {
    void drainDriveIntelOutbox().catch((err) =>
      console.warn('[drive-intel] drain failed:', err instanceof Error ? err.message : err),
    );
  }, TICK_MS);
  timer.unref?.();
}

export function stopDriveIntelOutbox(): void {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}
