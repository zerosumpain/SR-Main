import type { PageServerLoad } from './$types';
import { loadFamily } from '$lib/home/family.server';
import { emptyHouseSummary, houseSummary, searchUtterances } from '$lib/alexa/store.server';
import { getHomeAssistantService } from '$lib/workflows/homeassistant/service';
import { DEVICES_TEMPLATE, summariseDevices, type DevicesPayload } from '$lib/home/devices';
import { errMsg } from '$lib/daydream/types';

// Owner-gated by hooks (nothing under /home is a public path). The house,
// now: one slice of each sub-page, every read on its own so one source being
// down (Home Assistant off the tailnet, say) blanks its own card and nothing
// else. The pages under it hold the detail.

async function settle<T>(what: string, p: Promise<T>): Promise<{ value: T | null; error: string | null }> {
  try {
    return { value: await p, error: null };
  } catch (err) {
    console.error(`[home] ${what} failed:`, errMsg(err));
    return { value: null, error: errMsg(err) };
  }
}

async function devices() {
  const service = getHomeAssistantService();
  if (!service.isConfigured()) throw new Error('Home Assistant is not configured on this server');
  const res = await service.renderTemplate(DEVICES_TEMPLATE);
  if (!res.success) throw new Error(res.error ?? 'template call failed');
  const raw = (res.data as { result?: unknown } | undefined)?.result ?? res.data;
  return summariseDevices((typeof raw === 'string' ? JSON.parse(raw) : raw) as DevicesPayload);
}

export const load: PageServerLoad = async () => {
  const [family, house, said, devs] = await Promise.all([
    settle('family', loadFamily()),
    settle('echoes', houseSummary({ days: 1 })),
    settle('voice', searchUtterances({ limit: 6 })),
    settle('devices', devices()),
  ]);
  return {
    members: family.value?.members ?? [],
    familyError: family.error,
    house: house.value ?? emptyHouseSummary(1),
    houseError: house.error,
    said: said.value ?? [],
    saidError: said.error,
    devices: devs.value,
    devicesError: devs.error,
  };
};
