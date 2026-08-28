// SERVER-ONLY half of the entity index query.
//
// Split out because the pure half is imported by `entities/+page.svelte`, and a
// module reachable from a client component drags its WHOLE import graph into
// the browser bundle — including `$lib/db`, which reads `$env/dynamic/private`.
// That fails the production build with "Cannot import $env/dynamic/private into
// code that runs in the browser", and NOT `svelte-check` or the tests, so it
// only shows up at deploy time.
//
// `await import('$lib/db')` does not help: Rollup still analyses the graph. The
// `.server.ts` suffix is the actual guard — SvelteKit makes importing this from
// client code a build error, so the boundary cannot quietly regress.
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { intelEntities, intelEntityTypes, intelNotes } from '$lib/db/schema';
import { alias } from 'drizzle-orm/pg-core';
import { linksToItem, observedAtSql, sourceHref } from './provenance';
import {
  escapeLike,
  pageInfo,
  MAX_FACET_VALUES,
  type EntityQuery,
  type EntityRow,
  type EntityPage,
  type PageInfo,
  type SourceRef,
} from './entity-query';

function baseConditions(query: EntityQuery): SQL[] {
  const conditions: SQL[] = [isNull(intelEntities.mergedIntoId)];

  if (query.q) {
    const pattern = `%${escapeLike(query.q)}%`;
    conditions.push(
      or(ilike(intelEntities.name, pattern), ilike(intelEntities.summary, pattern)) as SQL,
    );
  }
  if (query.confidence.length) {
    conditions.push(inArray(intelEntities.confidence, query.confidence));
  }
  if (query.confirmed !== 'all') {
    conditions.push(eq(intelEntities.confirmed, query.confirmed === 'confirmed'));
  }
  if (query.watched !== 'all') {
    conditions.push(eq(intelEntities.watched, query.watched === 'watched'));
  }
  if (query.lens) {
    conditions.push(
      query.lens === 'none' ? isNull(intelEntities.lens) : eq(intelEntities.lens, query.lens),
    );
  }
  return conditions;
}

function allConditions(query: EntityQuery): SQL[] {
  const conditions = baseConditions(query);
  if (query.typeIds.length) conditions.push(inArray(intelEntities.typeId, query.typeIds));
  return conditions;
}

const NOTE_COUNT = sql<number>`(
  select count(*) from intel_note_entities
  where intel_note_entities.entity_id = intel_entities.id
)::int`;

const REL_COUNT = sql<number>`(
  select count(*) from intel_relationships
  where intel_relationships.source_entity_id = intel_entities.id
     or intel_relationships.target_entity_id = intel_entities.id
)::int`;

/** Aliased so both the first-seen note and the latest one can be selected. */
const firstSeenNote = alias(intelNotes, 'first_seen_note');

function rowSelection() {
  return {
    id: intelEntities.id,
    name: intelEntities.name,
    typeId: intelEntities.typeId,
    typeName: intelEntityTypes.name,
    typeIcon: intelEntityTypes.icon,
    typeColor: intelEntityTypes.color,
    summary: intelEntities.summary,
    confidence: intelEntities.confidence,
    confirmed: intelEntities.confirmed,
    watched: intelEntities.watched,
    lens: intelEntities.lens,
    corroboration: intelEntities.corroboration,
    confidenceScore: intelEntities.confidenceScore,
    sourceGrade: intelEntities.sourceGrade,
    createdAt: intelEntities.createdAt,
    updatedAt: intelEntities.updatedAt,
    noteCount: NOTE_COUNT.as('note_count'),
    relationshipCount: REL_COUNT.as('relationship_count'),
    // Provenance for the row's origin, joined rather than sub-selected: it is a
    // plain foreign key. The LATEST source needs the note-link table and is
    // fetched for the page's rows in one follow-up query instead — see
    // `attachProvenance`.
    firstSeenId: firstSeenNote.id,
    firstSeenTitle: firstSeenNote.title,
    firstSeenSource: firstSeenNote.source,
    firstSeenMetadata: firstSeenNote.metadata,
    firstSeenCreatedAt: firstSeenNote.createdAt,
    firstSeenObservedAt: observedAtSql(firstSeenNote.observedAt, firstSeenNote.id).as(
      'first_seen_observed_at',
    ),
  };
}

/** A selected note's columns as the `SourceRef` every surface renders. */
function toSourceRef(row: {
  id: string | null;
  title: string | null;
  source: string | null;
  metadata: unknown;
  createdAt: Date | string | null;
  observedAt: Date | string | null;
}): SourceRef | null {
  if (!row.id) return null;
  const href = sourceHref(row.id, row.metadata);
  return {
    noteId: row.id,
    title: row.title ?? 'Untitled',
    source: row.source ?? 'unknown',
    href,
    direct: linksToItem(href),
    at: new Date(row.observedAt ?? row.createdAt ?? 0),
    observed: row.observedAt != null,
  };
}

/**
 * Fold the joined first-seen columns into a `SourceRef`, then attach the latest
 * source and the count of everything since.
 *
 * Two follow-up queries over the page's ids rather than correlated subqueries in
 * `rowSelection()`: a page is at most 200 rows, and "the newest note asserting
 * this entity" needs `intel_note_entities`, which is a join the row query does
 * not otherwise make. Doing it per row would run the same DISTINCT ON 200 times.
 */
async function attachProvenance(
  db: (typeof import('$lib/db'))['db'],
  rows: Array<Record<string, unknown>>,
): Promise<EntityRow[]> {
  const ids = rows.map((r) => String(r.id));
  if (!ids.length) return [];

  const observed = observedAtSql(sql`n.observed_at`, sql`n.id`);
  const idList = sql.join(ids.map((i) => sql`${i}`), sql`, `);

  const [latestRes, countRes] = await Promise.all([
    // DISTINCT ON keeps one row per entity — the first after the ORDER BY, which
    // is why the ordering repeats the partition key.
    db.execute(sql`
      SELECT DISTINCT ON (ne.entity_id)
             ne.entity_id, n.id, n.title, n.source, n.metadata, n.created_at,
             ${observed} AS observed_at
      FROM intel_note_entities ne
      JOIN intel_notes n ON n.id = ne.note_id
      WHERE ne.entity_id IN (${idList})
      ORDER BY ne.entity_id, COALESCE(${observed}, n.created_at) DESC, n.id
    `),
    // Everything asserting the entity that is not where it came from. An entity
    // whose origin never produced a note link counts all of them, which is
    // correct: none of them is the origin.
    db.execute(sql`
      SELECT ne.entity_id, count(*)::int AS later
      FROM intel_note_entities ne
      JOIN intel_entities e ON e.id = ne.entity_id
      WHERE ne.entity_id IN (${idList})
        AND (e.first_seen_in IS NULL OR ne.note_id <> e.first_seen_in)
      GROUP BY 1
    `),
  ]);

  const latest = new Map<string, SourceRef>();
  for (const r of latestRes.rows as Array<Record<string, unknown>>) {
    const ref = toSourceRef({
      id: r.id == null ? null : String(r.id),
      title: r.title == null ? null : String(r.title),
      source: r.source == null ? null : String(r.source),
      metadata: r.metadata,
      createdAt: r.created_at as Date | string | null,
      observedAt: r.observed_at as Date | string | null,
    });
    if (ref) latest.set(String(r.entity_id), ref);
  }

  const laterCounts = new Map<string, number>();
  for (const r of countRes.rows as Array<Record<string, unknown>>) {
    laterCounts.set(String(r.entity_id), Number(r.later ?? 0));
  }

  return rows.map((r) => {
    const {
      firstSeenId,
      firstSeenTitle,
      firstSeenSource,
      firstSeenMetadata,
      firstSeenCreatedAt,
      firstSeenObservedAt,
      ...entity
    } = r;
    return {
      ...entity,
      firstSource: toSourceRef({
        id: firstSeenId == null ? null : String(firstSeenId),
        title: firstSeenTitle == null ? null : String(firstSeenTitle),
        source: firstSeenSource == null ? null : String(firstSeenSource),
        metadata: firstSeenMetadata,
        createdAt: firstSeenCreatedAt as Date | string | null,
        observedAt: firstSeenObservedAt as Date | string | null,
      }),
      latestSource: latest.get(String(r.id)) ?? null,
      laterSourceCount: laterCounts.get(String(r.id)) ?? 0,
    } as EntityRow;
  });
}

/** ORDER BY for everything except `importance`, which needs the graph. */
function orderFor(query: EntityQuery): SQL[] {
  const dir = query.dir === 'asc' ? asc : desc;
  switch (query.sort) {
    case 'name':
      return [dir(sql`lower(${intelEntities.name})`), asc(intelEntities.id)];
    case 'connections':
      // Ordering by the output alias, which Postgres resolves without
      // re-evaluating the correlated subquery.
      return [dir(sql`relationship_count`), asc(intelEntities.id)];
    case 'corroboration':
      return [dir(intelEntities.corroboration), dir(sql`relationship_count`), asc(intelEntities.id)];
    default:
      return [dir(intelEntities.updatedAt), asc(intelEntities.id)];
  }
}

/**
 * One page of entities plus the counts the facet UI needs.
 *
 * `importance` is the odd one out: PageRank is not a column, so that sort
 * borrows the cached analytics snapshot rather than reimplementing it, ranks
 * the matching ids in memory, and then fetches only the page's rows.
 */
export async function queryEntityPage(query: EntityQuery): Promise<EntityPage> {
  const { db } = await import('$lib/db');
  const conditions = allConditions(query);
  const where = and(...conditions);

  const [typeCountRows, lensRows] = await Promise.all([
    db
      .select({ typeId: intelEntities.typeId, count: sql<number>`count(*)::int` })
      .from(intelEntities)
      .where(and(...baseConditions(query)))
      .groupBy(intelEntities.typeId),
    db
      .selectDistinct({ lens: intelEntities.lens })
      .from(intelEntities)
      .where(isNull(intelEntities.mergedIntoId)),
  ]);

  const typeCounts: Record<string, number> = {};
  for (const row of typeCountRows) typeCounts[row.typeId] = row.count;
  const lensValues = lensRows
    .map((r) => r.lens)
    .filter((l): l is string => typeof l === 'string' && l.length > 0)
    .sort();

  if (query.sort === 'importance') {
    const ids = (
      await db.select({ id: intelEntities.id }).from(intelEntities).where(where)
    ).map((r) => r.id);

    const { getGraphAnalysis } = await import('./analytics/load');
    const analysis = await getGraphAnalysis();
    const rank = analysis.centrality.pagerank;
    const sign = query.dir === 'asc' ? -1 : 1;
    ids.sort((a, b) => sign * ((rank.get(b) ?? 0) - (rank.get(a) ?? 0)) || a.localeCompare(b));

    const info = pageInfo(ids.length, query);
    const pageIds = ids.slice(info.offset, info.offset + info.pageSize);
    if (!pageIds.length) return { entities: [], page: info, typeCounts, lensValues };

    const rows = await db
      .select(rowSelection())
      .from(intelEntities)
      .innerJoin(intelEntityTypes, eq(intelEntities.typeId, intelEntityTypes.id))
      .leftJoin(firstSeenNote, eq(firstSeenNote.id, intelEntities.firstSeenIn))
      .where(inArray(intelEntities.id, pageIds));

    const byId = new Map((await attachProvenance(db, rows)).map((r) => [r.id, r]));
    return {
      entities: pageIds.map((id) => byId.get(id)).filter((r): r is EntityRow => Boolean(r)),
      page: info,
      typeCounts,
      lensValues,
    };
  }

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(intelEntities)
    .where(where);

  const info = pageInfo(count, query);

  const rows = await db
    .select(rowSelection())
    .from(intelEntities)
    .innerJoin(intelEntityTypes, eq(intelEntities.typeId, intelEntityTypes.id))
    .leftJoin(firstSeenNote, eq(firstSeenNote.id, intelEntities.firstSeenIn))
    .where(where)
    .orderBy(...orderFor(query))
    .limit(info.pageSize)
    .offset(info.offset);

  const entities = await attachProvenance(db, rows);

  return { entities, page: info, typeCounts, lensValues };
}
