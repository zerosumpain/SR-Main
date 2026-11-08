import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { isOwnerEmail } from '$lib/server/access';
import { alarmCaller, NOT_FAMILY_ALARM } from '$lib/family/alarm-caller.server';
import { cancelAlarm, getAlarm } from '$lib/family/alarm.server';
import { mayCancel } from '$lib/family/alarm';

/**
 * POST /api/native/family/alarm/cancel — `{ alarmId }`: stand an alarm down.
 *
 * Only whoever raised it, or the owner. The same people are sent a quiet
 * follow-up ("<Name> is OK — alarm stood down") with the alarm's collapse id,
 * so it replaces the alarm on their lock screens. Cancelling twice is not an
 * error and pushes nothing the second time.
 *
 * Answers `{ alarmId, cancelledAt, pushed }`.
 */
export const POST: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const caller = await alarmCaller(event, identity, role);
  if (!caller) return json({ error: NOT_FAMILY_ALARM }, { status: 403 });
  const body = (await event.request.json().catch(() => null)) as { alarmId?: unknown } | null;
  if (!body || typeof body.alarmId !== 'string') return json({ error: 'alarmId is required.' }, { status: 400 });
  const alarm = await getAlarm(body.alarmId);
  if (!alarm) return json({ error: 'That alarm was not found.' }, { status: 404 });
  if (!mayCancel(alarm, caller.email, caller.owner, isOwnerEmail)) {
    return json({ error: 'Only whoever raised the alarm, or the owner, can stand it down.' }, { status: 403 });
  }
  const { alarm: done, pushed } = await cancelAlarm(alarm, caller.email, caller.parent);
  return { alarmId: done.id, cancelledAt: done.cancelledAt?.toISOString() ?? null, pushed };
});
