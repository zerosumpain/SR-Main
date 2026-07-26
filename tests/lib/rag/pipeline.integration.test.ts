// Integration test for the RAG pipeline — hits the REAL local DB + REAL
// OpenRouter embeddings + REAL LLM. Not part of the default suite (it costs a
// few cents and needs DATABASE_URL + keys.json). Run explicitly:
//   set -a; source .env; set +a; npm run test:external
import { describe, it, expect, afterAll } from 'vitest';
import { db } from '$lib/db';
import { workflowFiles, ragCollections, ragMessages } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { saveBuffer, deleteFile, newDiskPath } from '$lib/file-store/storage';
import { buildCollection, answer } from '$lib/rag/pipeline';
import { readIndex, deleteIndex } from '$lib/rag/index-store';

// Two conditions, deliberately. DATABASE_URL alone is NOT enough to opt in:
// CI sets it (a throwaway pgvector container), and so does homeserv's .env — so
// a DATABASE_URL-only gate means every `npm run gate` silently bills OpenRouter
// for embeddings + an LLM round. RUN_EXTERNAL_TESTS makes spending money an
// explicit act. Run via `npm run test:external`.
const RUN = !!process.env.DATABASE_URL && process.env.RUN_EXTERNAL_TESTS === '1';
const d = RUN ? describe : describe.skip;

// Distinctive, invented facts the model cannot know except from the document.
const DOC = `Zephyr Reactor Field Manual — Revision 12.

The Zephyr-9 fusion reactor operates at a core temperature of 4200 kelvin.
It is cooled exclusively by liquid gallium circulated through 18 helical channels.
The lead maintenance engineer is Dr. Priya Valdgren, contactable on extension 7731.
Routine servicing is scheduled every 90 days; the reactor must be at cold-idle first.`;

let fileId = '';
let collectionId = '';
let diskPath = '';

d('RAG pipeline (integration)', () => {
  it('indexes a document and answers grounded questions with citations', async () => {
    // 1. Seed a real file into the store.
    diskPath = newDiskPath('zephyr-manual.txt');
    await saveBuffer(diskPath, Buffer.from(DOC, 'utf-8'));
    const [file] = await db
      .insert(workflowFiles)
      .values({
        name: `zephyr-manual-${Date.now()}.txt`,
        mimeType: 'text/plain',
        sizeBytes: Buffer.byteLength(DOC),
        diskPath,
        permissions: { read: true, write: false, append: false, delete: true },
        uploadedBy: 'test@local',
      })
      .returning();
    fileId = file.id;

    // 2. Create the collection row.
    const [col] = await db
      .insert(ragCollections)
      .values({
        name: 'Zephyr manual',
        owner: 'test@local',
        status: 'pending',
        embeddingModel: 'openai/text-embedding-3-large',
        fileIds: [fileId],
        fileNames: [file.name],
      })
      .returning();
    collectionId = col.id;

    // 3. Build the index.
    const built = await buildCollection(collectionId);
    expect(built.chunkCount).toBeGreaterThan(0);
    expect(built.dim).toBeGreaterThan(0);
    expect(built.indexedFiles).toContain(file.name);

    const [afterBuild] = await db.select().from(ragCollections).where(eq(ragCollections.id, collectionId));
    expect(afterBuild.status).toBe('ready');
    expect(afterBuild.chunkCount).toBe(built.chunkCount);
    expect(afterBuild.indexBlobKey).toContain('rag-index/');

    // 4. The index blob round-trips with unit-normalized vectors.
    const index = await readIndex(collectionId);
    expect(index.length).toBe(built.chunkCount);
    const norm = Math.hypot(...index[0].vector);
    expect(norm).toBeCloseTo(1, 3);

    // 5. Answer a question that can only be answered from the doc.
    const res = await answer(collectionId, 'What is the Zephyr-9 reactor cooled by?');
    expect(res.usedContext).toBe(true);
    expect(res.citations.length).toBeGreaterThan(0);
    expect(res.text.toLowerCase()).toContain('gallium');

    // 6. A second grounded fact.
    const res2 = await answer(collectionId, 'Who is the lead maintenance engineer?');
    expect(res2.text.toLowerCase()).toContain('valdgren');

    // 7. Model override — answer with an explicit OpenRouter model (the picker
    //    feature) routes through getLLMClient and still grounds in the docs.
    const res3 = await answer(collectionId, 'What is the Zephyr-9 reactor cooled by?', {
      model: { provider: 'openrouter', modelId: 'openai/gpt-4o-mini' },
    });
    expect(res3.text.toLowerCase()).toContain('gallium');
  }, 180_000);
});

afterAll(async () => {
  if (!RUN) return;
  try { if (collectionId) await deleteIndex(collectionId); } catch { /* ignore */ }
  if (collectionId) {
    await db.delete(ragMessages).where(eq(ragMessages.collectionId, collectionId));
    await db.delete(ragCollections).where(eq(ragCollections.id, collectionId));
  }
  if (fileId) await db.delete(workflowFiles).where(eq(workflowFiles.id, fileId));
  try { if (diskPath) await deleteFile(diskPath); } catch { /* ignore */ }
});
