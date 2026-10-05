import { json } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { withNativeAccess } from '$lib/server/native-handler';
import { peopleViewerOf, type PeopleViewer } from '$lib/home/presence/viewer';
import { db } from '$lib/db';
import { forecastFeedback } from '$lib/db/schema';
import { localClock } from '$lib/home/presence/forecast';

const NOTE_MAX = 280;

/** Who said it: the owner, or the member the gate set as the viewer. */
async function reporterOf(event: Parameters<RequestHandler>[0], ownerEmail: string, role: string): Promise<string | null> {
  if (role === 'owner') return ownerEmail.trim().toLowerCase();
  const viewer = await event.locals.viewer;
  return viewer && viewer.kind === 'member' ? viewer.email.trim().toLowerCase() : null;
}

async function viewerFor(event: Parameters<RequestHandler>[0], role: string): Promise<PeopleViewer | null> {
  if (role === 'owner') return { kind: 'owner' };
  return peopleViewerOf(event);
}

/**
 * POST /api/native/family/forecast/feedback — "that's wrong" on a next move,
 * from a long press in the app: `{ subject, kind: 'routine'|'arriving',
 * routineId?, departedAt?, note? }`. Somebody who knows better ("Katie isn't
 * going to the station") takes the move off the forecast for today, and each
 * such day counts against the routine from then on (`correctedShare` in
 * `$lib/home/presence/forecast`). Answers `{ id }`.
 *
 * Only a move the caller's own forecast is showing can be corrected: the move
 * is looked up in `loadForecast(viewer)`, scoped exactly as the forecast is,
 * so nobody corrects a person they cannot see. 404 when it is no longer there.
 *
 * DELETE `?id=` — take your own correction back (an accidental press).
 */
export const POST: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const viewer = await viewerFor(event, role);
  if (!viewer) return json({ error: 'Your access does not include the family.' }, { status: 403 });
  const body = (await event.request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Body must be JSON' }, { status: 400 });
  const subject = typeof body.subject === 'string' ? body.subject : '';
  const kind = body.kind === 'arriving' ? 'arriving' : body.kind === 'routine' ? 'routine' : null;
  const routineId = typeof body.routineId === 'string' ? body.routineId : null;
  const departedAt = typeof body.departedAt === 'string' ? body.departedAt : null;
  const rawNote = typeof body.note === 'string' ? body.note.trim() : '';
  if (!subject || !kind) return json({ error: 'Say whose move and which kind.' }, { status: 400 });
  if (kind === 'routine' && !routineId) return json({ error: 'A routine move needs its routineId.' }, { status: 400 });
  if (kind === 'arriving' && !departedAt) return json({ error: 'A journey needs its departedAt.' }, { status: 400 });
  if ([...rawNote].length > NOTE_MAX) return json({ error: `Keep the note under ${NOTE_MAX} characters.` }, { status: 400 });

  const { loadForecast } = await import('$lib/home/presence/forecast.server');
  const now = new Date();
  const { forecast } = await loadForecast(viewer, 28, null, now);
  const move = forecast.next.find((m) =>
    m.subject === subject && m.kind === kind && (kind === 'routine' ? m.routineId === routineId : m.leaveAt === departedAt));
  if (!move) return json({ error: 'That prediction has already changed.' }, { status: 404 });

  const reporter = await reporterOf(event, identity.ownerEmail, role);
  if (!reporter) return json({ error: 'Your access does not include the family.' }, { status: 403 });
  const [row] = await db.insert(forecastFeedback).values({
    subject,
    kind,
    routineId: kind === 'routine' ? routineId : null,
    departedAt: kind === 'arriving' ? departedAt : null,
    toPlace: move.to,
    date: localClock(now).date,
    note: rawNote || null,
    reporterEmail: reporter,
    createdAt: now,
  }).returning({ id: forecastFeedback.id });
  return json({ id: row.id }, { status: 201 });
});

export const DELETE: RequestHandler = withNativeAccess('any', async (event, identity, role) => {
  const viewer = await viewerFor(event, role);
  if (!viewer) return json({ error: 'Your access does not include the family.' }, { status: 403 });
  const id = event.url.searchParams.get('id') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'Which correction?' }, { status: 400 });
  const reporter = await reporterOf(event, identity.ownerEmail, role);
  if (!reporter) return json({ error: 'Your access does not include the family.' }, { status: 403 });
  const gone = await db.delete(forecastFeedback)
    .where(and(eq(forecastFeedback.id, id), eq(forecastFeedback.reporterEmail, reporter)))
    .returning({ id: forecastFeedback.id });
  if (!gone.length) return json({ error: 'That correction has gone.' }, { status: 404 });
  return { ok: true };
});
