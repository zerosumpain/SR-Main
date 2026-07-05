// Single RAG collection — detail (with transcript) + delete.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { ragCollections, ragMessages } from '$lib/db/schema';
import { and, eq, asc } from 'drizzle-orm';
import { deleteIndex } from '$lib/rag/index-store';
import { reconcileStale } from '$lib/rag/pipeline';

async function owned(id: string, owner: string | null) {
  if (!owner) return null;
  const [col] = await db
    .select()
    .from(ragCollections)
    .where(and(eq(ragCollections.id, id), eq(ragCollections.owner, owner)))
    .limit(1);
  return col ?? null;
}

export const GET: RequestHandler = async ({ params, locals }) => {
  const session = await locals.auth();
  const owned0 = await owned(params.id!, session?.user?.email ?? null);
  if (!owned0) return json({ error: 'not found' }, { status: 404 });
  const col = await reconcileStale(owned0);
  const messages = await db
    .select()
    .from(ragMessages)
    .where(eq(ragMessages.collectionId, col.id))
    .orderBy(asc(ragMessages.createdAt));
  return json({ collection: col, messages });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
  const session = await locals.auth();
  const col = await owned(params.id!, session?.user?.email ?? null);
  if (!col) return json({ error: 'not found' }, { status: 404 });
  // Best-effort blob cleanup, then cascade-delete the row (messages cascade via FK).
  try {
    await deleteIndex(col.id);
  } catch (err) {
    console.warn(`[rag] index blob delete failed for ${col.id}:`, (err as Error).message);
  }
  await db.delete(ragCollections).where(eq(ragCollections.id, col.id));
  return json({ ok: true });
};
