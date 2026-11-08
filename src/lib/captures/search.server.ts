// Search over the recorder's captures and the entities graphed from them.
//
// Scoped to the RECORDER'S SPACE ONLY — not the owner's usual
// `OWNER_INTEL_SCOPE`, which adds the household: a household note is not
// something the recorder said, and PLAN "Search" is explicit that the
// recorder's graph is theirs. Every query below takes that one-space scope
// through `spaceIn`, and every intel join also requires
// `metadata.autoKind = 'capture'`, because a refId is unique only within a
// (kind, space) pair (CONTRACT "Core notes").
//
// The join back to `capture` is on the note's `metadata.refId`, the BARE
// capture id Core stores verbatim. A remembered fact's note is filed as
// `<captureId>/remember/<actionId>`, so the joins take the part before the
// first `/` — one capture, however many notes it made.
//
// Read-only. SR-Jkai-Core owns the intel rows.

import { and, desc, eq, gte, inArray, lt, sql, type SQL } from 'drizzle-orm';
import { db } from '$lib/db';
import { capture, type Capture } from '$lib/db/schema';
import { pgTextArray } from '$lib/db/sql-array';
import { generateEmbedding } from '$lib/intel-client/embed';
import { spaceIn, type IntelScope } from '$lib/intel-client/scope';
import { openActionCounts } from './store.server';
import { toSummary } from './view';
import type { CaptureSummary } from './types';

export interface CaptureSearchQuery {
  q: string;
  person: string;
  app: string;
  place: string;
  from: string | null;
  to: string | null;
  limit: number;
}

export interface CaptureSearchResult {
  captures: Array<CaptureSummary & { score: number; snippet: string }>;
  entities: Array<{ id: string; name: string; type: string; captureCount: number }>;
}

/** The one space a recorder's search reads. Never widened to the household. */
export function recorderScope(spaceId: string): IntelScope {
  return Object.freeze([spaceId]);
}

const like = (s: string) => `%${s.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

/** `split_part(refId, '/', 1)`: the capture a note belongs to. */
const CAPTURE_OF_NOTE = sql`split_part(n.metadata->>'refId', '/', 1)`;

/** Capture notes nearest the query's embedding, in the scope. */
export function noteHitsQuery(scope: IntelScope, vector: string, limit: number): SQL {
  return sql`
    SELECT ${CAPTURE_OF_NOTE} AS capture_id, min(n.embedding <=> ${vector}::vector) AS distance
    FROM intel_notes n
    WHERE ${spaceIn(sql`n.space_id`, scope)}
      AND n.metadata->>'autoKind' = 'capture'
      AND n.graph_state = 'admitted'
      AND n.embedding IS NOT NULL
    GROUP BY 1
    ORDER BY 2 ASC
    LIMIT ${limit}`;
}

/** Captures whose notes name an entity matching `name`, in the scope. */
export function capturesNamingQuery(scope: IntelScope, name: string): SQL {
  return sql`
    SELECT DISTINCT ${CAPTURE_OF_NOTE} AS capture_id
    FROM intel_entities e
    JOIN intel_note_entities ne ON ne.entity_id = e.id
    JOIN intel_notes n ON n.id = ne.note_id
    WHERE ${spaceIn(sql`e.space_id`, scope)}
      AND ${spaceIn(sql`n.space_id`, scope)}
      AND n.metadata->>'autoKind' = 'capture'
      AND e.merged_into_id IS NULL
      AND (e.name ILIKE ${like(name)} OR e.aliases::text ILIKE ${like(name)})
    LIMIT 500`;
}

/** Entities graphed from captures, with how many captures mention each. */
export function captureEntitiesQuery(scope: IntelScope, q: string, limit: number, captureIds?: string[]): SQL {
  return sql`
    SELECT e.id, e.name, et.name AS type_name, count(DISTINCT ${CAPTURE_OF_NOTE})::int AS capture_count
    FROM intel_entities e
    JOIN intel_entity_types et ON et.id = e.type_id
    JOIN intel_note_entities ne ON ne.entity_id = e.id
    JOIN intel_notes n ON n.id = ne.note_id
    WHERE ${spaceIn(sql`e.space_id`, scope)}
      AND ${spaceIn(sql`n.space_id`, scope)}
      AND n.metadata->>'autoKind' = 'capture'
      AND e.merged_into_id IS NULL
      ${q ? sql`AND (e.name ILIKE ${like(q)} OR e.aliases::text ILIKE ${like(q)})` : sql``}
      ${captureIds ? sql`AND ${CAPTURE_OF_NOTE} = ANY(${pgTextArray(captureIds)}::text[])` : sql``}
    GROUP BY e.id, e.name, et.name
    ORDER BY capture_count DESC, e.name ASC
    LIMIT ${limit}`;
}

/** The capture-table filters, always starting with the space. */
export function captureFilters(spaceId: string, f: Omit<CaptureSearchQuery, 'q' | 'limit'>, namedIn: string[] | null): SQL[] {
  const where: SQL[] = [eq(capture.spaceId, spaceId)];
  if (f.from) where.push(gte(capture.startedAt, new Date(f.from)));
  if (f.to) where.push(lt(capture.startedAt, new Date(f.to)));
  if (f.app) {
    where.push(sql`(${capture.screen}->>'corrected' ILIKE ${like(f.app)} OR ${capture.screen}->'app'->>'name' ILIKE ${like(f.app)} OR ${capture.intake}->>'appHint' ILIKE ${like(f.app)})`);
  }
  if (f.place) where.push(sql`${capture.place}->>'name' ILIKE ${like(f.place)}`);
  if (f.person) {
    const bySpeaker = sql`${capture.speakers}::text ILIKE ${like(f.person)}`;
    where.push(namedIn && namedIn.length ? sql`(${bySpeaker} OR ${inArray(capture.id, namedIn)})` : bySpeaker);
  }
  return where;
}

function rowsOf(res: unknown): Array<Record<string, unknown>> {
  return ((res as { rows?: unknown[] })?.rows ?? []) as Array<Record<string, unknown>>;
}

export async function searchCaptures(spaceId: string, query: CaptureSearchQuery): Promise<CaptureSearchResult> {
  const scope = recorderScope(spaceId);
  const q = query.q.trim();

  // Captures that name the person in the graph, as well as by speaker.
  let namedIn: string[] | null = null;
  if (query.person) {
    namedIn = rowsOf(await db.execute(capturesNamingQuery(scope, query.person))).map((r) => String(r.capture_id));
  }

  // Semantic hits from the capture notes, when there is a query to embed.
  const vectorScore = new Map<string, number>();
  if (q) {
    let embedding: number[] | null = null;
    try {
      embedding = await generateEmbedding(q);
    } catch {
      embedding = null;
    }
    if (embedding) {
      const hits = rowsOf(await db.execute(noteHitsQuery(scope, `[${embedding.join(',')}]`, 50)));
      for (const h of hits) vectorScore.set(String(h.capture_id), Math.max(0, 1 - Number(h.distance ?? 1)));
    }
  }

  const where = captureFilters(spaceId, query, namedIn);
  let rows: Capture[];
  const textMatch = new Set<string>();
  if (q) {
    const text = sql`(${capture.title} ILIKE ${like(q)} OR ${capture.summary} ILIKE ${like(q)} OR ${capture.transcript} ILIKE ${like(q)} OR ${capture.speakers}::text ILIKE ${like(q)} OR ${capture.entities}::text ILIKE ${like(q)})`;
    const ids = [...vectorScore.keys()];
    const textRows = await db
      .select()
      .from(capture)
      .where(and(...where, text))
      .orderBy(desc(capture.startedAt))
      .limit(query.limit * 2);
    for (const r of textRows) textMatch.add(r.id);
    const vecRows = ids.length
      ? await db.select().from(capture).where(and(...where, inArray(capture.id, ids))).limit(ids.length)
      : [];
    const byId = new Map<string, Capture>();
    for (const r of [...textRows, ...vecRows]) byId.set(r.id, r);
    rows = [...byId.values()];
  } else {
    rows = await db.select().from(capture).where(and(...where)).orderBy(desc(capture.startedAt)).limit(query.limit);
  }

  const scored = rows
    .map((r) => {
      const v = vectorScore.get(r.id) ?? 0;
      // A literal match outranks a near one; recency breaks ties.
      const score = q ? (textMatch.has(r.id) ? 0.6 + 0.4 * v : v) : 1;
      return { r, score };
    })
    .sort((a, b) => b.score - a.score || b.r.startedAt.getTime() - a.r.startedAt.getTime())
    .slice(0, query.limit);

  const open = await openActionCounts(scored.map((s) => s.r.id));
  const captures = scored.map(({ r, score }) => ({ ...toSummary(r, open.get(r.id) ?? 0, q || undefined), score: Number(score.toFixed(3)) }));

  const filtered = !!(query.person || query.app || query.place || query.from || query.to);
  const entityRows = rowsOf(
    await db.execute(captureEntitiesQuery(scope, q, Math.min(query.limit, 30), filtered ? captures.map((c) => c.id) : undefined)),
  );
  const entities = entityRows.map((r) => ({
    id: String(r.id),
    name: String(r.name ?? ''),
    type: String(r.type_name ?? 'unknown'),
    captureCount: Number(r.capture_count ?? 0),
  }));

  return { captures, entities };
}

// ── The entity page ───────────────────────────────────────────────────────

export function entityQuery(scope: IntelScope, entityId: string): SQL {
  return sql`
    SELECT e.id, e.name, et.name AS type_name, e.summary
    FROM intel_entities e
    JOIN intel_entity_types et ON et.id = e.type_id
    WHERE e.id = ${entityId}
      AND ${spaceIn(sql`e.space_id`, scope)}
      AND e.merged_into_id IS NULL
    LIMIT 1`;
}

export function entityCapturesQuery(scope: IntelScope, entityId: string): SQL {
  return sql`
    SELECT DISTINCT ${CAPTURE_OF_NOTE} AS capture_id
    FROM intel_note_entities ne
    JOIN intel_notes n ON n.id = ne.note_id
    WHERE ne.entity_id = ${entityId}
      AND ${spaceIn(sql`n.space_id`, scope)}
      AND n.metadata->>'autoKind' = 'capture'
    LIMIT 200`;
}

export function neighboursQuery(scope: IntelScope, entityId: string, limit: number): SQL {
  return sql`
    SELECT o.id, o.name, et.name AS type_name, COALESCE(r.label, r.type) AS relation
    FROM intel_relationships r
    JOIN intel_entities o ON o.id = CASE WHEN r.source_entity_id = ${entityId} THEN r.target_entity_id ELSE r.source_entity_id END
    JOIN intel_entity_types et ON et.id = o.type_id
    WHERE (r.source_entity_id = ${entityId} OR r.target_entity_id = ${entityId})
      AND ${spaceIn(sql`r.space_id`, scope)}
      AND ${spaceIn(sql`o.space_id`, scope)}
      AND o.merged_into_id IS NULL
    ORDER BY r.created_at DESC
    LIMIT ${limit}`;
}

export interface EntityPage {
  entity: { id: string; name: string; type: string; summary?: string };
  captures: CaptureSummary[];
  neighbours: Array<{ id: string; name: string; type: string; relation: string }>;
}

export async function captureEntityPage(spaceId: string, entityId: string): Promise<EntityPage | null> {
  const scope = recorderScope(spaceId);
  const [e] = rowsOf(await db.execute(entityQuery(scope, entityId)));
  if (!e) return null;
  const ids = rowsOf(await db.execute(entityCapturesQuery(scope, entityId))).map((r) => String(r.capture_id));
  const rows = ids.length
    ? await db.select().from(capture).where(and(eq(capture.spaceId, spaceId), inArray(capture.id, ids))).orderBy(desc(capture.startedAt)).limit(100)
    : [];
  const open = await openActionCounts(rows.map((r) => r.id));
  const neighbours = rowsOf(await db.execute(neighboursQuery(scope, entityId, 40)));
  // One line per neighbour: the first (newest) relationship names it.
  const seen = new Set<string>();
  const out: EntityPage['neighbours'] = [];
  for (const n of neighbours) {
    const id = String(n.id);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: String(n.name ?? ''), type: String(n.type_name ?? 'unknown'), relation: String(n.relation ?? 'related to') });
  }
  return {
    entity: {
      id: String(e.id),
      name: String(e.name ?? ''),
      type: String(e.type_name ?? 'unknown'),
      ...(e.summary ? { summary: String(e.summary) } : {}),
    },
    captures: rows.map((r) => toSummary(r, open.get(r.id) ?? 0)),
    neighbours: out,
  };
}

/**
 * Resolve a confirmed speaker's name to a person entity in the recorder's
 * space — the "re-link" a confirmation asks for. Exact name or alias, case
 * folded; null when there is none or more than one (an ambiguous Sarah is not
 * linked to the wrong one).
 */
export async function findPersonEntity(spaceId: string, name: string): Promise<string | null> {
  const scope = recorderScope(spaceId);
  const res = await db.execute(sql`
    SELECT e.id
    FROM intel_entities e
    JOIN intel_entity_types et ON et.id = e.type_id
    WHERE ${spaceIn(sql`e.space_id`, scope)}
      AND e.merged_into_id IS NULL
      AND et.name = 'person'
      AND (lower(e.name) = lower(${name}) OR e.aliases @> ${JSON.stringify([name])}::jsonb)
    LIMIT 2`);
  const rows = rowsOf(res);
  return rows.length === 1 ? String(rows[0].id) : null;
}
