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
import { acronymsOf } from '$lib/jkai/intel/resolve/match';

/** Cap on names shipped to the client for mention matching. */
const MAX_MENTIONS = 1200;

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
      createdAt: intelEntities.createdAt,
      updatedAt: intelEntities.updatedAt,
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
    })
    .from(intelNoteEntities)
    .innerJoin(intelNotes, eq(intelNoteEntities.noteId, intelNotes.id))
    .where(eq(intelNoteEntities.entityId, id))
    .orderBy(desc(intelNotes.createdAt))
    .limit(10);

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

  const maxPagerank = Math.max(1e-9, ...[...centrality.pagerank.values()]);

  return json({
    entity: {
      id: row.id,
      name: row.name,
      summary: row.summary,
      properties: row.properties ?? {},
      confidence: row.confidence,
      confirmed: row.confirmed,
      type: {
        id: row.typeId,
        name: row.typeName,
        icon: row.typeIcon,
        color: row.typeColor,
      },
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
    metrics: {
      degree: index.degree.get(id) ?? 0,
      importance: (centrality.pagerank.get(id) ?? 0) / maxPagerank,
      betweenness: centrality.betweenness.get(id) ?? 0,
      brokerage: brokerageScore(id, centrality, index),
      community: community.membership.get(id) ?? null,
      noteCount: notes.length,
    },
    neighbours,
    notes: notes.map((n) => ({
      id: n.id,
      title: n.title ?? 'Untitled',
      source: n.source,
      createdAt: n.createdAt,
      relevance: n.relevance,
      excerpt: n.excerpt,
      // Derived notes point back at the thing they came from.
      href:
        (n.metadata as Record<string, unknown> | null)?.sourceUrl != null
          ? String((n.metadata as Record<string, unknown>).sourceUrl)
          : `/jkai/intel/notes/${n.id}`,
    })),
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
