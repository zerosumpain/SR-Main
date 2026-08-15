/**
 * What a research run is spending, while it is spending it.
 *
 * Two meters, because the two bills arrive from different places:
 *
 *  - **Tokens and cash** already land in `agent_actions` via the LLM gateway,
 *    but they landed there with `session_id = null` and `source = 'gateway'`,
 *    because that column is filled from the workflow execution context and a
 *    research run is not a workflow node. The spend was recorded and
 *    unattributable — you could see that the site spent $4 last night, not
 *    which investigation spent it. This module supplies the missing id.
 *
 *  - **Tavily credits** are not recorded anywhere at all. Tavily has no
 *    per-request receipt to reconcile against afterwards, so the only moment
 *    the spend is knowable is the moment the call returns. Counting it there
 *    and writing it to the session row is the whole mechanism.
 *
 * The ambient id travels on an AsyncLocalStorage rather than being threaded
 * through every signature: `search()` is eight call sites deep from
 * `runResearch`, and half of them are shared with code that has no session at
 * all (the source-summary endpoint, the site tools). Outside a run every
 * function here is a no-op, which is exactly the behaviour those callers want.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { researchSessions } from '$lib/db/schema';

const researchRun = new AsyncLocalStorage<{ sessionId: string }>();

/** Run `fn` with `sessionId` as the ambient research run. */
export function runWithResearchMeter<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  return researchRun.run({ sessionId }, fn);
}

/** The research run this code is executing inside, or null when there is none. */
export function currentResearchSessionId(): string | null {
  return researchRun.getStore()?.sessionId ?? null;
}

export type TavilyDepth = 'basic' | 'advanced';

/**
 * Tavily's published credit model, as at 2026-08. A basic search costs one
 * credit and an advanced search two; extract bills per batch of five URLs at
 * the same rate.
 *
 * These are constants that live on someone else's pricing page, so they are
 * named and commented rather than inlined — when Tavily changes them, the fix
 * should be one edit and a test, not a hunt.
 */
export const SEARCH_CREDITS: Record<TavilyDepth, number> = { basic: 1, advanced: 2 };
export const EXTRACT_URLS_PER_CREDIT = 5;

export function searchCredits(depth: TavilyDepth = 'basic'): number {
  return SEARCH_CREDITS[depth];
}

export function extractCredits(urlCount: number, depth: TavilyDepth = 'basic'): number {
  // A request for zero URLs is never made, but if it were it would still be a
  // request — round the batch count up from at least one.
  const batches = Math.ceil(Math.max(1, urlCount) / EXTRACT_URLS_PER_CREDIT);
  return batches * SEARCH_CREDITS[depth];
}

/**
 * Add to the current run's Tavily tally. Fire-and-forget and increment-in-SQL,
 * so two concurrent leads cannot read-modify-write over each other, and so a
 * failed UPDATE can never take down the search that triggered it.
 */
function bump(fields: { searches?: number; extracts?: number; credits: number }): void {
  const sessionId = currentResearchSessionId();
  if (!sessionId) return;
  void db
    .update(researchSessions)
    .set({
      tavilySearches: sql`${researchSessions.tavilySearches} + ${fields.searches ?? 0}`,
      tavilyExtracts: sql`${researchSessions.tavilyExtracts} + ${fields.extracts ?? 0}`,
      tavilyCredits: sql`${researchSessions.tavilyCredits} + ${fields.credits}`,
    })
    .where(eq(researchSessions.id, sessionId))
    .catch((err: unknown) => {
      console.error('[deepdive] tavily meter update failed:', err instanceof Error ? err.message : err);
    });
}

export function countTavilySearch(depth: TavilyDepth = 'basic'): void {
  bump({ searches: 1, credits: searchCredits(depth) });
}

export function countTavilyExtract(urlCount: number, depth: TavilyDepth = 'basic'): void {
  bump({ extracts: 1, credits: extractCredits(urlCount, depth) });
}
