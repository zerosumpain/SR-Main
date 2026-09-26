import type { PageServerLoad } from './$types';
import { getHomeAssistantService } from '$lib/workflows/homeassistant/service';
import { DEVICES_TEMPLATE, houseOnly, summariseDevices, type DevicesPayload, type DevicesSummary } from '$lib/home/devices';
import { errMsg } from '$lib/home/presence/types';
import { areaAccess } from '$lib/server/area-scope';

// The owner and `home` holders (the catalogue). Read LIVE from
// Home Assistant on each load — one template call, a few hundred rows — rather
// than stored: the question this page answers is "is it working now", and a
// sync of it would only add a way for the answer to be stale.

const EMPTY: DevicesSummary = {
  integrations: [],
  batteries: [],
  counts: { down: 0, degraded: 0, watch: 0, ok: 0, off: 0 },
  entities: 0,
  unavailable: 0,
};

export const load: PageServerLoad = async (event) => {
  const owner = (await areaAccess(event, 'home')).level === 'owner';
  const readAt = new Date().toISOString();
  const service = getHomeAssistantService();
  if (!service.isConfigured()) {
    return { devices: EMPTY, readAt, loadError: 'Home Assistant is not configured on this server.' };
  }
  try {
    const res = await service.renderTemplate(DEVICES_TEMPLATE);
    if (!res.success) throw new Error(res.error ?? 'template call failed');
    const raw = (res.data as { result?: unknown } | undefined)?.result ?? res.data;
    const payload = (typeof raw === 'string' ? JSON.parse(raw) : raw) as DevicesPayload;
    const summary = summariseDevices(payload);
    // A person's phone is not the house's kit: only the owner sees it here.
    return { devices: owner ? summary : houseOnly(summary), readAt, loadError: null as string | null };
  } catch (err) {
    console.error('[home] devices load failed:', errMsg(err));
    return { devices: EMPTY, readAt, loadError: `Home Assistant did not answer: ${errMsg(err)}` };
  }
};
