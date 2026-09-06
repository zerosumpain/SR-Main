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
import { getLLMClient } from '$lib/llm/client';
import { salvageSummaries, type SalvagedSummary } from './summary-salvage';
import { resolveExtractionModel } from '$lib/server/models/workload-settings';
import { withActivity } from '$lib/context/activity';
import { decayWeight } from './staleness';
import { canonicalName } from './resolve/match';
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
  if (opts.activeOnly) {
    const aliases = await db.execute(sql`WITH RECURSIVE aliases(name,target,path) AS (
      SELECT t.name,c.into_id,ARRAY[c.from_id,c.into_id] FROM intel_taxonomy_changes c JOIN intel_entity_types t ON t.id=c.from_id
      WHERE c.kind='type' AND c.action='merge' AND c.undone_at IS NULL
      UNION ALL SELECT a.name,c.into_id,a.path||c.into_id FROM aliases a JOIN intel_taxonomy_changes c ON c.from_id=a.target
      WHERE c.kind='type' AND c.action='merge' AND c.undone_at IS NULL AND NOT c.into_id=ANY(a.path)
    ) SELECT a.name,t.id FROM aliases a JOIN intel_entity_types t ON t.id=a.target WHERE t.status='active'`);
    for (const row of aliases.rows) { index.set(String(row.name).toLowerCase(),String(row.id)); index.set(normaliseTypeName(String(row.name)),String(row.id)); }
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

async function upsertEntity(entity: ExtractedEntity, noteId: string, text: string): Promise<string> {
  const typeId = await resolveTypeId(entity.type) ?? await ensureFallbackType();
  const { persistMention } = await import('./resolve/ingestion.server');
  return persistMention(entity, noteId, typeId, text);
}

/** Most entities summarised in a single batched call. */
const SUMMARY_BATCH = 25;

/**
 * How many output tokens one batch of summaries is allowed.
 *
 * The old figure — `600 + entities * 90`, so 2,850 for a full batch — is the
 * reason this call failed nightly. Measured against the production model
 * (`openai/gpt-oss-120b`) on production-shaped input, a full batch of 25 spends
 * roughly 2,400–2,900 completion tokens, so the budget sat exactly on the mean
 * of the distribution it was meant to bound. Two runs in three came back
 * `finish_reason: length` at precisely the cap and threw "Unterminated string
 * in JSON" — which is what the production logs had been showing for weeks.
 *
 * Two components, because the cost has two parts and only one of them scales:
 *
 *   reasoning   a fixed 270–420 tokens on this model regardless of batch size,
 *               spent before a single character of content appears.
 *   content     ~90 tokens per entity for a 2-3 sentence summary plus its JSON
 *               scaffolding and a 36-character uuid.
 *
 * 1,200 covers reasoning three times over, and 160 per entity gives the content
 * comfortable headroom over the ~90 it actually uses. A full batch is therefore
 * 5,200 rather than 2,850. The extra costs a fraction of a penny per call — the
 * whole measured request came to $0.0025 — and buys the difference between a
 * summary pass that works and one that silently loses a batch of 25.
 */
export function summaryTokenBudget(entities: number): number {
  return Math.min(1200 + Math.max(0, entities) * 160, 16000);
}

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
      version: sql<string>`${intelEntities.updatedAt}::text`,
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

    // Two attempts, as the extraction path does. A truncation is a matter of
    // how long this particular sample happened to run, so resampling fixes what
    // reparsing cannot — measured against the production model, two runs in
    // three overran and the third finished comfortably on identical input.
    let summaries: SalvagedSummary[] = [];
    let diag = '';
    for (let attempt = 1; attempt <= 2; attempt++) {
      const response = await withActivity('extraction', () =>
        client.chat.completions.create({
          model,
          temperature: 0.3,
          max_tokens: summaryTokenBudget(payload.length),
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
        }),
      );

      const choice = response.choices[0];
      const raw = choice?.message?.content ?? '';
      // finish_reason is the whole diagnosis and was not being recorded. Every
      // one of these failures logged only "Unterminated string in JSON at
      // position N", which reads as a malformed reply when it is in fact a
      // complete reply that was cut off at the budget.
      diag =
        `attempt=${attempt} finish=${choice?.finish_reason} entities=${payload.length} ` +
        `budget=${summaryTokenBudget(payload.length)} completion_tokens=${response.usage?.completion_tokens ?? '?'} chars=${raw.length}`;

      summaries = salvageSummaries(raw);
      const complete = choice?.finish_reason !== 'length' && summaries.length >= payload.length;
      if (complete) break;

      if (attempt === 1) {
        console.warn(`[intel] summary batch incomplete, retrying — ${diag} salvaged=${summaries.length}`);
      } else {
        // Second attempt also short. Whatever arrived is still worth writing —
        // the alternative is discarding paid-for work and leaving the entities
        // with no summary at all until some later sweep happens to pick them up.
        console.warn(`[intel] summary batch still incomplete, keeping what parsed — ${diag} salvaged=${summaries.length}`);
      }
    }

    if (!summaries.length) {
      console.error(`[intel] Batched summary update produced nothing — ${diag}`);
      return;
    }

    const valid = new Set(batch.map((e) => e.id));
    const { embedEntity } = await import('./embed');
    for (const item of summaries) {
      if (!valid.has(item.id)) continue;
      await db
        .update(intelEntities)
        .set({ summary: item.summary, updatedAt: new Date() })
        .where(and(eq(intelEntities.id, item.id), sql`${intelEntities.updatedAt}::text = ${batch.find(e => e.id === item.id)!.version}`));
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

/**
 * Options that let a SOURCE say how much its evidence is worth.
 *
 * Added for the rolling Gmail sweep. Everything else the graph ingests is
 * deliberately put in and effectively timeless — a document from March is not
 * less true in August — but ordinary correspondence does go stale, and without
 * this the graph would be led by whoever emailed most eleven weeks ago. Both
 * fields are optional and default to today's full-weight behaviour, so no
 * existing caller changes.
 */
export interface PersistOptions {
  /** 0..1 from $lib/jkai/intel/staleness. Discounts edge weight by age. */
  recency?: number;
  /** When the evidence was actually observed, if not now. */
  observedAt?: Date;
}

export async function persistExtraction(
  noteId: string,
  result: ExtractionResult,
  opts: PersistOptions = {},
): Promise<{ entityCount: number; relationshipCount: number; timelineEventCount: number }> {
  const recency = typeof opts.recency === 'number' ? opts.recency : 1;
  const observedAt = opts.observedAt ?? new Date();
  /** Edge weight after corroboration, then discounted for age. */
  const aged = (observations: number, confidence: string) =>
    decayWeight(weightFor(observations, confidence), recency);
  await db.update(intelNotes).set({ metadata: sql`coalesce(${intelNotes.metadata}, '{}'::jsonb) || jsonb_build_object('lastExtraction', ${JSON.stringify(result)}::jsonb)` }).where(eq(intelNotes.id,noteId));
  await createProposedTypes(result.proposedNewTypes);

  // Loaded once for excerpt capture — the evidence sentence behind each entity.
  const [noteRow] = await db
    .select({ processed: intelNotes.processedContent, raw: intelNotes.rawContent })
    .from(intelNotes)
    .where(eq(intelNotes.id, noteId))
    .limit(1);
  const noteText = noteRow?.processed || noteRow?.raw || '';

  const entityIdMap = new Map<string, string>();
  const resolvedEntities = new Map<ExtractedEntity, string>();
  for (const entity of result.entities) {
    const id = await upsertEntity(entity, noteId, noteText);
    if (id) {
      resolvedEntities.set(entity,id);
      if (entity.mentionId) entityIdMap.set(entity.mentionId,id);
      if (result.entities.filter(e=>e.name===entity.name).length===1) entityIdMap.set(entity.name, id);
    }
  }

  for (const entity of result.entities) {
    const entityId = resolvedEntities.get(entity);
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
      excerpt: findExcerpt(noteText, entity.mention?.text ?? entity.name),
    });
  }

  // Corroboration: how many distinct notes independently assert each entity.
  // Drives the trust score and the thin-evidence detector.
  //
  // One statement for the whole extraction, not one per entity. This was a
  // round-trip each — and each carried a correlated COUNT DISTINCT over a table
  // that had no index at all, so a note naming fifteen entities meant fifteen
  // full scans of intel_note_entities.
  const entityIds = [...new Set(resolvedEntities.values())];
  if (entityIds.length) {
    await db.execute(sql`
      UPDATE intel_entities e SET
        corroboration = c.n,
        last_corroborated_at = now()
      FROM (
        SELECT entity_id, count(DISTINCT note_id)::int AS n
        FROM intel_note_entities
        WHERE entity_id = ANY(${sql.param(entityIds)})
        GROUP BY entity_id
      ) c
      WHERE e.id = c.entity_id
    `);
  }

  // Score immediately. Left to be computed lazily by the trust API, the column
  // stayed NULL for anything nobody had opened — and a lens filtering on
  // `confidence_score >= n` then returned ZERO entities, because NULL fails
  // every comparison. A filter that silently answers "nothing" is worse than
  // one that errors.
  try {
    const { refreshConfidence } = await import('./trust-refresh');
    await refreshConfidence([...new Set(resolvedEntities.values())]);
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
          weight: aged(observations, upgrade ? 'high' : rel.confidence),
          strength: strengthBucket(aged(observations, rel.confidence)),
          lastSeenAt: observedAt,
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
      weight: aged(1, rel.confidence),
      strength: strengthBucket(aged(1, rel.confidence)),
      lastSeenAt: observedAt,
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
  updateEntitySummaries(entityIds).catch((err) => {
    console.error('[intel] Summary update failed:', err);
  });

  return { entityCount: new Set(resolvedEntities.values()).size, relationshipCount, timelineEventCount };
}
