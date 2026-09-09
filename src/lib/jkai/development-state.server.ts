import { db } from '$lib/db';
import { jkaiBuildDeliveries, jkaiBuildDeliveryEvents, jkaiBuilds, jkaiBuildLessons } from '$lib/db/schema';
import { and, eq, desc, gt } from 'drizzle-orm';
import { newDelivery, type DeliveryState } from './development';

export async function loadDelivery(buildId: string) {
  const [row] = await db.select().from(jkaiBuildDeliveries).where(eq(jkaiBuildDeliveries.buildId, buildId));
  return row ?? null;
}
export async function ensureDelivery(buildId: string, area = 'Platform', criteria: string[] = [], options: Parameters<typeof newDelivery>[3] = {}) {
  const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, buildId));
  if (!build) throw new Error('Build not found');
  await db.insert(jkaiBuildDeliveries).values({ buildId, state: newDelivery(build.prompt, area, criteria, options) }).onConflictDoNothing();
  return (await loadDelivery(buildId))!;
}
/** Row lock serialises worker events with user edits; revisions reject stale forms. */
export async function mutateDelivery(buildId: string, kind: string, change: (state: DeliveryState) => DeliveryState, expectedRevision?: number, buildChange?: Pick<Partial<typeof jkaiBuilds.$inferInsert>, 'prompt' | 'modelId' | 'modelProvider'>) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(jkaiBuildDeliveries).where(eq(jkaiBuildDeliveries.buildId, buildId)).for('update');
    if (!row) throw new Error('Development workspace not found');
    if (expectedRevision !== undefined && row.revision !== expectedRevision) throw new Error('This workspace changed; reload before saving.');
    if (row.state.stage === 'integrating' && !['integration_started', 'integration_failed', 'batch_accepted'].includes(kind)) throw new Error('Batch integration is in progress; wait before changing this workspace.');
    if (buildChange) {
      const [build] = await tx.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, buildId)).for('update');
      if (!build || ['running', 'queued'].includes(build.status)) throw new Error('Pause the build before changing its definition.');
      await tx.update(jkaiBuilds).set(buildChange).where(eq(jkaiBuilds.id, buildId));
    }
    const state = change(structuredClone(row.state));
    const [saved] = await tx.update(jkaiBuildDeliveries).set({ state, revision: row.revision + 1, updatedAt: new Date() })
      .where(eq(jkaiBuildDeliveries.buildId, buildId)).returning();
    await tx.insert(jkaiBuildDeliveryEvents).values({ buildId, kind, detail: { revision: saved.revision, stage: state.stage, candidate: state.candidate, cycle: state.cycle } });
    return saved;
  });
}
export async function deliveryEvents(buildId: string) {
  return db.select().from(jkaiBuildDeliveryEvents).where(eq(jkaiBuildDeliveryEvents.buildId, buildId)).orderBy(desc(jkaiBuildDeliveryEvents.id)).limit(80);
}
export async function relevantLessons(area: string) {
  const rows = await db.select().from(jkaiBuildLessons).where(and(eq(jkaiBuildLessons.area, area), gt(jkaiBuildLessons.expiresAt, new Date())))
    .orderBy(desc(jkaiBuildLessons.createdAt)).limit(8);
  const { syncDevelopmentLesson } = await import('$lib/codegraph/development.server');
  for (const row of rows) await syncDevelopmentLesson(row.id).catch(() => {});
  return rows;
}
