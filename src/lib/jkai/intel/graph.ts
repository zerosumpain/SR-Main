import { db } from '$lib/db';
import {
  intelEntities,
  intelEntityTypes,
  intelRelationships,
  intelNoteEntities,
  intelTimelineEvents,
  intelNotes,
} from '$lib/db/schema';
import { eq, desc, sql } from 'drizzle-orm';
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

  const [created] = await db
    .insert(intelEntities)
    .values({
      name: entity.name,
      typeId,
      properties: entity.properties,
      confidence: entity.confidence,
      firstSeenIn: noteId,
    })
    .returning({ id: intelEntities.id });

  return created.id;
}

async function updateEntitySummaries(entityIds: string[]): Promise<void> {
  if (entityIds.length === 0) return;

  const modelCtx = await resolveDefaultModel('chat');
  const { client, model } = await getLLMClient(modelCtx);

  for (const entityId of entityIds) {
    try {
      const [entity] = await db
        .select({
          id: intelEntities.id,
          name: intelEntities.name,
          typeName: intelEntityTypes.name,
          properties: intelEntities.properties,
        })
        .from(intelEntities)
        .innerJoin(intelEntityTypes, eq(intelEntities.typeId, intelEntityTypes.id))
        .where(eq(intelEntities.id, entityId))
        .limit(1);

      if (!entity) continue;

      const noteExcerpts = await db
        .select({
          content: sql<string>`substring(${intelNotes.processedContent} from 1 for 500)`,
          date: intelNotes.createdAt,
        })
        .from(intelNoteEntities)
        .innerJoin(intelNotes, eq(intelNoteEntities.noteId, intelNotes.id))
        .where(eq(intelNoteEntities.entityId, entityId))
        .orderBy(desc(intelNotes.createdAt))
        .limit(5);

      if (noteExcerpts.length === 0) continue;

      const excerptText = noteExcerpts
        .map((n, i) => `Note ${i + 1} (${new Date(n.date).toLocaleDateString()}):\n${n.content}`)
        .join('\n\n');

      const response = await client.chat.completions.create({
        model,
        temperature: 0.3,
        max_tokens: 300,
        messages: [
          {
            role: 'system',
            content: 'Write a concise 2-3 sentence summary of this entity based on what is known from the notes. Focus on role, key relationships, and current concerns. Return only the summary text.',
          },
          {
            role: 'user',
            content: `Entity: ${entity.name} (${entity.typeName})\nProperties: ${JSON.stringify(entity.properties)}\n\nRelevant notes:\n${excerptText}`,
          },
        ],
      });

      const summary = response.choices[0]?.message?.content?.trim();
      if (summary) {
        await db
          .update(intelEntities)
          .set({ summary, updatedAt: new Date() })
          .where(eq(intelEntities.id, entityId));
      }
    } catch (err) {
      console.error(`[intel] Failed to update summary for entity ${entityId}:`, err);
    }
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
