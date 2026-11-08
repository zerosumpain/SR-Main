import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { isOwnerRequest } from '$lib/server/owner';
import { errMsg } from '$lib/home/presence/types';

// The forecast, looked at — the OWNER's page: how often it has been right,
// what changed for everyone, where each person is likeliest to go next,
// everyone's week of health, and the school holidays the forecast keeps to.
// Not in the access catalogue, so the hook refuses anyone else; the load and
// the action check again. A member gets their own share of this (their
// changes, where next, their own health) on /home/people.

export const load: PageServerLoad = async (event) => {
  if (!(await isOwnerRequest(event))) error(403, 'Forbidden');
  const viewer = { kind: 'owner' } as const;
  event.setHeaders({ 'cache-control': 'private, no-store' });
  const isOwner = true;
  const [{ loadForecast, loadHolidays }, { loadDigest }, { loadScorecard }] = await Promise.all([
    import('$lib/home/presence/forecast.server'),
    import('$lib/home/presence/forecast-digest.server'),
    import('$lib/home/presence/forecast-eval.server'),
  ]);
  const now = new Date();
  const [read, digest, scorecard, holidays] = await Promise.all([
    loadForecast(viewer, 28, null, now).catch((err) => {
      console.error('[home/people/forecast] forecast failed:', errMsg(err));
      return null;
    }),
    loadDigest(),
    loadScorecard(),
    loadHolidays().catch(() => []),
  ]);
  return {
    isOwner,
    now: now.toISOString(),
    names: Object.fromEntries((read?.insights.people ?? []).map((p) => [p.subject, p.displayName])),
    odds: read?.forecast.odds ?? [],
    forecastError: read ? null : 'The forecast could not be read just now.',
    digestAt: digest?.generatedAt ?? null,
    changes: digest?.changes ?? [],
    health: Object.entries(digest?.health ?? {}).map(([subject, week]) => ({ subject, ...week })),
    scorecard,
    holidays,
  };
};

export const actions: Actions = {
  holidays: async (event) => {
    if (!(await isOwnerRequest(event))) error(403, 'Forbidden');
    const form = await event.request.formData();
    const from = form.getAll('from').map(String), to = form.getAll('to').map(String), label = form.getAll('label').map(String);
    const rows = from.map((f, i) => ({ from: f.trim(), to: (to[i] ?? '').trim() || f.trim(), label: label[i] ?? '' })).filter((r) => r.from);
    const { saveHolidays } = await import('$lib/home/presence/forecast.server');
    try {
      const saved = await saveHolidays(rows);
      const dropped = rows.length - saved.length;
      return { saved: saved.length, dropped };
    } catch (err) {
      return fail(500, { error: errMsg(err) });
    }
  },
};
