import { db } from '$lib/db';
import {
  intelEntities,
  intelEntityTypes,
  intelRelationships,
  intelNoteEntities,
  intelTimelineEvents,
  intelNotes,
} from '$lib/db/schema';
import { eq, desc, sql, and, inArray, isNull } from 'drizzle-orm';
import { getLLMClient } from '$lib/jkai/llm-client';
import { resolveDefaultModel } from '$lib/server/models/settings';
import type {
  ExtractionResult,
  ExtractedEntity,
  ProposedNewType,
} from './extract';

async function resolveTypeId(typeName: string): Promise<string | null> {
  const [row] = await db
    .select({ id: intelEntityTypes.id })
    .from(intelEntityTypes)
    .where(eq(intelEntityTypes.name, typeName.toLowerCase()))
    .limit(1);
  return row?.id ?? null;
}

async function createProposedTypes(proposed: ProposedNewType[]): Promise<void> {
  for (const t of proposed) {
    await db
      .insert(intelEntityTypes)
      .values({
        name: t.name.toLowerCase(),
        icon: t.icon,
        description: t.description,
        isSeeded: false,
      })
      .onConflictDoNothing({ target: intelEntityTypes.name });
  }
}

async function upsertEntity(
  entity: ExtractedEntity,
  noteId: string,
): Promise<string> {
  if (entity.possibleMatchId) {
    const [existing] = await db
      .select()
      .from(intelEntities)
      .where(eq(intelEntities.id, entity.possibleMatchId))
      .limit(1);

    if (existing) {
      const mergedProps = { ...(existing.properties as Record<string, unknown> ?? {}), ...entity.properties };
      await db
        .update(intelEntities)
        .set({
          properties: mergedProps,
          updatedAt: new Date(),
          ...(entity.confidence === 'high' ? { confidence: 'high' } : {}),
        })
        .where(eq(intelEntities.id, existing.id));
      return existing.id;
    }
  }

  const typeId = await resolveTypeId(entity.type);
  if (!typeId) {
    console.warn(`[intel] Unknown entity type "${entity.type}" for "${entity.name}", skipping`);
    return '';
  }

  // Deterministic fallback before inserting. Resolution otherwise depends
  // entirely on the model returning possibleMatchId, so a missed match created a
  // duplicate — and now that candidates are retrieved by similarity rather than
  // listed exhaustively, an exact name the model didn't see must still resolve.
  const [sameName] = await db
    .select({ id: intelEntities.id, properties: intelEntities.properties })
    .from(intelEntities)
    .where(
      and(
        sql`lower(${intelEntities.name}) = ${entity.name.trim().toLowerCase()}`,
        eq(intelEntities.typeId, typeId),
        isNull(intelEntities.mergedIntoId),
      ),
    )
    .limit(1);

  if (sameName) {
    await db
      .update(intelEntities)
      .set({
        properties: { ...(sameName.properties as Record<string, unknown> ?? {}), ...entity.properties },
        updatedAt: new Date(),
        ...(entity.confidence === 'high' ? { confidence: 'high', confirmed: true } : {}),
      })
      .where(eq(intelEntities.id, sameName.id));
    return sameName.id;
  }

  const [created] = await db
    .insert(intelEntities)
    .values({
      name: entity.name,
      typeId,
      properties: entity.properties,
      confidence: entity.confidence,
      // Confidence gate: high-confidence extractions join the graph directly;
      // medium/low wait in /jkai/intel/review. Without this every entity
      // needed manual confirmation, which does not scale now that /drive
      // uploads and finished research auto-extract too.
      confirmed: entity.confidence === 'high',
      firstSeenIn: noteId,
    })
    .returning({ id: intelEntities.id });

  return created.id;
}

/** Most entities summarised in a single batched call. */
const SUMMARY_BATCH = 25;

/**
 * Write summaries for entities that don't have one yet.
 *
 * This used to be one LLM call PER entity, sequentially, on every extraction —
 * so a note yielding 20 entities cost 21 calls, and every later note that
 * merely mentioned those entities paid to re-summarise them. Now it is one
 * batched call covering up to SUMMARY_BATCH entities, and only entities still
 * lacking a summary are considered.
 *
 * Re-summarising on new evidence is a separate, deliberate job (see
 * `refreshEntitySummary`) rather than a side effect of every ingest.
 */
async function updateEntitySummaries(entityIds: string[]): Promise<void> {
  if (entityIds.length === 0) return;

  const pending = await db
    .select({
      id: intelEntities.id,
      name: intelEntities.name,
      typeName: intelEntityTypes.name,
      properties: intelEntities.properties,
    })
    .from(intelEntities)
    .innerJoin(intelEntityTypes, eq(intelEntities.typeId, intelEntityTypes.id))
    .where(and(inArray(intelEntities.id, entityIds), isNull(intelEntities.summary)));

  if (pending.length === 0) return;

  const batch = pending.slice(0, SUMMARY_BATCH);

  // Context: the notes these entities appear in, fetched once for the batch
  // rather than once per entity.
  const excerpts = await db
    .select({
      entityId: intelNoteEntities.entityId,
      content: sql<string>`substring(${intelNotes.processedContent} from 1 for 400)`,
      date: intelNotes.createdAt,
    })
    .from(intelNoteEntities)
    .innerJoin(intelNotes, eq(intelNoteEntities.noteId, intelNotes.id))
    .where(inArray(intelNoteEntities.entityId, batch.map((e) => e.id)))
    .orderBy(desc(intelNotes.createdAt))
    .limit(batch.length * 3);

  const byEntity = new Map<string, string[]>();
  for (const row of excerpts) {
    const list = byEntity.get(row.entityId) ?? [];
    if (list.length < 3) list.push(row.content ?? '');
    byEntity.set(row.entityId, list);
  }

  const payload = batch.map((e) => ({
    id: e.id,
    name: e.name,
    type: e.typeName,
    properties: e.properties ?? {},
    evidence: (byEntity.get(e.id) ?? []).filter(Boolean),
  }));

  try {
    const modelCtx = await resolveDefaultModel('builder');
    const { client, model } = await getLLMClient(modelCtx);

    const response = await client.chat.completions.create({
      model,
      temperature: 0.3,
      max_tokens: Math.min(600 + payload.length * 90, 8000),
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'For each entity, write a concise 2-3 sentence summary from the evidence given. Focus on role, key relationships, and current concerns. ' +
            'Return ONLY a JSON object of the form {"summaries":[{"id":"<entity id>","summary":"..."}]} covering every entity you were given. ' +
            'If the evidence says nothing useful about an entity, omit it rather than inventing detail.',
        },
        { role: 'user', content: JSON.stringify({ entities: payload }) },
      ],
    });

    const raw = response.choices[0]?.message?.content ?? '{}';
    const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
    const parsed = JSON.parse(cleaned) as { summaries?: Array<{ id?: string; summary?: string }> };
    const valid = new Set(batch.map((e) => e.id));

    const { embedEntity } = await import('./embed');
    for (const item of parsed.summaries ?? []) {
      const summary = item.summary?.trim();
      if (!item.id || !summary || !valid.has(item.id)) continue;
      await db
        .update(intelEntities)
        .set({ summary, updatedAt: new Date() })
        .where(eq(intelEntities.id, item.id));
      await embedEntity(item.id);
    }
  } catch (err) {
    console.error('[intel] Batched summary update failed:', err instanceof Error ? err.message : err);
  }
}

export async function persistExtraction(
  noteId: string,
  result: ExtractionResult,
): Promise<{ entityCount: number; relationshipCount: number; timelineEventCount: number }> {
  await createProposedTypes(result.proposedNewTypes);

  const entityIdMap = new Map<string, string>();
  for (const entity of result.entities) {
    const id = await upsertEntity(entity, noteId);
    if (id) {
      entityIdMap.set(entity.name, id);
    }
  }

  for (const entity of result.entities) {
    const entityId = entityIdMap.get(entity.name);
    if (!entityId) continue;
    await db
      .insert(intelNoteEntities)
      .values({
        noteId,
        entityId,
        relevance: entity.confidence === 'high' ? 'primary' : 'mentioned',
      })
      .onConflictDoNothing();
  }

  let relationshipCount = 0;
  for (const rel of result.relationships) {
    const sourceId = entityIdMap.get(rel.source);
    const targetId = entityIdMap.get(rel.target);
    if (!sourceId || !targetId) continue;

    await db.insert(intelRelationships).values({
      sourceEntityId: sourceId,
      targetEntityId: targetId,
      type: rel.type,
      label: rel.label,
      confidence: rel.confidence,
      sourceNoteId: noteId,
    });
    relationshipCount++;
  }

  let timelineEventCount = 0;
  for (const event of result.timelineEvents) {
    const entityId = event.linkedEntity ? entityIdMap.get(event.linkedEntity) ?? null : null;

    await db.insert(intelTimelineEvents).values({
      entityId,
      noteId,
      date: event.date,
      dateEnd: event.dateEnd ?? null,
      type: event.type,
      title: event.title,
      description: event.description ?? null,
    });
    timelineEventCount++;
  }

  // Update summaries for affected entities (async, non-blocking)
  const entityIds = [...entityIdMap.values()];
  updateEntitySummaries(entityIds).catch((err) => {
    console.error('[intel] Summary update failed:', err);
  });

  return { entityCount: entityIdMap.size, relationshipCount, timelineEventCount };
}
