// Rebuild a collection's index from the current bytes of its files.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getOwnedCollection, buildCollection } from '$lib/rag/pipeline';

export const POST: RequestHandler = async ({ params, locals }) => {
  const session = await locals.auth();
  const owner = session?.user?.email ?? null;
  const col = await getOwnedCollection(params.id!, owner ?? '');
  if (!col) return json({ error: 'not found' }, { status: 404 });

  void buildCollection(col.id).catch((err) => {
    console.error(`[rag] reindex failed for ${col.id}:`, err);
  });
  return json({ ok: true, status: 'indexing' });
};
