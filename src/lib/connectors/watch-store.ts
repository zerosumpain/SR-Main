/**
 * Where the connector watcher writes down what it saw.
 *
 * The same table the health watcher uses — `notification_watermarks` — so the
 * question "what did it last say" survives the notification ledger being
 * pruned. One row per connector currently needing the owner (`connector:<key>`,
 * deleted on recovery) plus one row for the sweep itself (`connectors`), whose
 * fingerprint is the time of the last completed check.
 *
 * Split from `watch.ts` so the phone's endpoint and the homepage banner can
 * read the marks without importing the probes, the ledger or WhatsApp.
 */

import { eq, inArray, like } from 'drizzle-orm';
import { db } from '$lib/db';
import { notificationWatermarks } from '$lib/db/schema';
import { isConfirmed, toAttentionItem, type ConnectorMark, type NeedsAttentionItem } from './watch-core';

const PREFIX = 'connector:';
const SWEEP_ID = 'connectors';

function isMark(value: unknown): value is ConnectorMark {
  const v = value as Partial<ConnectorMark> | null;
  return !!v && typeof v.key === 'string' && typeof v.label === 'string' && typeof v.brokenSince === 'string';
}

/** Every stored mark, keyed by connector. */
export async function readMarks(): Promise<Map<string, ConnectorMark>> {
  const rows = await db
    .select({ snapshot: notificationWatermarks.snapshot })
    .from(notificationWatermarks)
    .where(like(notificationWatermarks.id, `${PREFIX}%`));
  const out = new Map<string, ConnectorMark>();
  for (const row of rows) {
    if (isMark(row.snapshot)) {
      const mark = { strikes: 1, auth: false, lastNotifiedAt: null, ...row.snapshot } as ConnectorMark;
      out.set(mark.key, mark);
    }
  }
  return out;
}

export async function writeMarks(marks: readonly ConnectorMark[]): Promise<void> {
  const now = new Date();
  for (const mark of marks) {
    const snapshot = mark as unknown as Record<string, unknown>;
    await db
      .insert(notificationWatermarks)
      .values({ id: PREFIX + mark.key, fingerprint: mark.auth ? 'auth_expired' : 'broken', snapshot, updatedAt: now })
      .onConflictDoUpdate({
        target: notificationWatermarks.id,
        set: { fingerprint: mark.auth ? 'auth_expired' : 'broken', snapshot, updatedAt: now },
      });
  }
}

/** Forget the named connectors — they recovered, or are no longer probed. */
export async function clearMarks(keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return;
  await db.delete(notificationWatermarks).where(
    inArray(
      notificationWatermarks.id,
      keys.map((k) => PREFIX + k),
    ),
  );
}

export async function writeSweep(at: Date, probed: number): Promise<void> {
  const fingerprint = at.toISOString();
  const snapshot = { checkedAt: fingerprint, probed };
  await db
    .insert(notificationWatermarks)
    .values({ id: SWEEP_ID, fingerprint, snapshot, updatedAt: at })
    .onConflictDoUpdate({ target: notificationWatermarks.id, set: { fingerprint, snapshot, updatedAt: at } });
}

/** When the last check completed, or null if none ever has. */
export async function readSweepAt(): Promise<Date | null> {
  const [row] = await db
    .select({ updatedAt: notificationWatermarks.updatedAt })
    .from(notificationWatermarks)
    .where(eq(notificationWatermarks.id, SWEEP_ID))
    .limit(1);
  return row?.updatedAt ?? null;
}

/**
 * What needs the owner right now, from the watcher's own record — never a
 * live probe. Confirmed marks only, auth lapses first, then oldest first.
 */
export async function connectorAttention(): Promise<{ items: NeedsAttentionItem[]; checkedAt: Date | null }> {
  const [marks, checkedAt] = await Promise.all([readMarks(), readSweepAt()]);
  const items = [...marks.values()]
    .filter(isConfirmed)
    .sort((a, b) => Number(b.auth) - Number(a.auth) || a.brokenSince.localeCompare(b.brokenSince))
    .map(toAttentionItem);
  return { items, checkedAt };
}

/** The confirmed marks, for the homepage banner. Never throws. */
export async function confirmedMarks(): Promise<ConnectorMark[]> {
  try {
    return [...(await readMarks()).values()].filter(isConfirmed);
  } catch {
    return [];
  }
}
