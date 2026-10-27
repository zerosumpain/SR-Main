import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withDevice } from '$lib/server/native-handler';
import { listBriefingDays, loadBriefingDay } from '$lib/briefing/dashboard.server';
import { isBriefingDay, NATIVE_DAYS_MAX, toNativeBriefing } from '$lib/briefing/native';

/**
 * GET /api/native/briefing?day=YYYY-MM-DD — the Morning report: one day's
 * briefing record (default the newest) with its 19 factor cards, the
 * connections between them, and the days the app can page to (newest first,
 * at most 14). Owner only: a family member's phone gets 403 (`withDevice`).
 * 404 `{ error: 'no briefing' }` when there is no such record.
 */
export const GET: RequestHandler = withDevice(async ({ url }) => {
  const asked = url.searchParams.get('day');
  if (asked !== null && !isBriefingDay(asked)) return json({ error: 'day must be YYYY-MM-DD' }, { status: 400 });
  const days = [...new Set((await listBriefingDays(NATIVE_DAYS_MAX)).map((d) => d.id))];
  const day = asked ?? days[0];
  const record = day ? await loadBriefingDay(day) : null;
  if (!day || !record) return json({ error: 'no briefing' }, { status: 404 });
  return toNativeBriefing(day, record, days);
});
