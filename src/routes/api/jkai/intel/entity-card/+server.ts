// Everything needed to render an entity hover card, in one request.
//
// Two modes:
//   GET ?id=…      one entity, with its neighbours, notes and timeline
//   GET ?mentions=1 the lightweight name index the chat linkifier needs
//
// The mentions index is deliberately separate and tiny: the chat page fetches
// it once per session and matches locally, rather than asking the server about
// every reply.
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  intelEntities,
  intelEntityTypes,
  intelNotes,
  intelNoteEntities,
  intelTimelineEvents,
} from '$lib/db/schema';
import { getGraphAnalysis } from '$lib/jkai/intel/analytics/load';
import { brokerageScore } from '$lib/jkai/intel/analytics/centrality';
import { entityRelevance } from '$lib/jkai/intel/staleness';
import { UNASSESSED_SCORE } from '$lib/jkai/intel/trust';
import { acronymsOf } from '$lib/jkai/intel/resolve/match';
import { observedAtSql, sourceHref } from '$lib/jkai/intel/provenance';

/** Cap on names shipped to the client for mention matching. */
const MAX_MENTIONS = 1200;

/**
 * Newest first, by when the evidence was OBSERVED rather than ingested.
 *
 * `observedAt` is null for a note that produced no edges, and for the appended
 * first-seen row; those fall back to `createdAt` rather than sinking to the
 * bottom, because "we do not know when this was observed" is not the same claim
 * as "this is the oldest thing here".
 */
function sortByRecency<T extends { observedAt?: Date | string | null; createdAt: Date | string }>(
  rows: T[],
): T[] {
  const at = (r: T) => new Date(r.observedAt ?? r.createdAt).getTime() || 0;
  return [...rows].sort((a, b) => at(b) - at(a));
}

export const GET: RequestHandler = async ({ url }) => {
  if (url.searchParams.get('mentions')) return mentionsIndex();

  const id = url.searchParams.get('id');
  if (!id) throw error(400, 'id is required');

  const [row] = await db
    .select({
      id: intelEntities.id,
      name: intelEntities.name,
      summary: intelEntities.summary,
      properties: intelEntities.properties,
      confidence: intelEntities.confidence,
      confirmed: intelEntities.confirmed,
      watched: intelEntities.watched,
      confidenceScore: intelEntities.confidenceScore,
      createdAt: intelEntities.createdAt,
      updatedAt: intelEntities.updatedAt,
      firstSeenIn: intelEntities.firstSeenIn,
      typeId: intelEntityTypes.id,
      typeName: intelEntityTypes.name,
      typeIcon: intelEntityTypes.icon,
      typeColor: intelEntityTypes.color,
    })
    .from(intelEntities)
    .innerJoin(intelEntityTypes, eq(intelEntities.typeId, intelEntityTypes.id))
    .where(eq(intelEntities.id, id))
    .limit(1);

  if (!row) throw error(404, 'entity not found');

  const analysis = await getGraphAnalysis();
  const { index, centrality, community } = analysis;

  const neighbourIds = [...(index.neighbours.get(id) ?? [])];
  const neighbours = neighbourIds
    .map((nid) => {
      const n = index.byId.get(nid);
      if (!n) return null;
      const edge = analysis.snapshot.edges.find(
        (e) =>
          (e.source === id && e.target === nid) || (e.target === id && e.source === nid),
      );
      return {
        id: n.id,
        name: n.name,
        type: n.typeName,
        icon: n.icon,
        color: n.color,
        degree: index.degree.get(nid) ?? 0,
        relationship: edge?.label ?? edge?.type ?? 'related to',
        // A neighbour in a different cluster is the more interesting link.
        crossCommunity: community.membership.get(id) !== community.membership.get(nid),
      };
    })
    .filter((n): n is NonNullable<typeof n> => Boolean(n))
    .sort((a, b) => b.degree - a.degree)
    .slice(0, 14);

  const notes = await db
    .select({
      id: intelNotes.id,
      title: intelNotes.title,
      source: intelNotes.source,
      createdAt: intelNotes.createdAt,
      relevance: intelNoteEntities.relevance,
      excerpt: intelNoteEntities.excerpt,
      metadata: intelNotes.metadata,
      // When the thing in this note was actually OBSERVED, as opposed to when
      // the row was written — see `observedAtSql`. Null where a note has
      // neither an observed time nor an edge to carry one.
      observedAt: observedAtSql(intelNotes.observedAt, intelNotes.id).as('observed_at'),
    })
    .from(intelNoteEntities)
    .innerJoin(intelNotes, eq(intelNoteEntities.noteId, intelNotes.id))
    .where(eq(intelNoteEntities.entityId, id))
    // By the OBSERVATION clock, falling back to ingest where nothing carries
    // one. Ordering by `created_at` — as this did — sorts by the night the sweep
    // ran, so the ten most recent pieces of evidence for any email-heavy entity
    // were "the ten from the last sweep" in arbitrary order, and a thread from
    // March outranked one from last week if March happened to be swept later.
    .orderBy(sql`COALESCE(${observedAtSql(intelNotes.observedAt, intelNotes.id)}, ${intelNotes.createdAt}) DESC`)
    .limit(10);

  // Evidence per month across ALL of this entity's notes, not the ten fetched
  // for display — the sparkline is meant to show the shape of the whole record.
  // Dated by observation where anything carries one, ingest otherwise.
  const histogramRows = await db.execute(sql`
    SELECT to_char(
             date_trunc('month', COALESCE(${observedAtSql(sql`n.observed_at`, sql`n.id`)}, n.created_at)),
             'YYYY-MM'
           ) AS month,
           count(*)::int AS count
    FROM intel_note_entities ne
    JOIN intel_notes n ON n.id = ne.note_id
    WHERE ne.entity_id = ${id}
    GROUP BY 1 ORDER BY 1
  `);

  // The note this entity was first extracted from, fetched only when it is not
  // already among the linked notes above.
  //
  // 561 of 4,737 entities on 2026-08-05 have no intel_note_entities row at all —
  // typically extracted from a deep dive or a chat thread — so before this their
  // card showed no evidence and no way back to where they came from, even though
  // `first_seen_in` recorded it the whole time.
  const firstSeenId = row.firstSeenIn;
  const firstSeen =
    firstSeenId && !notes.some((n) => n.id === firstSeenId)
      ? (
          await db
            .select({
              id: intelNotes.id,
              title: intelNotes.title,
              source: intelNotes.source,
              createdAt: intelNotes.createdAt,
              metadata: intelNotes.metadata,
            })
            .from(intelNotes)
            .where(eq(intelNotes.id, firstSeenId))
            .limit(1)
        )[0] ?? null
      : null;

  const timeline = await db
    .select({
      id: intelTimelineEvents.id,
      date: intelTimelineEvents.date,
      dateEnd: intelTimelineEvents.dateEnd,
      type: intelTimelineEvents.type,
      title: intelTimelineEvents.title,
      description: intelTimelineEvents.description,
    })
    .from(intelTimelineEvents)
    .where(eq(intelTimelineEvents.entityId, id))
    .orderBy(desc(intelTimelineEvents.date))
    .limit(8);

  // Counted separately: the `notes` query above is capped at 10 for display, so
  // using its length would report a hard ceiling of 10 sources for an entity
  // that might appear in fifty.
  const [{ total: noteTotal } = { total: 0 }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(intelNoteEntities)
    .where(eq(intelNoteEntities.entityId, id));

  const maxPagerank = Math.max(1e-9, ...[...centrality.pagerank.values()]);

  const node = index.byId.get(id);
  const relevance = entityRelevance({
    confidence: row.confidenceScore ?? UNASSESSED_SCORE,
    evidenceAt: node?.evidenceAt ?? null,
  });

  return json({
    entity: {
      id: row.id,
      name: row.name,
      summary: row.summary,
      properties: row.properties ?? {},
      confidence: row.confidence,
      confirmed: row.confirmed,
      watched: row.watched,
      type: {
        id: row.typeId,
        name: row.typeName,
        icon: row.typeIcon,
        color: row.typeColor,
      },
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      // The numeric confidence every other surface already reads — lenses,
      // briefs and the watchlist all use `confidence_score`. The three-value
      // `confidence` text column has no numeric mapping anywhere in the codebase
      // and inventing one here would be a second, disagreeing definition.
      confidenceScore: row.confidenceScore,
    },
    metrics: {
      degree: index.degree.get(id) ?? 0,
      importance: (centrality.pagerank.get(id) ?? 0) / maxPagerank,
      betweenness: centrality.betweenness.get(id) ?? 0,
      brokerage: brokerageScore(id, centrality, index),
      community: community.membership.get(id) ?? null,
      noteCount: noteTotal,
      // The single age anchor for this card. Three different ones disagreed
      // before: the card read notes[0].createdAt, /trust read
      // lastCorroboratedAt, and trust-refresh read something else again.
      evidenceAt: node?.evidenceAt ? new Date(node.evidenceAt).toISOString() : null,
      relevance,
    },
    histogram: (histogramRows.rows as Array<Record<string, unknown>>).map((r) => ({
      month: String(r.month),
      count: Number(r.count ?? 0),
    })),
    neighbours,
    // Newest evidence first, by the observation clock. Sorted AFTER the
    // first-seen row is merged in: that row is appended rather than selected, so
    // leaving the SQL order alone put a two-year-old extraction at the bottom
    // and everything else in date order — a list that is sorted except for the
    // one row you would most want dated correctly.
    notes: sortByRecency([
      ...notes.map((n) => ({
        id: n.id,
        title: n.title ?? 'Untitled',
        source: n.source,
        createdAt: n.createdAt,
        relevance: n.relevance,
        excerpt: n.excerpt,
        observedAt: n.observedAt ?? null,
        href: sourceHref(n.id, n.metadata),
        firstSeen: n.id === firstSeenId,
      })),
      // Appended, so an entity whose only provenance is where it was extracted
      // still has one row to click through.
      ...(firstSeen
        ? [
            {
              id: firstSeen.id,
              title: firstSeen.title ?? 'Untitled',
              source: firstSeen.source,
              createdAt: firstSeen.createdAt,
              relevance: null,
              excerpt: null,
              observedAt: null,
              href: sourceHref(firstSeen.id, firstSeen.metadata),
              firstSeen: true,
            },
          ]
        : []),
    ]),
    timeline,
  });
};

/**
 * The name index the chat linkifier matches against.
 *
 * Only entities that are actually connected to something are included: an
 * orphan entity is usually an extraction artefact, and linkifying it in chat
 * would offer a card with nothing in it.
 */
async function mentionsIndex() {
  const rows = await db
    .select({
      id: intelEntities.id,
      name: intelEntities.name,
      typeName: intelEntityTypes.name,
      degree: sql<number>`(
        SELECT count(*) FROM intel_relationships r
        WHERE r.source_entity_id = intel_entities.id OR r.target_entity_id = intel_entities.id
      )::int`.as('degree'),
    })
    .from(intelEntities)
    .innerJoin(intelEntityTypes, eq(intelEntities.typeId, intelEntityTypes.id))
    .where(and(isNull(intelEntities.mergedIntoId), eq(intelEntities.confirmed, true)))
    .orderBy(desc(sql`degree`))
    .limit(MAX_MENTIONS);

  return json({
    mentions: rows
      .filter((r) => r.degree > 0)
      .map((r) => ({
        id: r.id,
        name: r.name,
        typeName: r.typeName,
        // An expansion like "Department for Education (DfE)" should also match
        // the bare acronym when the model writes it that way.
        aliases: [...acronymsOf(r.name)]
          .map((a) => a.toUpperCase())
          .filter((a) => a.length >= 3 && a.length <= 8),
      })),
  });
}
