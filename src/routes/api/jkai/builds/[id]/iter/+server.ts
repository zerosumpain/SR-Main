import { json, error } from '@sveltejs/kit';
import { orchestrator } from '$lib/jkai/orchestrator';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ params, request }) => {
  const buildId = params.id!;
  const body = (await request.json().catch(() => null)) as
    | { action?: string; notes?: string }
    | null;
  if (!body || typeof body.action !== 'string') throw error(400, 'action required');
  try {
    if (body.action === 'approve') {
      await orchestrator.approveIteration(buildId);
    } else if (body.action === 'reject') {
      await orchestrator.rejectIteration(buildId, body.notes ?? '');
    } else {
      throw error(400, `unknown action: ${body.action}`);
    }
    return json({ ok: true });
  } catch (e: any) {
    if (e?.status) throw e;
    throw error(400, e?.message ?? 'iteration action failed');
  }
};
