import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { clampLimit, withNativeAccess } from '$lib/server/native-handler';
import { familyCaller, NOT_FAMILY } from '$lib/family/access.server';
import {
  getFamilyLandgrabWeeks,
  LANDGRAB_UNAVAILABLE,
  WEEKS_DEFAULT,
  WEEKS_MAX,
} from '$lib/family/landgrab.server';

/**
 * GET /api/native/family/landgrab?weeks=6 — Landgrab ground won and lost per
 * person per week (Monday to Sunday, London), newest week first. Shown beside
 * the steps board, so each person's `id` is the steps board's id.
 *
 * SR-Health computes it (`/api/health/landgrab/family/weeks`, over the service
 * lane) for exactly the household members Main names; this route maps their
 * subjects to ids and marks the caller — see `$lib/family/landgrab.server`.
 * `weeks` is clamped to 1..12. Family only, as the steps board is.
 *
 * A 502 when Health does not answer — including before Health ships the
 * endpoint — so the app hides the section rather than showing an empty board.
 */
export const GET: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const caller = await familyCaller(event, identity, role);
  if (!caller) return json({ error: NOT_FAMILY }, { status: 403 });
  const weeks = clampLimit(event.url.searchParams.get('weeks'), WEEKS_DEFAULT, WEEKS_MAX);
  try {
    return await getFamilyLandgrabWeeks(weeks, caller.email);
  } catch (error) {
    console.error('[native] landgrab weeks unavailable', error);
    return json({ error: LANDGRAB_UNAVAILABLE }, { status: 502 });
  }
});
