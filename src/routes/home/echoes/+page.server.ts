import type { PageServerLoad } from './$types';
import { emptyHouseSummary, houseSummary } from '$lib/alexa/store.server';
import { errMsg } from '$lib/daydream/types';
import { areaAccess } from '$lib/server/area-scope';

// The owner and `home` holders (the catalogue). What the Echos
// sense and hold beyond speech — `alexa_signals`, filled every five minutes
// by the `alexa-signals-sync` heartbeat. Was the House tab of /jkai/voice.

const WINDOWS = [7, 30, 90, 365] as const;

export const load: PageServerLoad = async (event) => {
  const { url } = event;
  await areaAccess(event, 'home');
  const asked = Number(url.searchParams.get('days'));
  const days = (WINDOWS as readonly number[]).includes(asked) ? asked : 30;
  try {
    return { days, windows: [...WINDOWS], house: await houseSummary({ days }), loadError: null as string | null };
  } catch (err) {
    console.error('[alexa] echoes load failed:', errMsg(err));
    return { days, windows: [...WINDOWS], house: emptyHouseSummary(days), loadError: errMsg(err) };
  }
};
