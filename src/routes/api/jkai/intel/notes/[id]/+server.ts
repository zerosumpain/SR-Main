import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getNoteDetail } from '$lib/jkai/intel/queries';
import { processNote, deleteNoteCascade } from '$lib/jkai/intel/ingest';
import { db } from '$lib/db';
import { intelNotes } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { spaceIn } from '$lib/jkai/intel/scope';
import { resolveRequestScope } from '$lib/jkai/intel/scope.server';

export const GET: RequestHandler = async (event) => {
  const scope = await resolveRequestScope(event);
  const detail = await getNoteDetail(event.params.id, scope);
  if (!detail) return json({ error: 'Not found' }, { status: 404 });
  return json(detail);
};

export const POST: RequestHandler = async (event) => {
  const { params } = event;
  const scope = await resolveRequestScope(event);
  // processNote reads and rewrites the note by id alone (it runs unattended from
  // the ingest queue too), so THIS lookup is the scope check: a note outside the
  // reader's scope is a 404 and is never re-processed.
  const [note] = await db
    .select({ id: intelNotes.id, status: intelNotes.status })
    .from(intelNotes)
    .where(and(eq(intelNotes.id, params.id), spaceIn(intelNotes.spaceId, scope)))
    .limit(1);

  if (!note) return json({ error: 'Not found' }, { status: 404 });

  processNote(params.id).catch((err) => {
    console.error(`[intel] Retry processing failed for note ${params.id}:`, err);
  });

  return json({ id: params.id, status: 'processing' });
};

export const DELETE: RequestHandler = async (event) => {
  const { params } = event;
  const scope = await resolveRequestScope(event);
  try {
    // Null for a note that does not exist OR sits outside the scope — both 404.
    const result = await deleteNoteCascade(params.id, scope);
    if (!result) return json({ error: 'Not found' }, { status: 404 });
    return json(result);
  } catch (err) {
    console.error(`[intel] Cascade delete failed for note ${params.id}:`, err);
    return json({ error: 'Delete failed' }, { status: 500 });
  }
};
