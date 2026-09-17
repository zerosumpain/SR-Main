/**
 * One reading of the spend ledger.
 *
 * `agent_actions.cost_usd` was summed in three places with three different
 * definitions of the same word, and all three surfaces called the result
 * "today":
 *
 *   /admin                  Node's local midnight, and NO action_type filter, so
 *                           it summed every row type the table has ever held
 *   /admin/ops/costs        Postgres `date_trunc('day', now())`, filtered to
 *                           action_type = 'llm_call'
 *   /jkai (the hub header)  a ROLLING 24 HOURS — not a day boundary at all
 *
 * So the console's front door, its cost page and the chat hub each showed a
 * different number under the same label, and nothing in the UI said why.
 *
 * The costs page had already found and fixed half of this and nobody adopted the
 * fix. Its comment is worth keeping whole, because it names the failure mode:
 * deriving "today" from the Node process clock made its own tile and its own
 * chart disagree "silently, and only for part of the year" — the daily series
 * buckets with `date_trunc` in the Postgres session timezone, so the two agree
 * only while the two hosts' timezones do.
 *
 * Hence: midnight is computed by the DATABASE, and the row filter lives here
 * rather than at each call site. Views differ in what they show, never in what
 * they count.
 */
import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { agentActions } from '$lib/db/schema';

/**
 * The ledger is a SHARED table. It was the external-agent action log first and
 * became the site's LLM billing ledger second, so `action_type` is the only
 * thing separating a priced LLM call from a tool call or a decision row. Every
 * reader must apply it or it is summing different species.
 */
export const IS_LLM_CALL = eq(agentActions.actionType, 'llm_call');

/**
 * Midnight, in the database's timezone.
 *
 * A `sql` fragment rather than a JS Date on purpose — see the note above. Do not
 * "simplify" this to `new Date()` with the hours zeroed.
 */
export const DAY_START = sql`date_trunc('day', now())`;

export interface SpendWindow {
  costUsd: number;
  calls: number;
  tokensIn: number;
  tokensOut: number;
}

const EMPTY: SpendWindow = { costUsd: 0, calls: 0, tokensIn: 0, tokensOut: 0 };

/** pg returns numeric/bigint aggregates as strings. */
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function sum(where: ReturnType<typeof and>): Promise<SpendWindow> {
  const [row] = await db
    .select({
      costUsd: sql<string>`coalesce(sum(${agentActions.costUsd}), 0)`,
      calls: sql<string>`count(*)`,
      tokensIn: sql<string>`coalesce(sum(${agentActions.tokensInput}), 0)`,
      tokensOut: sql<string>`coalesce(sum(${agentActions.tokensOutput}), 0)`,
    })
    .from(agentActions)
    .where(where);
  if (!row) return EMPTY;
  return {
    costUsd: num(row.costUsd),
    calls: num(row.calls),
    tokensIn: num(row.tokensIn),
    tokensOut: num(row.tokensOut),
  };
}

/**
 * Spend since midnight. THE definition of "today" for every surface that uses
 * that word.
 */
export function spendToday(): Promise<SpendWindow> {
  return sum(and(IS_LLM_CALL, gte(agentActions.createdAt, DAY_START)));
}

/** Spend over the last `days` whole days, for the windowed views. */
export function spendOverDays(days: number): Promise<SpendWindow> {
  const since = new Date(Date.now() - days * 86_400_000);
  return sum(and(IS_LLM_CALL, gte(agentActions.createdAt, since)));
}
