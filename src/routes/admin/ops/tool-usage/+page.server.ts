import type { PageServerLoad } from './$types';
import os from 'node:os';
import { clampDays } from '$lib/selfimprove/call-efficiency';
import { getToolAudit } from '$lib/server/tool-audit';
import { getToolErrorRates } from '$lib/server/tool-error-rates';
import { getTools } from '$lib/workflows/site-tools/registry';

export const load: PageServerLoad = async ({ url }) => {
  const days = clampDays(url.searchParams.get('days'));
  // Both sources are now `jkai_tool_traces` in this app's own Postgres: the
  // audit is the call ranking, the error rates carry the per-tool failure
  // detail. They are still reported apart because the error view keeps the last
  // message per tool, which the ranking has no room for.
  const [audit, errorRates] = await Promise.all([
    getToolAudit(days).catch(() => null),
    getToolErrorRates(days).catch(() => null),
  ]);

  const registryCount = getTools().length;

  // Cross-reference the site-tools registry: registered tools NOT called in the
  // window are dead-weight candidates. Trace names are already un-masked, so
  // one list covers both the raw and the resolved sub-tool names.
  let neverUsed: string[] = [];
  if (audit) {
    const called = new Set<string>(audit.tools.map((t) => t.tool));
    neverUsed = getTools()
      .map((t) => t.name)
      .filter((n) => !called.has(n))
      .sort();
  }

  return {
    audit,
    errorRates,
    days,
    hostname: os.hostname(),
    registryCount,
    neverUsed,
  };
};
