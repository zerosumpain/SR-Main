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
import { intelEntities, intelEntityTypes } from '$lib/db/schema';
import {
  escapeLike,
  pageInfo,
  MAX_FACET_VALUES,
  type EntityQuery,
  type EntityRow,
  type EntityPage,
  type PageInfo,
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
  };
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
      .where(inArray(intelEntities.id, pageIds));

    const byId = new Map(rows.map((r) => [r.id, r as EntityRow]));
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

  const entities = (await db
    .select(rowSelection())
    .from(intelEntities)
    .innerJoin(intelEntityTypes, eq(intelEntities.typeId, intelEntityTypes.id))
    .where(where)
    .orderBy(...orderFor(query))
    .limit(info.pageSize)
    .offset(info.offset)) as EntityRow[];

  return { entities, page: info, typeCounts, lensValues };
}
