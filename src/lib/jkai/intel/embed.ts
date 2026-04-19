import { getLLMClient } from '$lib/jkai/llm-client';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { db } from '$lib/db';
import { intelNotes, intelEntities } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export async function generateEmbedding(text: string): Promise<number[]> {
  const modelCtx = await resolveDefaultModel('chat');
  const { client } = await getLLMClient(modelCtx);

  const truncated = text.slice(0, 32000);

  const response = await client.embeddings.create({
    model: 'text-embedding-3-small',
    input: truncated,
  });

  return response.data[0].embedding;
}

export async function embedNote(noteId: string): Promise<void> {
  const [note] = await db
    .select({ id: intelNotes.id, processedContent: intelNotes.processedContent, rawContent: intelNotes.rawContent })
    .from(intelNotes)
    .where(eq(intelNotes.id, noteId))
    .limit(1);

  if (!note) return;

  const text = note.processedContent || note.rawContent;
  if (!text) return;

  const embedding = await generateEmbedding(text);

  await db
    .update(intelNotes)
    .set({ embedding })
    .where(eq(intelNotes.id, noteId));
}

export async function embedEntity(entityId: string): Promise<void> {
  const [entity] = await db
    .select()
    .from(intelEntities)
    .where(eq(intelEntities.id, entityId))
    .limit(1);

  if (!entity) return;

  const parts = [
    entity.name,
    entity.summary ?? '',
    entity.properties ? JSON.stringify(entity.properties) : '',
  ].filter(Boolean);

  const text = parts.join(' — ');
  if (!text) return;

  const embedding = await generateEmbedding(text);

  await db
    .update(intelEntities)
    .set({ embedding })
    .where(eq(intelEntities.id, entityId));
}
