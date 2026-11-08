/**
 * Owner-only (admin layout; deliberately absent from the showcase list in
 * `$lib/access/catalogue` — the queries are what the owner was researching).
 *
 * Answers "what is using the web search allowances": Tavily's own meter and
 * Brave's last reported allowance beside the ledger `$lib/deepdive/tavily-ledger`
 * writes for both, grouped by provider, by the code path that made each request
 * and by what that code was serving. The balancer's live state
 * (`$lib/deepdive/web-search`) is this server process's view: current split,
 * any provider it is resting.
 */
import type { PageServerLoad } from './$types';
import { clampProvider, clampTavilyDays, getTavilyAudit } from '$lib/server/tavily-audit';
import { tavilyAccountUsage } from '$lib/deepdive/tavily-usage';
import { searchBalancerStatus } from '$lib/deepdive/web-search';

export const load: PageServerLoad = async ({ url }) => {
  const days = clampTavilyDays(url.searchParams.get('days'));
  const purpose = url.searchParams.get('purpose')?.slice(0, 120) || null;
  const provider = clampProvider(url.searchParams.get('provider'));
  const [audit, account] = await Promise.all([
    getTavilyAudit(days, purpose, provider).catch((err: unknown) => {
      console.error('[admin/tavily] audit failed:', err instanceof Error ? err.message : err);
      return null;
    }),
    tavilyAccountUsage(),
  ]);
  // After the usage fetch, so the balancer's split reflects Tavily's figure.
  return { days, purpose, provider, audit, account, balancer: await searchBalancerStatus() };
};
