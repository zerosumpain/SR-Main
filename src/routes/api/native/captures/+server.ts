import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { clampLimit, withDevice } from '$lib/server/native-handler';
import { parseCaptureIntake } from '$lib/captures/validate';
import { createCapture, listCaptures, recorderSpace } from '$lib/captures/store.server';
import { startIfComplete } from '$lib/captures/service.server';
import { toSummary } from '$lib/captures/view';

/**
 * POST /api/native/captures — the metadata of one recording; the audio and
 * screenshot follow as raw PUTs to the URLs returned. JSON, not multipart: a
 * form POST from a phone is refused by SvelteKit's origin check before any
 * handler runs (see /api/native/chat/attachments). The transcript rides in this
 * body, never in a URL.
 *
 * GET /api/native/captures?before=<iso>&limit=30 — newest first, paged by
 * `startedAt`.
 *
 * Owner-only (`withDevice`): a member's phone gets the wrapper's 403.
 */
export const POST: RequestHandler = withDevice(async (event, identity) => {
  const body = await event.request.json().catch(() => null);
  const parsed = parseCaptureIntake(body);
  if (!parsed.ok) return json({ error: parsed.error }, { status: 400 });
  const row = await createCapture(identity.ownerEmail, recorderSpace(), parsed.value);
  startIfComplete(row);
  const base = `${event.url.origin}/api/native/captures/${encodeURIComponent(row.id)}`;
  return json(
    {
      id: row.id,
      ...(parsed.value.audio ? { uploadAudio: `${base}/audio` } : {}),
      ...(parsed.value.screenshot ? { uploadScreen: `${base}/screen` } : {}),
    },
    { status: 201 },
  );
});

export const GET: RequestHandler = withDevice(async ({ url }) => {
  const limit = clampLimit(url.searchParams.get('limit'), 30, 100);
  const beforeRaw = url.searchParams.get('before');
  const before = beforeRaw ? new Date(beforeRaw) : null;
  if (before && Number.isNaN(before.getTime())) return json({ error: 'before must be an ISO date-time.' }, { status: 400 });
  const { rows, open } = await listCaptures(recorderSpace(), { before, limit: limit + 1 });
  const page = rows.slice(0, limit);
  const next = rows.length > limit ? page[page.length - 1].startedAt.toISOString() : undefined;
  return { items: page.map((r) => toSummary(r, open.get(r.id) ?? 0)), ...(next ? { next } : {}) };
});
