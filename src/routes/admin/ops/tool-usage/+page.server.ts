import type { PageServerLoad } from './$types';
import os from 'node:os';
import { clampDays } from '$lib/server/hermes-sessions';
import { canManageHermes, IS_HOMESERV, rToolAudit } from '$lib/server/hermes-remote';
import { getToolErrorRates } from '$lib/server/tool-error-rates';
import { getTools } from '$lib/workflows/site-tools/registry';

export const load: PageServerLoad = async ({ url }) => {
  const days = clampDays(url.searchParams.get('days'));
  const manage = canManageHermes();
  // Two independent sources, deliberately. The audit is the Hermes SQLite
  // session store (reached over Tailscale from the VPS); the error rates come
  // from `jkai_tool_traces` in this app's OWN Postgres, which is why they need
  // no host switch and survive the engine store being unreachable. Their
  // coverage differs — see getToolErrorRates — so the page reports them apart.
  const [audit, errorRates] = await Promise.all([
    manage ? rToolAudit(days).catch(() => null) : Promise.resolve(null),
    getToolErrorRates(days).catch(() => null),
  ]);

  const registryCount = getTools().length;

  // Cross-reference the site-tools registry: registered tools NOT called in the
  // window are dead-weight candidates. Match against both the raw engine tool
  // names and the resolved jkai sub-tool names.
  let neverUsed: string[] = [];
  if (audit) {
    const called = new Set<string>([...audit.tools, ...audit.jkaiTools].map((t) => t.tool));
    neverUsed = getTools()
      .map((t) => t.name)
      .filter((n) => !called.has(n))
      .sort();
  }

  return {
    audit,
    errorRates,
    days,
    canManage: manage,
    direct: IS_HOMESERV,
    hostname: os.hostname(),
    registryCount,
    neverUsed,
  };
};
