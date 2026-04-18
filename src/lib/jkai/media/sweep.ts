import { db } from '$lib/db';
import { jkaiAttachments } from '$lib/db/schema';
import { and, eq, isNull, lt } from 'drizzle-orm';
import { deleteByDiskPath } from './storage';

const ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;

export async function sweepOrphanAttachments(): Promise<{ deleted: number }> {
  const cutoff = new Date(Date.now() - ORPHAN_AGE_MS);
  const orphans = await db
    .select()
    .from(jkaiAttachments)
    .where(and(isNull(jkaiAttachments.messageId), lt(jkaiAttachments.createdAt, cutoff)));
  let deleted = 0;
  for (const row of orphans) {
    try {
      await deleteByDiskPath(row.diskPath);
      await db.delete(jkaiAttachments).where(eq(jkaiAttachments.id, row.id));
      deleted++;
    } catch (err) {
      console.warn('[media-sweep] failed to delete', row.id, err);
    }
  }
  return { deleted };
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startOrphanSweep(): void {
  if (timer) return;
  sweepOrphanAttachments().catch((e) => console.warn('[media-sweep] initial run failed', e));
  timer = setInterval(() => {
    sweepOrphanAttachments().catch((e) => console.warn('[media-sweep] periodic run failed', e));
  }, 60 * 60 * 1000);
}
