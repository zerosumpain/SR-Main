import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getNoteDetail } from '$lib/jkai/intel/queries';
import { processNote, deleteNoteCascade } from '$lib/jkai/intel/ingest';
import { db } from '$lib/db';
import { intelNotes } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params }) => {
  const detail = await getNoteDetail(params.id);
  if (!detail) return json({ error: 'Not found' }, { status: 404 });
  return json(detail);
};

export const POST: RequestHandler = async ({ params }) => {
  const [note] = await db
    .select({ id: intelNotes.id, status: intelNotes.status })
    .from(intelNotes)
    .where(eq(intelNotes.id, params.id))
    .limit(1);

  if (!note) return json({ error: 'Not found' }, { status: 404 });

  processNote(params.id).catch((err) => {
    console.error(`[intel] Retry processing failed for note ${params.id}:`, err);
  });

  return json({ id: params.id, status: 'processing' });
};

export const DELETE: RequestHandler = async ({ params }) => {
  try {
    const result = await deleteNoteCascade(params.id);
    return json(result);
  } catch (err) {
    console.error(`[intel] Cascade delete failed for note ${params.id}:`, err);
    return json({ error: 'Delete failed' }, { status: 500 });
  }
};
