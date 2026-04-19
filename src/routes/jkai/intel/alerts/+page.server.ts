import type { PageServerLoad } from './$types';
import { listAlerts } from '$lib/jkai/intel/queries';

export const load: PageServerLoad = async ({ url }) => {
  const significance = url.searchParams.get('significance') ?? undefined;
  const showDismissed = url.searchParams.get('dismissed') === 'true';
  const alerts = await listAlerts({ limit: 100, significance, includeDismissed: showDismissed });
  return { alerts, filters: { significance, showDismissed } };
};
