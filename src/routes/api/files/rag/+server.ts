// RAG collections — create + list. Owner-gated automatically by hooks.server.ts
// (this path is under /api/ and absent from every bypass list). Do NOT add it
// to any PUBLIC_PATHS / PUBLIC_API_PATHS list.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflowFiles, ragCollections } from '$lib/db/schema';
import { eq, desc, inArray } from 'drizzle-orm';
import { buildCollection, reconcileStale } from '$lib/rag/pipeline';
import { primaryEmbeddingModel } from '$lib/rag/embed';

export const GET: RequestHandler = async ({ locals }) => {
  const session = await locals.auth();
  const owner = session?.user?.email ?? null;
  if (!owner) return json({ collections: [] });
  const rows = await db
    .select()
    .from(ragCollections)
    .where(eq(ragCollections.owner, owner))
    .orderBy(desc(ragCollections.updatedAt));
  // Recover any collections left mid-build by a server restart.
  const collections = await Promise.all(rows.map((c) => reconcileStale(c)));
  return json({ collections });
};

export const POST: RequestHandler = async ({ request, locals }) => {
  const session = await locals.auth();
  const owner = session?.user?.email ?? null;
  if (!owner) return json({ error: 'unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const fileIds: string[] = Array.isArray(body.fileIds) ? body.fileIds.filter((x: unknown) => typeof x === 'string') : [];
  if (!fileIds.length) return json({ error: 'fileIds required' }, { status: 400 });

  const rows = await db.select().from(workflowFiles).where(inArray(workflowFiles.id, fileIds));
  if (!rows.length) return json({ error: 'no matching files' }, { status: 404 });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const orderedIds = fileIds.filter((id) => byId.has(id));
  const fileNames = orderedIds.map((id) => byId.get(id)!.name);

  const rawName = typeof body.name === 'string' ? body.name.trim() : '';
  const name = rawName || defaultName(fileNames);

  const [col] = await db
    .insert(ragCollections)
    .values({
      name,
      owner,
      status: 'pending',
      // Resolve rather than read the constant: the embeddings model is
      // settable, and this row is what query time embeds against.
      embeddingModel: await primaryEmbeddingModel(),
      fileIds: orderedIds,
      fileNames,
    })
    .returning();

  // Build in the background; the persistent node server keeps the promise alive.
  // buildCollection sets status → indexing → ready|error on the row, so the
  // client polls GET /api/files/rag/[id] for progress.
  void buildCollection(col.id).catch((err) => {
    console.error(`[rag] build failed for ${col.id}:`, err);
  });

  return json({ collection: col }, { status: 201 });
};

function defaultName(fileNames: string[]): string {
  if (!fileNames.length) return 'Untitled collection';
  const base = fileNames[0].split('/').pop() ?? fileNames[0];
  if (fileNames.length === 1) return base;
  return `${base} +${fileNames.length - 1} more`;
}
