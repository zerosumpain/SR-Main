import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { familyCaller, NOT_FAMILY } from '$lib/family/access.server';
import { askForSteps } from '$lib/family/steps.server';

/**
 * POST /api/native/family/steps/ask — "ask everyone's phone", sent when
 * anyone opens the steps screen (body `{}`). Every OTHER family member's
 * phones get a SILENT background push (`category: "family-report"`, `reason:
 * "steps"`) that wakes the app to upload today's steps and a fresh fix; the
 * pilot is then read again at +25 s and +60 s, so the board the phone is
 * polling (`GET /api/native/family/steps`) catches the new counts.
 *
 * At most one round a minute for the whole family. Answers `{ asked, people,
 * throttled: false }` — phones Apple accepted, people addressed — or, inside
 * the minute, `{ asked: 0, people: 0, throttled: true }`; 200 either way.
 *
 * Family only, as the board. A write, so a "View as" look is refused by the
 * gate.
 */
export const POST: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const caller = await familyCaller(event, identity, role);
  if (!caller) return json({ error: NOT_FAMILY }, { status: 403 });
  const { asked, people, throttled } = await askForSteps(caller.email);
  return { asked, people, throttled };
});
