import type { LayoutServerLoad } from './$types';
import { getSetting } from '$lib/server/models/settings';
import { SETTINGS_ENABLED_KEY, errMsg } from '$lib/daydream/types';
import { emptyHubCounts, loadHubCounts } from '$lib/daydream/hub-counts.server';
import { listMonitors } from '$lib/monitors/monitors.server';

// Owner-gated by hooks (the whole /jkai area is owner-only).
//
// What EVERY room needs and nothing more: the rail badges, the cover deck, the
// readout, the on/off. COUNT queries plus two pulse reads. A room's own data —
// sixty thought rows, the family trail, a hypothesis board — is loaded by that
// room's `+page.server.ts` and by nothing else, which is the whole reason the
// rooms are routes.
export const load: LayoutServerLoad = async () => {
  const [enabled, monitors] = await Promise.all([
    getSetting<boolean>(SETTINGS_ENABLED_KEY).catch(() => null),
    listMonitors().catch((err) => {
      console.error('[daydream] monitors count failed:', errMsg(err));
      return [] as Awaited<ReturnType<typeof listMonitors>>;
    }),
  ]);
  const activeWatches = monitors.filter((m) => m.enabled).length;
  try {
    const counts = await loadHubCounts({ activeWatches });
    return { counts, enabled: enabled !== false, hubError: null as string | null };
  } catch (err) {
    console.error('[daydream] hub counts failed:', errMsg(err));
    return { counts: { ...emptyHubCounts(), activeWatches }, enabled: enabled !== false, hubError: errMsg(err) };
  }
};
