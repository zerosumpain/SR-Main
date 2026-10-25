import type { PageServerLoad } from './$types';
import { emptyHouseSummary, houseSummary, searchUtterances } from '$lib/alexa/store.server';
import { getHomeAssistantService } from '$lib/integrations/homeassistant/service';
import { DEVICES_TEMPLATE, houseOnly, summariseDevices, type DevicesPayload } from '$lib/home/devices';
import { errMsg } from '$lib/home/presence/types';
import { loadHousehold } from '$lib/home/presence/household';
import { loadHoldContext } from '$lib/home/presence/location-hold.server';
import { mayOpenPerson, peopleViewerOf, scopeHousehold, type PeopleViewer } from '$lib/home/presence/viewer';
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
  // The owner's location hold: anyone else sees him at the held point.
  const [{ members }, hold] = await Promise.all([loadHousehold(), loadHoldContext()]);
  return scopeHousehold(hold ? hold.apply({ presence: members, positions: [] }).presence : members, viewer);
}

/**
 * The rest of today for the people this viewer may see (`loadForecast` scopes
 * to them), plus what changed this fortnight, from the nightly digest. Null
 * for a viewer with no people card. Streamed: the house paints first — so the
 * viewer is resolved in the load, BEFORE it returns: a streamed promise that
 * asks Auth.js for the session runs after the response has started, the
 * session read fails, and `isOwnerRequest` quietly reads that as "not the
 * owner" (the day ahead came back empty for the owner on 2026-10-25).
 */
async function ahead(viewer: PeopleViewer | null) {
  if (!viewer) return null;
  const [{ loadForecast }, { loadDigest }] = await Promise.all([
    import('$lib/home/presence/forecast.server'),
    import('$lib/home/presence/forecast-digest.server'),
  ]);
  const now = new Date();
  const [{ forecast, insights }, digest] = await Promise.all([loadForecast(viewer, 28, null, now), loadDigest()]);
  const names = Object.fromEntries(insights.people.map((p) => [p.subject, p.displayName]));
  const changes = (digest?.changes ?? []).filter((c) => mayOpenPerson(viewer, c.subject)).slice(0, 3);
  return { now: now.toISOString(), ahead: forecast.ahead, names, changes, isOwner: viewer.kind === 'owner' };
}

export const load: PageServerLoad = async (event) => {
  const access = await areaAccess(event, 'home');
  const viewer = await peopleViewerOf(event).catch(() => null);
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
    // Not awaited: the day ahead streams in under the people card.
    ahead: ahead(viewer).catch((err) => {
      console.error('[home] day ahead failed:', errMsg(err));
      return null;
    }),
    members: family.value ?? [],
    /** False when the viewer may not see the household's people at all. */
    showPeople: family.value !== null || family.error !== null,
    /** Everyone who reaches /home and may see the people may open the backlog page too. */
    showBacklog: family.value !== null || family.error !== null,
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
