/**
 * Raise one commissioned-build push, under the jkai push budget
 * (`./delivery-push`). Carries `data.kind: 'delivery'`, `buildId`, and the
 * pull request and preview links, so the phone can open the build rather than
 * the generic inbox. Never throws: a push is a nicety beside the work.
 */
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { jkaiBuildDeliveries, notificationEvents } from '$lib/db/schema';
import { notifyAllSubscribers } from '$lib/server/push';
import type { DeliveryState } from '$lib/constants/development';
import { deliveryPushDecision, type DeliveryPushBudget } from './delivery-push';

export async function notifyDelivery(buildId: string, push: { title: string; body: string }, now = new Date()): Promise<DeliveryPushBudget | null> {
  try {
    const since = new Date(now.getTime() - 24 * 60 * 60_000);
    const sent = sql`${notificationEvents.data}->>'kind' = 'delivery' AND ${notificationEvents.data}->>'budget' = 'sent'`;
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(notificationEvents)
      .where(and(sent, gt(notificationEvents.createdAt, since)));
    const [last] = await db
      .select({ at: notificationEvents.createdAt })
      .from(notificationEvents)
      .where(and(sent, sql`${notificationEvents.data}->>'buildId' = ${buildId}`))
      .orderBy(desc(notificationEvents.createdAt))
      .limit(1);
    const budget = deliveryPushDecision({ sentToday: Number(n) || 0, lastForBuildAt: last?.at ?? null, now });
    const [row] = await db.select({ state: jkaiBuildDeliveries.state }).from(jkaiBuildDeliveries).where(eq(jkaiBuildDeliveries.buildId, buildId)).limit(1);
    const state = row?.state as DeliveryState | undefined;
    await notifyAllSubscribers({
      title: push.title,
      body: push.body,
      url: `/jkai/develop/${buildId}`,
      category: 'build',
      data: {
        kind: 'delivery',
        buildId,
        budget,
        ...(state?.release?.prUrl ? { prUrl: state.release.prUrl } : {}),
        ...(state?.preview?.status === 'ready' && state.preview.url ? { previewUrl: state.preview.url } : {}),
        ...(state?.commission?.conversationId ? { conversationId: state.commission.conversationId } : {}),
      },
      // Over budget: written to the ledger, rung on no channel.
      ...(budget === 'sent' ? {} : { channels: { whatsapp: false, native: false } }),
    });
    return budget;
  } catch (error) {
    console.warn('[delivery-push] push failed', error);
    return null;
  }
}
