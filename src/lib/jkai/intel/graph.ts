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

/**
 * Canonical form of a type name, for comparing proposals against what exists.
 * Collapses the ways a model spells the same idea: "Data Source", "data-source",
 * "data_sources" all normalise to "datasource".
 */
export function normaliseTypeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[\s_-]+/g, '')
    .replace(/(ies)$/, 'y')
    .replace(/(?<=[a-z]{3})s$/, '');
}

/**
 * A new type is only worth creating if nothing existing means the same thing.
 * Without this the taxonomy fragments: production reached 25 types, several
 * holding one or two entities, and a stray `font` type then acted as a magnet
 * for anything the model was unsure about (three newspapers were filed as
 * fonts). Fewer, better-populated types make the graph legible and make
 * type-filtered views useful.
 */
const MAX_NEW_TYPES_PER_EXTRACTION = 2;

async function loadTypeIndex(): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: intelEntityTypes.id, name: intelEntityTypes.name })
    .from(intelEntityTypes);
  const index = new Map<string, string>();
  for (const r of rows) {
    index.set(r.name.toLowerCase(), r.id);
    index.set(normaliseTypeName(r.name), r.id);
  }
  return index;
}

async function resolveTypeId(typeName: string): Promise<string | null> {
  const [row] = await db
    .select({ id: intelEntityTypes.id })
    .from(intelEntityTypes)
    .where(eq(intelEntityTypes.name, typeName.toLowerCase()))
    .limit(1);
  if (row) return row.id;

  // Fall back to the normalised form so a plural or a hyphen doesn't strand an
  // entity. Previously an unresolvable type meant the entity was dropped
  // entirely — silent data loss on every near-miss the model made.
  const index = await loadTypeIndex();
  return index.get(normaliseTypeName(typeName)) ?? null;
}

/** The type every entity falls back to rather than being discarded. */
const FALLBACK_TYPE = { name: 'concept', icon: '🔷', description: 'An idea, term, or thing that does not fit a more specific type' };

async function ensureFallbackType(): Promise<string> {
  const existing = await resolveTypeId(FALLBACK_TYPE.name);
  if (existing) return existing;
  const [created] = await db
    .insert(intelEntityTypes)
    .values({ ...FALLBACK_TYPE, isSeeded: true })
    .onConflictDoNothing({ target: intelEntityTypes.name })
    .returning({ id: intelEntityTypes.id });
  return created?.id ?? (await resolveTypeId(FALLBACK_TYPE.name)) ?? '';
}

async function createProposedTypes(proposed: ProposedNewType[]): Promise<void> {
  if (!proposed.length) return;
  const index = await loadTypeIndex();
  let created = 0;

  for (const t of proposed) {
    if (created >= MAX_NEW_TYPES_PER_EXTRACTION) {
      console.log(`[intel] type proposal cap reached, ignoring "${t.name}"`);
      break;
    }
    const name = t.name.toLowerCase().trim();
    if (!name) continue;

    const key = normaliseTypeName(name);
    if (index.has(name) || index.has(key)) continue; // a synonym already exists

    const [row] = await db
      .insert(intelEntityTypes)
      .values({ name, icon: t.icon, description: t.description, isSeeded: false })
      .onConflictDoNothing({ target: intelEntityTypes.name })
      .returning({ id: intelEntityTypes.id });

    if (row) {
      index.set(name, row.id);
      index.set(key, row.id);
      created++;
    }
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

  // An unrecognised type used to discard the entity outright, which lost real
  // intelligence whenever the model coined a type it hadn't also proposed.
  // Park it under `concept` instead — visible, reviewable, and retypeable.
  let typeId = await resolveTypeId(entity.type);
  if (!typeId) {
    typeId = await ensureFallbackType();
    if (!typeId) {
      console.warn(`[intel] no type available for "${entity.name}", skipping`);
      return '';
    }
    console.warn(`[intel] unknown type "${entity.type}" for "${entity.name}" → concept`);
  }

  // Deterministic fallback before inserting. Resolution otherwise depends
  // entirely on the model returning possibleMatchId, so a missed match created a
  // duplicate — and now that candidates are retrieved by similarity rather than
  // listed exhaustively, an exact name the model didn't see must still resolve.
  //
  // Matched on NAME ALONE, deliberately. This used to require the type to match
  // too, which meant the model calling something a `policy` in one note and a
  // `system` in the next produced two entities with the same name — over twenty
  // such pairs in production, including "Responsible AI Strategy" split into a
  // project (16 links) and a policy (1 link). One name is one thing; a
  // disagreement about its type is a typing question, not grounds for a second
  // node. The existing type is kept, since it was chosen with the evidence that
  // first created the entity.
  const [sameName] = await db
    .select({ id: intelEntities.id, properties: intelEntities.properties, typeId: intelEntities.typeId })
    .from(intelEntities)
    .where(
      and(
        sql`lower(${intelEntities.name}) = ${entity.name.trim().toLowerCase()}`,
        isNull(intelEntities.mergedIntoId),
      ),
    )
    .orderBy(desc(intelEntities.confirmed), intelEntities.createdAt)
    .limit(1);

  if (sameName) {
    // The one exception: an entity parked under the `concept` fallback should
    // adopt a real type as soon as one is offered.
    const fallbackId = await ensureFallbackType();
    const retype = sameName.typeId === fallbackId && typeId !== fallbackId;

    await db
      .update(intelEntities)
      .set({
        properties: { ...(sameName.properties as Record<string, unknown> ?? {}), ...entity.properties },
        updatedAt: new Date(),
        ...(retype ? { typeId } : {}),
        ...(entity.confidence === 'high' ? { confidence: 'high', confirmed: true } : {}),
      })
      .where(eq(intelEntities.id, sameName.id));
    return sameName.id;
  }

  // A brand-new entity is embedded immediately, not merely when a summary
  // eventually lands. Candidate retrieval in extract.ts filters on
  // `embedding IS NOT NULL`, so an unembedded entity cannot be matched against
  // and the next note mentioning it creates a second copy.
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

  // Fire-and-forget: extraction must not wait on, or fail because of, the
  // embedding service. The backfill sweep catches anything that misses.
  void import('./embed')
    .then(({ embedEntity }) => embedEntity(created.id))
    .catch(() => {});

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

/**
 * Fill in summaries for entities that don't have one, in batches.
 *
 * Needed because entities created before the summariser had evidence to read
 * (see the processedContent ordering note in ./auto-extract.ts) were left
 * summary-less, which also leaves their embeddings weaker — and those
 * embeddings are what candidate-based entity resolution now retrieves on.
 */
export async function backfillEntitySummaries(limit = 100): Promise<{ processed: number; remaining: number }> {
  const capped = Math.max(1, Math.min(limit, 500));

  const rows = await db
    .select({ id: intelEntities.id })
    .from(intelEntities)
    .where(and(isNull(intelEntities.summary), isNull(intelEntities.mergedIntoId)))
    .limit(capped);

  for (let i = 0; i < rows.length; i += SUMMARY_BATCH) {
    await updateEntitySummaries(rows.slice(i, i + SUMMARY_BATCH).map((r) => r.id));
  }

  const [{ count: remaining } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(intelEntities)
    .where(and(isNull(intelEntities.summary), isNull(intelEntities.mergedIntoId)));

  console.log(`[intel] summary backfill — attempted ${rows.length}, ${remaining} still without a summary`);
  return { processed: rows.length, remaining };
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

  // Relationships and timeline events are UPSERTED, not blindly inserted.
  //
  // These were plain inserts, which meant every re-extraction of a note (a file
  // re-indexed, a research report rewritten, the digest changed) laid down a
  // fresh copy of every edge it had already recorded. The graph accumulated
  // parallel duplicate edges that inflated every degree/centrality count and
  // drew as overlapping lines. Dedup is done in the application rather than with
  // a unique constraint: adding `.unique()` to a populated table silently breaks
  // non-interactive `drizzle-kit push` (see reference_drizzle_unique_push_gotcha).
  let relationshipCount = 0;
  for (const rel of result.relationships) {
    const sourceId = entityIdMap.get(rel.source);
    const targetId = entityIdMap.get(rel.target);
    if (!sourceId || !targetId) continue;
    // A self-loop carries no information and breaks force layouts.
    if (sourceId === targetId) continue;

    const [existing] = await db
      .select({ id: intelRelationships.id, confidence: intelRelationships.confidence })
      .from(intelRelationships)
      .where(
        and(
          eq(intelRelationships.sourceEntityId, sourceId),
          eq(intelRelationships.targetEntityId, targetId),
          eq(intelRelationships.type, rel.type),
        ),
      )
      .limit(1);

    if (existing) {
      // Seeing the same edge again is corroboration: keep the best label we
      // have and let confidence ratchet upward, never down.
      const upgrade = rel.confidence === 'high' && existing.confidence !== 'high';
      await db
        .update(intelRelationships)
        .set({
          ...(rel.label ? { label: rel.label } : {}),
          ...(upgrade ? { confidence: 'high' } : {}),
        })
        .where(eq(intelRelationships.id, existing.id));
      continue;
    }

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

    const [duplicate] = await db
      .select({ id: intelTimelineEvents.id })
      .from(intelTimelineEvents)
      .where(
        and(
          eq(intelTimelineEvents.noteId, noteId),
          eq(intelTimelineEvents.date, event.date),
          eq(intelTimelineEvents.title, event.title),
        ),
      )
      .limit(1);
    if (duplicate) continue;

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
