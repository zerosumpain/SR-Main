import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getNoteDetail } from '$lib/jkai/intel/queries';
import { db } from '$lib/db';
import { intelNotes } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params }) => {
  const detail = await getNoteDetail(params.id);
  if (!detail) return json({ error: 'Not found' }, { status: 404 });
  return json(detail);
};

export const DELETE: RequestHandler = async ({ params }) => {
  await db.delete(intelNotes).where(eq(intelNotes.id, params.id));
  return json({ deleted: true });
};
