import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { measureEfficiency, persistMeasurement } from '$lib/selfimprove/efficiency';
import { TRIAL } from '$lib/selfimprove/types';

// Owner-only (enforced in hooks.server.ts for /api/admin/*). Measures tool
// calls per answered question on demand and persists the snapshot, so the
// ledger has a number before the first nightly run — and so a change can be
// checked without waiting for 03:30.

/** POST { days?: number } — measure now and persist. */
export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => ({}))) as { days?: unknown };
  const days = Number(body.days) > 0 ? Number(body.days) : TRIAL.windowDays;
  const eff = await measureEfficiency(days);
  if (!eff) {
    return json(
      { error: 'measurement unavailable — call efficiency could not be read' },
      { status: 503 },
    );
  }
  await persistMeasurement(eff);
  return json({ ok: true, efficiency: eff });
};
