import type { PageServerLoad } from './$types';
import { emptyHouseSummary, houseSummary, searchUtterances } from '$lib/alexa/store.server';
import { getHomeAssistantService } from '$lib/workflows/homeassistant/service';
import { DEVICES_TEMPLATE, houseOnly, summariseDevices, type DevicesPayload } from '$lib/home/devices';
import { errMsg } from '$lib/home/presence/types';
import { loadHousehold } from '$lib/home/presence/household';
import { peopleViewerOf, scopeHousehold } from '$lib/home/presence/viewer';
import { areaAccess } from '$lib/server/area-scope';

// The house, now: one slice of each sub-page, every read on its own so one
// source being down (Home Assistant off the tailnet, say) blanks its own card
// and nothing else. The pages under it hold the detail.
//
// The owner, and members holding `home` (the catalogue opens this route to
// them). Devices, echoes and the voice log are the house's, not a person's, so
// every home level reads them alike. The people card is not the house's: it is
// /home/people's, so it follows that room's rule — the owner sees the ledger, a
// Family Circle member the scoped cards, anyone else no card at all.

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

async function people(event: Parameters<PageServerLoad>[0]) {
  const viewer = await peopleViewerOf(event);
  if (!viewer) return null;
  if (viewer.kind === 'owner') return (await loadHousehold()).members;
  return scopeHousehold((await loadHousehold()).members, viewer);
}

export const load: PageServerLoad = async (event) => {
  const access = await areaAccess(event, 'home');
  // The voice log is everyone's speech, and the Echo readings the household's
  // routine: `home:all` and up, as /home/voice and /home/echoes.
  const hearsVoice = access.level !== 'self';
  const [family, house, said, devs] = await Promise.all([
    settle('family', people(event)),
    hearsVoice ? settle('echoes', houseSummary({ days: 1 })) : Promise.resolve({ value: null, error: null }),
    hearsVoice ? settle('voice', searchUtterances({ limit: 6 })) : Promise.resolve({ value: null, error: null }),
    settle('devices', devices().then((d) => (access.level === 'owner' ? d : houseOnly(d)))),
  ]);
  return {
    members: family.value ?? [],
    /** False when the viewer may not see the household's people at all. */
    showPeople: family.value !== null || family.error !== null,
    familyError: family.error,
    house: house.value ?? emptyHouseSummary(1),
    houseError: house.error,
    said: said.value ?? [],
    saidError: said.error,
    showVoice: hearsVoice,
    showEchoes: hearsVoice,
    devices: devs.value,
    devicesError: devs.error,
  };
};
