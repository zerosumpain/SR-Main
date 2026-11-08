import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { withDevice } from '$lib/server/native-handler';
import { parsePatch } from '$lib/captures/validate';
import { listActions, recorderSpace } from '$lib/captures/store.server';
import { captureWithActions, deleteCapture, isRefusal, patchCapture } from '$lib/captures/service.server';
import { healStuckCapture } from '$lib/captures/analyse.server';
import { toView } from '$lib/captures/view';

/**
 * GET    /api/native/captures/:id — the full capture, its follow-ups, and the
 *        bearer-authenticated URLs of its audio and screenshot.
 * PATCH  — `{title?, speakers?:[{label, confirmed}], screenApp?}`. A confirmed
 *        speaker is linked to their person entity and the capture re-queued
 *        for extraction, so the graph learns the name.
 * DELETE — the rows, the media, and a `derived-delete` job so the capture's
 *        notes and entities leave the graph with it.
 *
 * A capture outside the recorder's space is a 404, like one that never existed.
 */
export const GET: RequestHandler = withDevice(async ({ params, url }) => {
  const found = await captureWithActions(recorderSpace(), params.id);
  if (!found) return json({ error: 'No such capture.' }, { status: 404 });
  // A job a restart killed is started again when the phone looks.
  healStuckCapture(found.c);
  return toView(found.c, found.actions, url.origin);
});

export const PATCH: RequestHandler = withDevice(async ({ params, request, url }) => {
  const parsed = parsePatch(await request.json().catch(() => null));
  if (!parsed.ok) return json({ error: parsed.error }, { status: 400 });
  const out = await patchCapture(recorderSpace(), params.id, parsed.value);
  if (isRefusal(out)) return json({ error: out.error }, { status: out.status });
  return toView(out, await listActions(out.id), url.origin);
});

export const DELETE: RequestHandler = withDevice(async ({ params }) => {
  const refused = await deleteCapture(recorderSpace(), params.id);
  if (refused) return json({ error: refused.error }, { status: refused.status });
  return new Response(null, { status: 204 });
});
