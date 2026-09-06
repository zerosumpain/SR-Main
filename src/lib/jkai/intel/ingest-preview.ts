// Dry-run ingest — what WOULD change if this text were extracted.
//
// Every other path into the graph is fire-and-forget: you paste a note, an
// extraction happens somewhere behind it, and the first time you find out what
// it decided is when a wrong entity is already sitting in the graph with edges
// hanging off it. Undoing that costs a merge, a suppression and a retype.
//
// This module answers the question BEFORE the write: which extracted items are
// genuinely new, which bind onto something the graph already knows, and which
// actively disagree with it — a type that contradicts the existing entity's, an
// edge that was deliberately suppressed, a type proposal that duplicates one
// already pending.
//
// OPT-IN ONLY. Nothing calls this on the normal ingest path: it costs the same
// model call as a real extraction and produces nothing durable, so making it
// the default would double the bill of every note for a diff nobody asked for.
//
// `diffAgainstGraph` is PURE — the graph is reached only through the injected
// `GraphLookup`, so the classification rules are unit-tested without a database
// and can never drift from what the API route reports.
import type { ExtractedEntity, ExtractionResult } from './extract';
import { pgTextArray } from '$lib/db/sql-array';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * - `new`      nothing in the graph corresponds to this; it would be created
 * - `existing` it binds onto something already there (corroboration, not news)
 * - `conflict` it contradicts what is there — the only status worth reading
 *              carefully, because applying it changes an existing belief
 */
export type DiffStatus = 'new' | 'existing' | 'conflict';

export interface GraphEntityRef {
  id: string;
  name: string;
  typeName: string;
}

export interface GraphEdgeRef {
  id: string;
  type: string;
  label?: string | null;
  manual?: boolean;
  suppressed?: boolean;
  suppressedReason?: string | null;
}

export interface GraphTypeRef {
  name: string;
  /** 'active' | 'proposed' | 'retired' */
  status: string;
}

/**
 * The graph, as far as the diff is concerned. Every method is a pure lookup so
 * a test can supply a Map and the route can supply Postgres.
 */
export interface GraphLookup {
  resolveEntity?(entity: ExtractedEntity): { outcome: 'link' | 'new' | 'unresolved'; entity: GraphEntityRef | null; reason: string };
  /** Live entity matching this name (or one of its aliases), or null. */
  findEntity(name: string): GraphEntityRef | null;
  /** Live entity by id — used to check the extractor's own `possibleMatchId`. */
  findEntityById(id: string): GraphEntityRef | null;
  findRelationship(sourceId: string, targetId: string, type: string): GraphEdgeRef | null;
  findType(name: string): GraphTypeRef | null;
  /** Optional: an identical timeline event already recorded. */
  findTimelineEvent?(date: string, title: string): { id: string } | null;
}

export interface EntityDiff {
  name: string;
  type: string;
  confidence: string;
  status: DiffStatus;
  matchedId: string | null;
  matchedName: string | null;
  matchedType: string | null;
  reason: string;
}

export interface RelationshipDiff {
  source: string;
  target: string;
  type: string;
  label: string;
  status: DiffStatus;
  /** False when persistExtraction would silently drop or refuse this edge. */
  willApply: boolean;
  reason: string;
}

export interface TimelineDiff {
  date: string;
  title: string;
  type: string;
  linkedEntity: string | null;
  status: DiffStatus;
  reason: string;
}

export interface TypeDiff {
  name: string;
  status: DiffStatus;
  willApply: boolean;
  reason: string;
}

export interface DiffTotals {
  newEntities: number;
  existingEntities: number;
  newRelationships: number;
  existingRelationships: number;
  newTimelineEvents: number;
  newTypes: number;
  conflicts: number;
  /** Items the extractor produced that would not survive persistence. */
  dropped: number;
}

export interface GraphDiff {
  summary: string;
  entities: EntityDiff[];
  relationships: RelationshipDiff[];
  timelineEvents: TimelineDiff[];
  proposedTypes: TypeDiff[];
  totals: DiffTotals;
}

/**
 * Mirrors MAX_NEW_TYPES_PER_EXTRACTION in ./graph.ts, which is module-private.
 * Duplicated deliberately so the preview reports the SAME cap the writer
 * enforces; if that constant moves, this one has to move with it.
 */
export const MAX_NEW_TYPES_PER_EXTRACTION = 2;

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

function diffEntities(extraction: ExtractionResult, lookup: GraphLookup): EntityDiff[] {
  const out: EntityDiff[] = [];
  const seenNames = new Map<string, string>(); // lowercased name → type claimed first

  for (const entity of extraction.entities ?? []) {
    const name = (entity.name ?? '').trim();
    const type = (entity.type ?? '').trim();
    const base = {
      name,
      type,
      confidence: entity.confidence ?? 'medium',
      matchedId: null as string | null,
      matchedName: null as string | null,
      matchedType: null as string | null,
    };

    if (!name) {
      out.push({ ...base, status: 'conflict', reason: 'The extractor returned an entity with no name; it would be dropped.' });
      continue;
    }

    // The extraction naming the same thing twice is not two entities —
    // persistExtraction keys its id map by name, so the second one silently
    // overwrites the first. Worth surfacing when the two disagree on type.
    const key = name.toLowerCase();
    const claimedBefore = seenNames.get(key);
    if (claimedBefore !== undefined) {
      const clash = !sameText(claimedBefore, type);
      out.push({
        ...base,
        status: clash ? 'conflict' : 'existing',
        reason: clash
          ? `This extraction names "${name}" twice, as ${claimedBefore} and as ${type} — only one typing survives.`
          : `Named more than once in this extraction; the duplicate collapses into one entity.`,
      });
      continue;
    }
    seenNames.set(key, type);

    if (lookup.resolveEntity) {
      const resolution = lookup.resolveEntity(entity);
      out.push({ ...base, status: resolution.outcome === 'link' ? 'existing' : resolution.outcome === 'unresolved' ? 'conflict' : 'new',
        matchedId: resolution.entity?.id ?? null, matchedName: resolution.entity?.name ?? null, matchedType: resolution.entity?.typeName ?? null, reason: resolution.reason });
      continue;
    }
    // Legacy in-memory lookup adapters; production supplies the shared resolver above.
    // The extractor's own claim first — it saw the candidate list.
    const claimed = entity.possibleMatchId ? lookup.findEntityById(entity.possibleMatchId) : null;
    const match = claimed ?? lookup.findEntity(name);

    if (!match) {
      out.push({
        ...base,
        status: 'new',
        reason: entity.possibleMatchId
          ? 'The extractor proposed a match that no longer exists; this would be created as a new entity.'
          : 'No entity of this name is in the graph; it would be created.',
      });
      continue;
    }

    const matched = { matchedId: match.id, matchedName: match.name, matchedType: match.typeName };

    if (!sameText(match.typeName, type)) {
      out.push({
        ...base,
        ...matched,
        status: 'conflict',
        // Type disagreement does NOT fork the node (see upsertEntity in
        // ./graph.ts) — the existing type wins. Saying so is the point.
        reason: `Matches "${match.name}", which the graph types as ${match.typeName}, not ${type}. The existing type is kept.`,
      });
      continue;
    }

    out.push({
      ...base,
      ...matched,
      status: 'existing',
      reason:
        claimed && !sameText(match.name, name)
          ? `Binds onto the existing "${match.name}" under a different surface form.`
          : 'Already in the graph; this would corroborate it rather than add anything.',
    });
  }

  return out;
}

function diffRelationships(
  extraction: ExtractionResult,
  lookup: GraphLookup,
  entityDiffs: EntityDiff[],
): RelationshipDiff[] {
  // persistExtraction resolves relationship endpoints through the entity map it
  // just built, keyed by the EXTRACTED name — so an edge naming anything that
  // is not in `entities` is dropped without comment. That silent loss is one of
  // the things a preview exists to show.
  const byName = new Map<string, EntityDiff>();
  for (const [index,e] of entityDiffs.entries()) {
    if (e.name) byName.set(e.name.toLowerCase(),e);
    const id=extraction.entities[index]?.mentionId;if(id)byName.set(id.toLowerCase(),e);
  }

  const out: RelationshipDiff[] = [];
  const seen = new Set<string>();

  for (const rel of extraction.relationships ?? []) {
    const source = (rel.source ?? '').trim();
    const target = (rel.target ?? '').trim();
    const type = (rel.type ?? '').trim();
    const base = { source, target, type, label: rel.label ?? '' };

    const from = byName.get(source.toLowerCase());
    const to = byName.get(target.toLowerCase());

    if (!from || !to) {
      const missing = [!from ? source || '(unnamed)' : null, !to ? target || '(unnamed)' : null]
        .filter(Boolean)
        .join(' and ');
      out.push({
        ...base,
        status: 'new',
        willApply: false,
        reason: `${missing} is not among the extracted entities, so this edge would be dropped.`,
      });
      continue;
    }

    if ((from.status === 'conflict' && !from.matchedId) || (to.status === 'conflict' && !to.matchedId)) {
      out.push({ ...base, status: 'conflict', willApply: false, reason: 'An endpoint identity is unresolved; the saved extraction can be replayed after review.' }); continue;
    }

    if (sameText(source, target) || (from.matchedId && from.matchedId === to.matchedId)) {
      out.push({ ...base, status: 'new', willApply: false, reason: 'Self-loop — dropped; it carries no information.' });
      continue;
    }

    const key = `${source.toLowerCase()}|${target.toLowerCase()}|${type.toLowerCase()}`;
    if (seen.has(key)) {
      out.push({ ...base, status: 'existing', willApply: false, reason: 'Duplicated within this extraction.' });
      continue;
    }
    seen.add(key);

    // Both endpoints must already exist before the graph can hold the edge.
    const existing =
      from.matchedId && to.matchedId ? lookup.findRelationship(from.matchedId, to.matchedId, type) : null;

    if (!existing) {
      out.push({ ...base, status: 'new', willApply: true, reason: 'A new edge between these two.' });
      continue;
    }

    if (existing.suppressed) {
      out.push({
        ...base,
        status: 'conflict',
        // Suppression is a deliberate correction. persistExtraction refuses to
        // resurrect it, so the preview must not imply the edge would return.
        willApply: false,
        reason: existing.suppressedReason
          ? `This edge was suppressed ("${existing.suppressedReason}") and will not be re-created.`
          : 'This edge was suppressed deliberately and will not be re-created.',
      });
      continue;
    }

    if (existing.manual && rel.label && !sameText(existing.label ?? '', rel.label)) {
      out.push({
        ...base,
        status: 'existing',
        willApply: true,
        reason: `Already recorded manually as "${existing.label}" — that label is kept; only the observation count rises.`,
      });
      continue;
    }

    out.push({
      ...base,
      status: 'existing',
      willApply: true,
      reason: 'Already in the graph; this observation would strengthen it.',
    });
  }

  return out;
}

function diffTimeline(extraction: ExtractionResult, lookup: GraphLookup): TimelineDiff[] {
  return (extraction.timelineEvents ?? []).map((event) => {
    const date = (event.date ?? '').trim();
    const title = (event.title ?? '').trim();
    const base = {
      date,
      title,
      type: event.type ?? 'event',
      linkedEntity: event.linkedEntity ?? null,
    };

    if (!date || !title) {
      return { ...base, status: 'conflict' as DiffStatus, reason: 'Missing a date or a title; it would be dropped.' };
    }

    const existing = lookup.findTimelineEvent?.(date, title) ?? null;
    return existing
      ? { ...base, status: 'existing' as DiffStatus, reason: 'An event with this date and title is already on the timeline.' }
      : { ...base, status: 'new' as DiffStatus, reason: 'A new timeline event.' };
  });
}

function diffTypes(extraction: ExtractionResult, lookup: GraphLookup): TypeDiff[] {
  const out: TypeDiff[] = [];
  let wouldCreate = 0;

  for (const proposed of extraction.proposedNewTypes ?? []) {
    const name = (proposed.name ?? '').trim();
    if (!name) {
      out.push({ name, status: 'conflict', willApply: false, reason: 'Unnamed type proposal; ignored.' });
      continue;
    }

    const existing = lookup.findType(name);
    if (existing?.status === 'active') {
      out.push({ name, status: 'existing', willApply: false, reason: `"${existing.name}" already exists as an active type.` });
      continue;
    }
    if (existing?.status === 'proposed') {
      out.push({ name, status: 'existing', willApply: false, reason: `"${existing.name}" is already awaiting review.` });
      continue;
    }
    if (existing) {
      out.push({
        name,
        status: 'conflict',
        willApply: false,
        reason: `"${existing.name}" was retired; re-proposing it would reopen a decision already taken.`,
      });
      continue;
    }

    // The writer caps new types per extraction, so a preview that promised more
    // would be lying about the outcome.
    if (wouldCreate >= MAX_NEW_TYPES_PER_EXTRACTION) {
      out.push({
        name,
        status: 'new',
        willApply: false,
        reason: `Beyond the ${MAX_NEW_TYPES_PER_EXTRACTION}-per-extraction proposal cap; it would be ignored.`,
      });
      continue;
    }
    wouldCreate++;
    out.push({ name, status: 'new', willApply: true, reason: 'Would be held for review, not admitted to the taxonomy.' });
  }

  return out;
}

/**
 * Classify every item an extraction produced against the current graph.
 *
 * Pure: the only contact with the graph is through `lookup`.
 */
export function diffAgainstGraph(extraction: ExtractionResult, lookup: GraphLookup): GraphDiff {
  const entities = diffEntities(extraction, lookup);
  const relationships = diffRelationships(extraction, lookup, entities);
  const timelineEvents = diffTimeline(extraction, lookup);
  const proposedTypes = diffTypes(extraction, lookup);

  const totals: DiffTotals = {
    newEntities: entities.filter((e) => e.status === 'new').length,
    existingEntities: entities.filter((e) => e.status === 'existing').length,
    newRelationships: relationships.filter((r) => r.status === 'new' && r.willApply).length,
    existingRelationships: relationships.filter((r) => r.status === 'existing').length,
    newTimelineEvents: timelineEvents.filter((t) => t.status === 'new').length,
    newTypes: proposedTypes.filter((t) => t.status === 'new' && t.willApply).length,
    conflicts:
      entities.filter((e) => e.status === 'conflict').length +
      relationships.filter((r) => r.status === 'conflict').length +
      timelineEvents.filter((t) => t.status === 'conflict').length +
      proposedTypes.filter((t) => t.status === 'conflict').length,
    dropped:
      relationships.filter((r) => !r.willApply).length + proposedTypes.filter((t) => !t.willApply).length,
  };

  return {
    summary: extraction.summary ?? '',
    entities,
    relationships,
    timelineEvents,
    proposedTypes,
    totals,
  };
}

// ---------------------------------------------------------------------------
// Server side — build the lookup, run the extraction, never write
// ---------------------------------------------------------------------------

/** Same ceiling auto-extract uses, so a preview costs what the real run costs. */
export const MAX_PREVIEW_CHARS = 24_000;
/** Below this there is nothing worth a model call. */
export const MIN_PREVIEW_CHARS = 20;

export interface PreviewResult extends GraphDiff {
  format: string;
  chars: number;
  truncated: boolean;
}

/**
 * Build a `GraphLookup` backed by Postgres, scoped to the names the extraction
 * actually mentions.
 *
 * Scoped rather than loading the graph: a preview is a read-only convenience
 * and must not pull thousands of rows to answer a question about twelve names.
 * Aliases are searched too, because that is how the writer resolves names — a
 * preview that missed an alias would report a new entity the write would merge.
 */
async function buildGraphLookup(extraction: ExtractionResult, text: string): Promise<GraphLookup> {
  const { db } = await import('$lib/db');
  const { sql } = await import('drizzle-orm');
  const { normaliseTypeName } = await import('./graph');

  const names = [...new Set((extraction.entities ?? []).map((e) => (e.name ?? '').trim().toLowerCase()).filter(Boolean))];
  const ids = [...new Set((extraction.entities ?? []).map((e) => e.possibleMatchId).filter((v): v is string => Boolean(v)))];

  const { resolveMention } = await import('./resolve/ingestion.server');
  const { groundMention } = await import('./resolve/policy');
  const resolutions = new Map<ExtractedEntity, Awaited<ReturnType<typeof resolveMention>>>();
  for (const entity of extraction.entities) {
    const type = await db.execute(sql`SELECT id FROM intel_entity_types WHERE name=${entity.type} AND status='active' LIMIT 1`);
    const span = groundMention(text, entity.name, entity.mention);
    if (!span) { resolutions.set(entity, {outcome:'unresolved',entity:null,reason:'No verifiable mention in source',ranked:[]}); continue; }
    const properties = {...entity.properties};
    if (typeof properties.email === 'string' && !span.excerpt.toLowerCase().includes(properties.email.toLowerCase())) delete properties.email;
    resolutions.set(entity, await resolveMention({...entity,properties,mention:{text:span.surface,context:span.excerpt}}, String(type.rows[0]?.id ?? 'unrecognised-type')));
  }
  const byName = new Map<string, GraphEntityRef>();
  const byId = new Map<string, GraphEntityRef>();

  if (names.length || ids.length) {
    const { rows } = await db.execute(sql`
      SELECT e.id, e.name, coalesce(e.aliases, '[]'::jsonb) AS aliases, coalesce(t.name, '') AS type_name
      FROM intel_entities e
      LEFT JOIN intel_entity_types t ON t.id = e.type_id
      WHERE e.merged_into_id IS NULL
        AND (
          lower(e.name) = ANY(${pgTextArray(names)}::text[])
          OR e.id = ANY(${pgTextArray(ids)}::text[])
          OR EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(coalesce(e.aliases, '[]'::jsonb)) AS a(v)
            WHERE lower(a.v) = ANY(${pgTextArray(names)}::text[])
          )
        )
      LIMIT 500
    `);

    for (const raw of rows as Array<Record<string, unknown>>) {
      const ref: GraphEntityRef = {
        id: String(raw.id),
        name: String(raw.name),
        typeName: String(raw.type_name ?? ''),
      };
      byId.set(ref.id, ref);
      // First writer wins, so a canonical name is never shadowed by an alias
      // that happens to belong to a different entity.
      const keys = [ref.name.toLowerCase(), ...(Array.isArray(raw.aliases) ? (raw.aliases as unknown[]).map((a) => String(a).toLowerCase()) : [])];
      for (const k of keys) if (k && !byName.has(k)) byName.set(k, ref);
    }
  }

  const edges = new Map<string, GraphEdgeRef>();
  const entityIds = [...byId.keys()];
  if (entityIds.length > 1) {
    const { rows } = await db.execute(sql`
      SELECT id, source_entity_id, target_entity_id, type, label, manual, suppressed, suppressed_reason
      FROM intel_relationships
      WHERE source_entity_id = ANY(${pgTextArray(entityIds)}::text[])
        AND target_entity_id = ANY(${pgTextArray(entityIds)}::text[])
      LIMIT 2000
    `);
    for (const raw of rows as Array<Record<string, unknown>>) {
      const key = `${String(raw.source_entity_id)}|${String(raw.target_entity_id)}|${String(raw.type).toLowerCase()}`;
      edges.set(key, {
        id: String(raw.id),
        type: String(raw.type),
        label: raw.label === null || raw.label === undefined ? null : String(raw.label),
        manual: Boolean(raw.manual),
        suppressed: Boolean(raw.suppressed),
        suppressedReason: raw.suppressed_reason ? String(raw.suppressed_reason) : null,
      });
    }
  }

  // The type table is small enough to load whole, and normalising here means
  // "Data Source" / "data-sources" resolve exactly as the writer resolves them.
  const typesByKey = new Map<string, GraphTypeRef>();
  const { rows: typeRows } = await db.execute(sql`SELECT name, status FROM intel_entity_types`);
  for (const raw of typeRows as Array<Record<string, unknown>>) {
    const ref: GraphTypeRef = { name: String(raw.name), status: String(raw.status ?? 'active') };
    typesByKey.set(ref.name.toLowerCase(), ref);
    const key = normaliseTypeName(ref.name);
    if (!typesByKey.has(key)) typesByKey.set(key, ref);
  }

  const eventKeys = new Set<string>();
  const eventDates = [...new Set((extraction.timelineEvents ?? []).map((e) => (e.date ?? '').trim()).filter(Boolean))];
  const eventTitles = [...new Set((extraction.timelineEvents ?? []).map((e) => (e.title ?? '').trim()).filter(Boolean))];
  if (eventDates.length && eventTitles.length) {
    const { rows } = await db.execute(sql`
      SELECT date, title FROM intel_timeline_events
      WHERE date = ANY(${pgTextArray(eventDates)}::text[]) AND title = ANY(${pgTextArray(eventTitles)}::text[])
      LIMIT 500
    `);
    for (const raw of rows as Array<Record<string, unknown>>) {
      eventKeys.add(`${String(raw.date)}|${String(raw.title).toLowerCase()}`);
    }
  }

  return {
    resolveEntity: entity => resolutions.get(entity)!,
    findEntity: (name) => byName.get(name.trim().toLowerCase()) ?? null,
    findEntityById: (id) => byId.get(id) ?? null,
    findRelationship: (sourceId, targetId, type) =>
      edges.get(`${sourceId}|${targetId}|${type.trim().toLowerCase()}`) ?? null,
    findType: (name) =>
      typesByKey.get(name.trim().toLowerCase()) ?? typesByKey.get(normaliseTypeName(name)) ?? null,
    findTimelineEvent: (date, title) =>
      eventKeys.has(`${date}|${title.toLowerCase()}`) ? { id: `${date}|${title}` } : null,
  };
}

/**
 * Run extraction over `text` and report what it WOULD change. Writes nothing —
 * no note row, no entity, no embedding, no alert.
 */
export async function previewExtraction(text: string, format = 'text'): Promise<PreviewResult> {
  const trimmed = (text ?? '').trim();
  if (trimmed.length < MIN_PREVIEW_CHARS) {
    throw new Error(`text must be at least ${MIN_PREVIEW_CHARS} characters`);
  }

  const truncated = trimmed.length > MAX_PREVIEW_CHARS;
  const clipped = truncated ? trimmed.slice(0, MAX_PREVIEW_CHARS) : trimmed;

  const { extractFromNote } = await import('./extract');
  const extraction = await extractFromNote(clipped, format);
  const lookup = await buildGraphLookup(extraction, clipped);

  return {
    ...diffAgainstGraph(extraction, lookup),
    format,
    chars: clipped.length,
    truncated,
  };
}
