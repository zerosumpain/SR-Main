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
import { resolveExtractionModel } from '$lib/server/models/settings';
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

/**
 * Type names by lookup key. Includes PROPOSED types by default, because a new
 * proposal must not duplicate one already pending; pass `activeOnly` when the
 * result will be used to assign a type to an entity.
 */
async function loadTypeIndex(opts: { activeOnly?: boolean } = {}): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: intelEntityTypes.id, name: intelEntityTypes.name })
    .from(intelEntityTypes)
    .where(opts.activeOnly ? eq(intelEntityTypes.status, 'active') : undefined);
  const index = new Map<string, string>();
  for (const r of rows) {
    index.set(r.name.toLowerCase(), r.id);
    index.set(normaliseTypeName(r.name), r.id);
  }
  return index;
}

async function resolveTypeId(typeName: string): Promise<string | null> {
  // Only ACTIVE types can be assigned. A proposed type is visible for review
  // but must not be usable until admitted, or the gate would achieve nothing.
  const [row] = await db
    .select({ id: intelEntityTypes.id })
    .from(intelEntityTypes)
    .where(and(eq(intelEntityTypes.name, typeName.toLowerCase()), eq(intelEntityTypes.status, 'active')))
    .limit(1);
  if (row) return row.id;

  // Fall back to the normalised form so a plural or a hyphen doesn't strand an
  // entity. Previously an unresolvable type meant the entity was dropped
  // entirely — silent data loss on every near-miss the model made.
  //
  // ACTIVE-only, deliberately: loadTypeIndex() also carries proposed types (it
  // has to, so a proposal cannot duplicate a pending one), and resolving
  // through it would hand out a type the gate has not admitted yet.
  const index = await loadTypeIndex({ activeOnly: true });
  return index.get(normaliseTypeName(typeName)) ?? null;
}

/**
 * Continuous edge weight from how often the edge was observed and how sure the
 * extractor was.
 *
 * The TEXT `strength` column was declared and never written — every edge in
 * production sat at the 'moderate' default, which made the graph's
 * stroke-width encoding purely decorative. Weight saturates rather than growing
 * without bound: the difference between one and three independent observations
 * matters; between twenty and thirty it does not.
 */
export function weightFor(observations: number, confidence: string): number {
  const base = confidence === 'high' ? 0.55 : confidence === 'low' ? 0.25 : 0.4;
  const corroboration = 1 - Math.exp(-Math.max(0, observations - 1) / 2);
  return Math.min(1, base + 0.45 * corroboration);
}

/** Display bucket derived from `weight`, kept for the existing UI encoding. */
export function strengthBucket(weight: number): string {
  if (weight >= 0.75) return 'strong';
  if (weight <= 0.35) return 'weak';
  return 'moderate';
}

/**
 * The sentence an entity was asserted in, for citation.
 *
 * Deliberately simple and deterministic — an LLM call per entity per note would
 * cost more than the extraction itself. Finds the first sentence containing the
 * name; falls back to a window around the first occurrence.
 */
export function findExcerpt(text: string, name: string, maxLen = 300): string | null {
  if (!text || !name) return null;
  const at = text.toLowerCase().indexOf(name.toLowerCase());
  if (at < 0) return null;

  // Expand to sentence boundaries around the hit.
  const before = text.lastIndexOf('.', at);
  const after = text.indexOf('.', at + name.length);
  const start = before >= 0 && at - before < maxLen ? before + 1 : Math.max(0, at - 120);
  const end = after >= 0 && after - at < maxLen ? after + 1 : Math.min(text.length, at + name.length + 180);

  const slice = text.slice(start, end).trim().replace(/\s+/g, ' ');
  if (!slice) return null;
  return slice.length > maxLen ? `${slice.slice(0, maxLen - 1)}…` : slice;
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

    // HELD, not admitted. An auto-admitted type re-enters the next extraction
    // prompt as a legitimate option, so one bad coinage becomes self-
    // reinforcing — which is exactly how a `font` type ended up collecting
    // newspapers. Proposed types are reviewable on /jkai/intel/quality.
    const [row] = await db
      .insert(intelEntityTypes)
      .values({
        name,
        icon: t.icon,
        description: t.description,
        isSeeded: false,
        status: 'proposed',
        proposedRationale: t.description,
      })
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
    // Filtered on mergedIntoId like every other entity lookup in this file.
    // Without it, an id the extractor picked up before a merge sweep ran could
    // write relationships and note links against a TOMBSTONE — rows the graph
    // loader can only rescue one hop, so they silently vanish from every view.
    const [existing] = await db
      .select()
      .from(intelEntities)
      .where(and(eq(intelEntities.id, entity.possibleMatchId), isNull(intelEntities.mergedIntoId)))
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
  // When several live entities share the name, the SAME-TYPE one wins. Without
  // that tie-break, name-only matching could fuse a person and an organisation
  // that happen to share a name (a real risk with surnames like "Morgan").
  // Falling back to name alone only happens when no same-type candidate exists,
  // which is the case this relaxation is for.
  const [sameName] = await db
    .select({ id: intelEntities.id, properties: intelEntities.properties, typeId: intelEntities.typeId })
    .from(intelEntities)
    .where(
      and(
        sql`lower(${intelEntities.name}) = ${entity.name.trim().toLowerCase()}`,
        isNull(intelEntities.mergedIntoId),
      ),
    )
    .orderBy(
      sql`(${intelEntities.typeId} = ${typeId}) DESC`,
      desc(intelEntities.confirmed),
      intelEntities.createdAt,
    )
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
    const modelCtx = await resolveExtractionModel();
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

  // Loaded once for excerpt capture — the evidence sentence behind each entity.
  const [noteRow] = await db
    .select({ processed: intelNotes.processedContent, raw: intelNotes.rawContent })
    .from(intelNotes)
    .where(eq(intelNotes.id, noteId))
    .limit(1);
  const noteText = noteRow?.processed || noteRow?.raw || '';

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

    // Checked explicitly rather than relying on `.onConflictDoNothing()`, which
    // silently did nothing here: intel_note_entities carries two foreign keys
    // and NO primary key or unique index, so there was never a constraint for
    // the conflict clause to act on. Every re-extraction of a note therefore
    // added another (note, entity) row, inflating every evidence count derived
    // from this table. A unique index is the obvious fix but cannot be added
    // to a populated table without breaking non-interactive `drizzle-kit push`.
    const [existingLink] = await db
      .select({ noteId: intelNoteEntities.noteId })
      .from(intelNoteEntities)
      .where(and(eq(intelNoteEntities.noteId, noteId), eq(intelNoteEntities.entityId, entityId)))
      .limit(1);
    if (existingLink) continue;

    await db.insert(intelNoteEntities).values({
      noteId,
      entityId,
      relevance: entity.confidence === 'high' ? 'primary' : 'mentioned',
      // The sentence this entity was actually asserted in. The column existed
      // and was never written, so nothing in the graph could show WHY it
      // believed anything — every claim was unfalsifiable. Captured here so
      // entity cards, dossiers and briefs can cite their evidence.
      excerpt: findExcerpt(noteText, entity.name),
    });
  }

  // Corroboration: how many distinct notes independently assert each entity.
  // Drives the trust score and the thin-evidence detector.
  for (const entityId of entityIdMap.values()) {
    await db.execute(sql`
      UPDATE intel_entities SET
        corroboration = (SELECT count(DISTINCT note_id)::int FROM intel_note_entities WHERE entity_id = ${entityId}),
        last_corroborated_at = now()
      WHERE id = ${entityId}
    `);
  }

  // Score immediately. Left to be computed lazily by the trust API, the column
  // stayed NULL for anything nobody had opened — and a lens filtering on
  // `confidence_score >= n` then returned ZERO entities, because NULL fails
  // every comparison. A filter that silently answers "nothing" is worse than
  // one that errors.
  try {
    const { refreshConfidence } = await import('./trust-refresh');
    await refreshConfidence([...entityIdMap.values()]);
  } catch (err) {
    console.warn('[intel] confidence refresh failed:', err instanceof Error ? err.message : err);
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
      .select({
        id: intelRelationships.id,
        confidence: intelRelationships.confidence,
        observationCount: intelRelationships.observationCount,
        manual: intelRelationships.manual,
        suppressed: intelRelationships.suppressed,
      })
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
      // A SUPPRESSED edge was deleted deliberately with a reason. Re-creating
      // it because the extractor saw it again would make correcting the graph
      // pointless — the same wrong edge would come back on every re-ingest.
      if (existing.suppressed) continue;

      // Seeing the same edge again is corroboration: raise the observation
      // count, recompute the weight from it, and let confidence ratchet upward,
      // never down. A MANUAL label is the user's and is never overwritten.
      const observations = (existing.observationCount ?? 1) + 1;
      const upgrade = rel.confidence === 'high' && existing.confidence !== 'high';
      await db
        .update(intelRelationships)
        .set({
          observationCount: observations,
          weight: weightFor(observations, upgrade ? 'high' : rel.confidence),
          strength: strengthBucket(weightFor(observations, rel.confidence)),
          lastSeenAt: new Date(),
          ...(rel.label && !existing.manual ? { label: rel.label } : {}),
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
      observationCount: 1,
      weight: weightFor(1, rel.confidence),
      strength: strengthBucket(weightFor(1, rel.confidence)),
      lastSeenAt: new Date(),
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
