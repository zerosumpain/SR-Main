import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { orchestrator } from '$lib/jkai/orchestrator';

export const POST: RequestHandler = async ({ params, request }) => {
  try {
    const body = await request.json().catch(() => ({}));
    const minutes = Number(body.minutes ?? 10);
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 60) {
      return json({ error: 'minutes must be between 1 and 60' }, { status: 400 });
    }
    const newDeadline = orchestrator.extendDeadline(params.id, minutes * 60 * 1000);
    if (newDeadline === null) {
      return json({ error: 'No running iteration on this build' }, { status: 409 });
    }
    return json({ ok: true, deadline: newDeadline });
  } catch (err: any) {
    return json({ error: err.message }, { status: 400 });
  }
};
