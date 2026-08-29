import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { agentActions } from '$lib/db/schema';
import { and, eq, gte, sql } from 'drizzle-orm';

/**
 * The wider windows behind the /jkai header's TOK and SPEND chunks, and behind
 * the tok/s meter in the sidebar footer.
 *
 * Why it is not in the layout load: that load runs on EVERY hub navigation and
 * is deliberately three cheap aggregates over the last 24 hours. A 30-day scan
 * does not belong there when nobody has asked for it — so the strip ships with
 * today's figure from the load and fetches this once, lazily, the first time
 * anyone clicks to widen the window.
 *
 * Windows are ROLLING (24h / 7d / 30d), not calendar. That is what the header
 * has always meant by "today", and it keeps the first entry here identical to
 * the number the load already put on screen — a click that widened the window
 * and also changed the day figure would read as a bug.
 */

/** A sample below this is noise rather than a throughput measurement. */
const MIN_ACTIVE_MS = 2_000;

export const GET: RequestHandler = async () => {
  const now = Date.now();
  const day = new Date(now - 86_400_000);
  const week = new Date(now - 7 * 86_400_000);
  const month = new Date(now - 30 * 86_400_000);

  // One pass over rows we have to read anyway, split with FILTER. This is the
  // shape FILTER is actually for: the statement's own WHERE is selective and
  // index-backed (agent_actions_created_at_idx), and the three windows are
  // nested, so three separate queries would re-read the same rows three times.
  //
  // Throughput is scoped to chat calls only. The sidebar meter measures a chat
  // turn, and folding in embeddings, RAG passes and workflow nodes would make
  // the "today" figure incomparable to the "session" one right beside it.
  const chat = sql`${agentActions.durationMs} > 0 AND ${agentActions.tokensOutput} > 0 AND ${agentActions.input} ->> 'source' = 'jkai-chat'`;
  const tokens = sql`COALESCE(${agentActions.tokensInput}, 0) + COALESCE(${agentActions.tokensOutput}, 0)`;

  const [row] = await db
    .select({
      tokensDay: sql<number>`COALESCE(SUM(${tokens}) FILTER (WHERE ${agentActions.createdAt} >= ${day}), 0)::double precision`,
      tokensWeek: sql<number>`COALESCE(SUM(${tokens}) FILTER (WHERE ${agentActions.createdAt} >= ${week}), 0)::double precision`,
      tokensMonth: sql<number>`COALESCE(SUM(${tokens}), 0)::double precision`,
      spendDay: sql<number>`COALESCE(SUM(${agentActions.costUsd}) FILTER (WHERE ${agentActions.createdAt} >= ${day}), 0)::double precision`,
      spendWeek: sql<number>`COALESCE(SUM(${agentActions.costUsd}) FILTER (WHERE ${agentActions.createdAt} >= ${week}), 0)::double precision`,
      spendMonth: sql<number>`COALESCE(SUM(${agentActions.costUsd}), 0)::double precision`,
      outDay: sql<number>`COALESCE(SUM(${agentActions.tokensOutput}) FILTER (WHERE ${agentActions.createdAt} >= ${day} AND ${chat}), 0)::double precision`,
      msDay: sql<number>`COALESCE(SUM(${agentActions.durationMs}) FILTER (WHERE ${agentActions.createdAt} >= ${day} AND ${chat}), 0)::double precision`,
      outWeek: sql<number>`COALESCE(SUM(${agentActions.tokensOutput}) FILTER (WHERE ${agentActions.createdAt} >= ${week} AND ${chat}), 0)::double precision`,
      msWeek: sql<number>`COALESCE(SUM(${agentActions.durationMs}) FILTER (WHERE ${agentActions.createdAt} >= ${week} AND ${chat}), 0)::double precision`,
    })
    .from(agentActions)
    .where(and(eq(agentActions.actionType, 'llm_call'), gte(agentActions.createdAt, month)));

  /** tok/s, or null when there is not enough measured time to mean anything. */
  const rate = (outputTokens: number, activeMs: number): number | null =>
    activeMs >= MIN_ACTIVE_MS && outputTokens > 0 ? outputTokens / (activeMs / 1000) : null;

  return json({
    tokens: {
      day: Math.round(row?.tokensDay ?? 0),
      week: Math.round(row?.tokensWeek ?? 0),
      month: Math.round(row?.tokensMonth ?? 0),
    },
    spendUsd: {
      day: row?.spendDay ?? 0,
      week: row?.spendWeek ?? 0,
      month: row?.spendMonth ?? 0,
    },
    /** Measured chat throughput, request to last byte — so it includes the wait
     *  before the first token, the same as the live meter does. */
    tps: {
      day: rate(row?.outDay ?? 0, row?.msDay ?? 0),
      week: rate(row?.outWeek ?? 0, row?.msWeek ?? 0),
    },
    fetchedAt: now,
  });
};
