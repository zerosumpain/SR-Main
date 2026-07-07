import type { PageServerLoad } from './$types';
import os from 'node:os';
import { clampDays } from '$lib/server/hermes-sessions';
import { canManageHermes, IS_HOMESERV, rToolAudit } from '$lib/server/hermes-remote';
import { getTools } from '$lib/workflows/site-tools/registry';

export const load: PageServerLoad = async ({ url }) => {
  const days = clampDays(url.searchParams.get('days'));
  const manage = canManageHermes();
  const audit = manage ? await rToolAudit(days).catch(() => null) : null;

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
    days,
    canManage: manage,
    direct: IS_HOMESERV,
    hostname: os.hostname(),
    registryCount,
    neverUsed,
  };
};
