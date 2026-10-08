/**
 * Owner-only (admin layout; deliberately absent from the showcase list in
 * `$lib/access/catalogue` — the queries are what the owner was researching).
 *
 * Answers "what is using the Tavily allowance": the account's own meter beside
 * the ledger `$lib/deepdive/tavily-ledger` writes, grouped by the code path
 * that made each request and by what that code was serving.
 */
import type { PageServerLoad } from './$types';
import { clampTavilyDays, getTavilyAudit } from '$lib/server/tavily-audit';
import { tavilyAccountUsage } from '$lib/deepdive/tavily-usage';

export const load: PageServerLoad = async ({ url }) => {
  const days = clampTavilyDays(url.searchParams.get('days'));
  const purpose = url.searchParams.get('purpose')?.slice(0, 120) || null;
  const [audit, account] = await Promise.all([
    getTavilyAudit(days, purpose).catch((err: unknown) => {
      console.error('[admin/tavily] audit failed:', err instanceof Error ? err.message : err);
      return null;
    }),
    tavilyAccountUsage(),
  ]);
  return { days, purpose, audit, account };
};
