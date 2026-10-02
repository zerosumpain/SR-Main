import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { isOwnerEmail } from '$lib/server/access';
import { alarmCaller, NOT_FAMILY_ALARM } from '$lib/family/alarm-caller.server';
import { activeAlarms, alarmFromId, raiseAlarm } from '$lib/family/alarm.server';
import { alarmView, parseAlarmInput, samePerson } from '$lib/family/alarm';

/**
 * POST /api/native/family/alarm — "raise the alarm" from the app's Family tab:
 * `{ kind: 'siren'|'morse', message?, position?: { lat, lon, accuracy? } }`.
 *
 * Every OTHER family member's site-paired phone is pushed (time-sensitive, or
 * critical when APNS_CRITICAL_ALERTS=1) with the kind's bundled sound. Pressing
 * again while the alarm is still active answers with that alarm (`existing:
 * true`) and rings nobody twice; a NEW alarm within 30 s of the sender's last
 * is 429 with `retryAfter`. A "View as" look is refused by the gate: it is a
 * write.
 *
 * Answers `{ alarmId, pushed, recipients, existing }` — `pushed` counts phones
 * Apple accepted, `recipients` the people it was addressed to.
 *
 * GET — the active alarms (raised in the last 30 minutes, not stood down), the
 * pull floor for a phone that cannot be pushed. The caller's own are left out
 * unless `?mine=1`.
 *
 * Family only, scoped as `/api/native/family/forecast` is: the owner's phone or
 * a Family Circle / Family Admin member's. Everyone else 403s.
 */
export const POST: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const caller = await alarmCaller(event, identity, role);
  if (!caller) return json({ error: NOT_FAMILY_ALARM }, { status: 403 });
  const input = parseAlarmInput(await event.request.json().catch(() => null));
  if ('error' in input) return json({ error: input.error }, { status: 400 });
  const result = await raiseAlarm(caller.email, caller.parent, input);
  if (result.kind === 'limited') {
    return json(
      { error: 'You raised an alarm a moment ago. Try again in a few seconds.', retryAfter: result.retryAfterSeconds },
      { status: 429, headers: { 'retry-after': String(result.retryAfterSeconds) } },
    );
  }
  return {
    alarmId: result.alarm.id,
    pushed: result.pushed,
    recipients: result.recipients,
    existing: result.kind === 'existing',
  };
});

export const GET: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const caller = await alarmCaller(event, identity, role);
  if (!caller) return json({ error: NOT_FAMILY_ALARM }, { status: 403 });
  const mine = event.url.searchParams.get('mine') === '1';
  const alarms = (await activeAlarms()).filter((a) => mine || !samePerson(a.fromEmail, caller.email, isOwnerEmail));
  return { alarms: alarms.map((a) => alarmView(a, alarmFromId(a.fromEmail))) };
});
