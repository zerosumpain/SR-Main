// Daydream's half of commissioning's ports (`$lib/jkai/commission/ports`):
// the ChatGPT quota windows, read the way the budget reads them. Registered at
// boot from `src/hooks.server.ts`; daydream already depends on `$lib/jkai`, so
// this way round adds no cycle.

import { setCommissionPorts } from '$lib/jkai/commission/ports';

export function registerCommissionQuota(): void {
  setCommissionPorts({
    quotaMark: async () => {
      const { readQuotaMark } = await import('./budget');
      return readQuotaMark();
    },
  });
}
