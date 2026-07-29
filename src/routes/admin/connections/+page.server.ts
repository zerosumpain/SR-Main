import type { PageServerLoad } from './$types';
import { probeAll } from '$lib/connectors/probes';
import { sortReports } from '$lib/connectors/types';

// Owner-gated by hooks. Every row is probed live on load — the point of this
// page is that it never repeats a stored status column back at you.
export const load: PageServerLoad = async () => {
  const reports = sortReports(await probeAll());
  return {
    reports,
    counts: {
      broken: reports.filter((r) => r.status === 'broken').length,
      degraded: reports.filter((r) => r.status === 'degraded').length,
      ok: reports.filter((r) => r.status === 'ok').length,
      unconfigured: reports.filter((r) => r.status === 'unconfigured').length,
    },
  };
};
