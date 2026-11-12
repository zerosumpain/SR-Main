import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { isApnsConfigured, isDeviceToken } from '$lib/server/apns';
import { clearPushToken, pushTestTo, registerPushToken, devicePushPrivacy, isNotifyLevel, setNotifyLevel } from '$lib/server/push-devices';
import { registerJourneyToken, registerLiveStartToken, startTestJourney } from '$lib/home/presence/live-journey';

/**
 * POST /api/native/push — this phone's APNs token: `{ token, environment }`.
 *
 * The app sends it on every launch (iOS can change a token at any time, and a
 * restored backup always does), so this is an upsert onto the phone's own
 * credential row and never a second row. `environment` is `sandbox` for an
 * Xcode build and `production` for TestFlight — they are different Apple
 * gateways, and a token sent to the wrong one is refused as `BadDeviceToken`.
 *
 * `{ test: true }` sends one notification to this phone and reports what Apple
 * said, for the settings screen's "Send a test" and for anyone checking the
 * wiring end to end.
 *
 * Live Activities (the family journey on the Lock Screen,
 * `$lib/home/presence/live-journey`):
 *   `{ liveActivityStartToken }` — ActivityKit's push-to-start token, so the
 *     site can put a journey on this phone with the app closed;
 *   `{ journeyId, activityToken }` — one running journey's update token;
 *   `{ liveActivityTest: true }` — the owner's pretend journey on this phone.
 *
 * Any paired phone, owner or member: a push is addressed to the credential,
 * and who may be TOLD what is decided by whoever raises it.
 */
export const POST: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const body = (await event.request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return json({ error: 'Body must be JSON' }, { status: 400 });

  if (body.liveActivityStartToken !== undefined) {
    if (!isDeviceToken(body.liveActivityStartToken)) return json({ error: 'That is not a Live Activity token.' }, { status: 400 });
    await registerLiveStartToken(identity.id, body.liveActivityStartToken);
    return { ok: true };
  }
  if (typeof body.journeyId === 'string' && body.activityToken !== undefined) {
    if (!isDeviceToken(body.activityToken)) return json({ error: 'That is not a Live Activity token.' }, { status: 400 });
    // An unknown journey is answered 200 and ignored: the app cannot do
    // anything about a journey the site has already forgotten.
    return { ok: await registerJourneyToken(body.journeyId, identity.id, body.activityToken) };
  }
  if (body.liveActivityTest === true) {
    if (role !== 'owner') return json({ error: 'Only the owner can run the test.' }, { status: 403 });
    if (!isApnsConfigured()) return json({ error: 'The server cannot send pushes.' }, { status: 503 });
    const result = await startTestJourney(identity.id);
    if (!result) return json({ error: 'This iPhone has not registered for Live Activities yet.' }, { status: 409 });
    return { ok: result.ok, status: result.status, reason: result.reason ?? null };
  }

  if (body.test === true) {
    if (!isApnsConfigured()) return json({ error: 'The server cannot send pushes.' }, { status: 503 });
    const result = await pushTestTo(identity.id);
    if (!result) return json({ error: 'This iPhone has not registered for notifications.' }, { status: 409 });
    return { ok: result.ok, status: result.status, reason: result.reason ?? null };
  }

  if (!isDeviceToken(body.token)) return json({ error: 'That is not a device token.' }, { status: 400 });
  const environment = body.environment === 'sandbox' ? 'sandbox' : 'production';
  await registerPushToken(identity.id, body.token, environment);
  return { ok: true, environment, configured: isApnsConfigured() };
});

/** DELETE /api/native/push — stop pushing to this phone (notifications turned off). */
export const DELETE: RequestHandler = withNativeAccess('any', async (_event, identity) => {
  await clearPushToken(identity.id);
  return { ok: true };
});

/**
 * The choice belongs to this device, including non-owner family phones — bar
 * `notifyLevel` (minimal | normal | verbose: how much is pushed at all), which
 * is the PERSON's and so the same on every phone they hold. PATCH takes the
 * level alone, the two switches alone (older builds), or all three.
 */
export const GET: RequestHandler = withNativeAccess('any', async (_event, identity) => devicePushPrivacy(identity.id));
export const PATCH: RequestHandler = withNativeAccess('any', async (event, identity) => {
  const body = await event.request.json().catch(() => null);
  const switches = !!body && typeof body.notificationDetails === 'boolean' && typeof body.liveActivityEnabled === 'boolean';
  const level = body?.notifyLevel;
  if (level !== undefined && !isNotifyLevel(level)) {
    return json({ error: 'The level is minimal, normal or verbose.' }, { status: 400 });
  }
  if (!switches && level === undefined) {
    return json({ error: 'Choose notification details and Live Activities, or a level.' }, { status: 400 });
  }
  if (level !== undefined) await setNotifyLevel(identity.ownerEmail, level);
  return devicePushPrivacy(identity.id, switches ? { notificationDetails: body.notificationDetails, liveActivityEnabled: body.liveActivityEnabled } : undefined);
});
