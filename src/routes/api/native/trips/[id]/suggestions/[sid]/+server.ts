import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { decide, familyTrip } from '$lib/trips/family.server';

/**
 * POST /api/native/trips/:id/suggestions/:sid — `{ action: 'approve' | 'reject' | 'withdraw' }`.
 * Approve/reject: a parent (canApprove); approving adds the wish through the
 * normal ops path → a new plan version, and the suggester is pushed.
 * Withdraw: whoever suggested it, while it is pending. 409 if already decided.
 */
export const POST: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const ft = await familyTrip(event, identity, role, event.params.id);
  if (ft instanceof Response) return ft;
  const body = (await event.request.json().catch(() => null)) as { action?: unknown } | null;
  const action = body?.action;
  if (action !== 'approve' && action !== 'reject' && action !== 'withdraw') {
    return json({ error: "action is 'approve', 'reject' or 'withdraw'." }, { status: 400 });
  }
  const r = await decide(ft.trip, ft.caller, ft.access, event.params.sid, action);
  return json(r.body, { status: r.status });
});
