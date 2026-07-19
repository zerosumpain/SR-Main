import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { runBriefingNow, isBriefingRunning } from '$lib/briefing/run';

// Owner-gated by hooks. Generates a briefing now (bypasses the schedule; blocks
// until the synthesis completes, ~a few seconds).
export const POST: RequestHandler = async () => {
  if (isBriefingRunning()) return json({ error: 'a briefing is already running' }, { status: 409 });
  try {
    const { id } = await runBriefingNow({ trigger: 'manual' });
    return json({ ok: true, id });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'run failed' }, { status: 500 });
  }
};
