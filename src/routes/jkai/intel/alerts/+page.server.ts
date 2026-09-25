import type { PageServerLoad } from './$types';
import { listAlerts } from '$lib/jkai/intel/queries';
import { resolveRequestScope } from '$lib/jkai/intel/scope.server';

export const load: PageServerLoad = async (event) => {
  const { url } = event;
  const scope = await resolveRequestScope(event);
  const significance = url.searchParams.get('significance') ?? undefined;
  const showDismissed = url.searchParams.get('dismissed') === 'true';
  const alerts = await listAlerts({ limit: 100, significance, includeDismissed: showDismissed, scope });
  return { alerts, filters: { significance, showDismissed } };
};
