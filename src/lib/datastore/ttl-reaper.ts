// $lib/datastore/ttl-reaper.ts
//
// In-process TTL sweep. Two expiry mechanisms:
//   1. per-record `expires_at` (absolute) — deleted once in the past.
//   2. per-collection `settings.ttlSeconds` (relative to `updated_at`).
// Each deletion is audited as an `expire` action by the `system` actor.
//
// `startDatastoreReaper()` runs an immediate boot sweep then an hourly interval.
// NOTE: it is NOT wired into hooks.server.ts here — Task 4 owns that wiring.

import { db } from '$lib/db';
import { sql } from 'drizzle-orm';
import { auditDatastore } from './audit';

type Row = Record<string, unknown>;
function rowsOf(res: unknown): Row[] {
  return ((res as { rows?: Row[] }).rows ?? []) as Row[];
}

const HOUR_MS = 60 * 60 * 1000;
let timer: ReturnType<typeof setInterval> | null = null;
let started = false;

/** Delete every expired record and apply per-collection TTLs. Returns the count. */
export async function sweepExpired(): Promise<number> {
  let deleted = 0;

  // (1) Absolute per-record expiry.
  const expiredRes = await db.execute(sql`
    DELETE FROM datastore_records
    WHERE expires_at IS NOT NULL AND expires_at < now()
    RETURNING id, collection_id
  `);
  for (const row of rowsOf(expiredRes)) {
    deleted++;
    auditDatastore({
      collectionId: String(row.collection_id),
      recordId: String(row.id),
      actor: 'system',
      action: 'expire',
    });
  }

  // (2) Relative per-collection TTL (records older than ttlSeconds by updated_at).
  const collectionsRes = await db.execute(sql`
    SELECT id, (settings->>'ttlSeconds') AS ttl
    FROM datastore_collections
    WHERE (settings->>'ttlSeconds') IS NOT NULL
  `);
  for (const col of rowsOf(collectionsRes)) {
    const ttl = Number(col.ttl);
    if (!Number.isFinite(ttl) || ttl <= 0) continue;
    const res = await db.execute(sql`
      DELETE FROM datastore_records
      WHERE collection_id = ${String(col.id)}
        AND updated_at < now() - make_interval(secs => ${ttl})
      RETURNING id, collection_id
    `);
    for (const row of rowsOf(res)) {
      deleted++;
      auditDatastore({
        collectionId: String(row.collection_id),
        recordId: String(row.id),
        actor: 'system',
        action: 'expire',
      });
    }
  }

  return deleted;
}

function safeSweep(): void {
  void sweepExpired().catch((err: unknown) => {
    console.error('[datastore-reaper] sweep failed:', err instanceof Error ? err.message : err);
  });
}

/** Start the hourly reaper (idempotent) with an immediate boot sweep. */
export function startDatastoreReaper(): void {
  if (started) return;
  started = true;
  safeSweep();
  timer = setInterval(safeSweep, HOUR_MS);
  // Don't keep the event loop alive on account of the reaper.
  if (timer && typeof timer.unref === 'function') timer.unref();
}

/** Stop the reaper (mainly for tests / graceful shutdown). */
export function stopDatastoreReaper(): void {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}
