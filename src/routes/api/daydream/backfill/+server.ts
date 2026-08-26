// Pull the trail Home Assistant already recorded into daydream_trail.
//
// Owner-gated, POST-only, and deliberately manual: it writes a month of history
// in one go and re-clusters the place graph afterwards, which is not something
// that should happen as a side effect of a service restart.
//
// Idempotent — see backfill.ts. Re-running corrects a day rather than
// duplicating it, and it never writes over the window live observation owns.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { backfillFromHomeAssistant, DEFAULT_BACKFILL_DAYS } from '$lib/daydream/backfill';
import { refreshPlaces } from '$lib/daydream/places';
import { errMsg } from '$lib/daydream/types';

export const POST: RequestHandler = async ({ request }) => {
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    // No body is fine — the defaults are the intended behaviour.
  }

  const days = Number(body.days);
  const dryRun = body.dryRun === true;

  try {
    const result = await backfillFromHomeAssistant({
      days: Number.isFinite(days) && days > 0 ? days : DEFAULT_BACKFILL_DAYS,
      entity: typeof body.entity === 'string' ? body.entity : undefined,
    });

    // Places are derived FROM the trail, so a backfill that did not re-cluster
    // would leave a month of history sitting there with nothing reading it —
    // and the hourly refresh would not run for another hour.
    const places = dryRun ? null : await refreshPlaces();

    return json({ ok: true, backfill: result, places });
  } catch (err) {
    console.error('[daydream] backfill failed:', errMsg(err));
    return json({ error: errMsg(err) }, { status: 500 });
  }
};
