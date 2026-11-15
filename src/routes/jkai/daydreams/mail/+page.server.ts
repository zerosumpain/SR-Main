import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { errMsg } from '$lib/daydream/types';
import { mailRoomData } from '$lib/daydream/mail-room.server';
import { mailInsights } from '$lib/daydream/mail-insights.server';
import { setSetting } from '$lib/server/models/settings';

// Owner-gated by hooks (the whole /jkai area is owner-only).
export const load: PageServerLoad = async ({ url }) => {
  // Two views of one room. Only the one asked for is queried.
  const view = url.searchParams.get('view') === 'insights' ? ('insights' as const) : ('room' as const);
  try {
    const now = new Date();
    return view === 'insights'
      ? { view, room: null, insights: await mailInsights(now), error: null as string | null }
      : { view, room: await mailRoomData(now), insights: null, error: null as string | null };
  } catch (err) {
    console.error('[daydream] mail room load failed:', errMsg(err));
    return { view, room: null, insights: null, error: errMsg(err) };
  }
};

export const actions: Actions = {
  // SR-Jkai-Core's maintenance process polls this key and runs an intake and
  // reading pass when it is newer than its last run (`intel/source-backlog.ts`).
  run: async () => {
    try {
      await setSetting('backlog.run_requested', { at: new Date().toISOString() });
      return { requested: true };
    } catch (err) {
      return fail(500, { error: errMsg(err) });
    }
  },
};
