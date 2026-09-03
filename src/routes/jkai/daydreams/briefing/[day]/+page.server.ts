import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { errMsg } from '$lib/daydream/types';
import { listBriefingDays, loadBriefingDay } from '$lib/briefing/dashboard.server';

// One day of the briefing. The record key IS the local date (`YYYY-MM-DD`) —
// the workflow's "Build record + message" transform sets `record.id = b.date`
// and the WhatsApp message links straight here, so the URL a phone opens at
// 07:00 is the same one the day strip below links to.
//
// Owner-gated by hooks like every /jkai route; nothing here is public.
export const load: PageServerLoad = async ({ params }) => {
  const [briefing, days] = await Promise.all([
    loadBriefingDay(params.day),
    listBriefingDays(30).catch((err) => {
      console.error('[daydream] briefing day strip failed:', errMsg(err));
      return [];
    }),
  ]);

  // A day with no record is a 404, not an empty page: the strip below only ever
  // links to days that exist, so a miss means a hand-typed or stale URL.
  if (!briefing) throw error(404, `No briefing was recorded for ${params.day}.`);

  return { briefing, days };
};
