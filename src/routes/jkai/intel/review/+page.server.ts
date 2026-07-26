// The triage queue.
//
// The old load returned a name, a type and a confidence word — which is not
// enough to decide anything, so the page was a list of coin flips. Everything
// here exists to make one keystroke defensible: the evidence the entity was
// extracted from, what it is already connected to, and how much of the graph
// depends on the answer.
import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import {
  intelEntities,
  intelEntityTypes,
  intelNoteEntities,
  intelNotes,
  intelRelationships,
} from '$lib/db/schema';
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { listAlerts, listEntityTypes } from '$lib/jkai/intel/queries';

/** Bounded so one enormous backlog cannot turn the page into a 20 MB payload. */
const QUEUE_LIMIT = 250;
const EXCERPTS_PER_ENTITY = 3;
const NEIGHBOURS_PER_ENTITY = 6;
const NEIGHBOUR_ROW_CAP = 3000;

export type TriageOrder = 'impact' | 'recent' | 'weakest';
const ORDERS: TriageOrder[] = ['impact', 'recent', 'weakest'];

export interface TriageEvidence {
  noteId: string;
  noteTitle: string | null;
  noteSource: string;
  relevance: string;
  excerpt: string | null;
  createdAt: Date;
}

export interface TriageNeighbour {
  id: string;
  name: string;
  icon: string;
  type: string;
  label: string;
}

export const load: PageServerLoad = async ({ url }) => {
  const orderParam = url.searchParams.get('order');
  const order: TriageOrder = ORDERS.includes(orderParam as TriageOrder)
    ? (orderParam as TriageOrder)
    : 'impact';

  const relCount = sql<number>`(
    select count(*) from intel_relationships
    where intel_relationships.source_entity_id = intel_entities.id
       or intel_relationships.target_entity_id = intel_entities.id
  )::int`;
  const noteCount = sql<number>`(
    select count(*) from intel_note_entities
    where intel_note_entities.entity_id = intel_entities.id
  )::int`;

  // `confidence` is a text column, so ordering by it directly is alphabetical —
  // 'high' before 'low' before 'medium', which is meaningless. Rank explicitly.
  const confidenceRank = sql`case ${intelEntities.confidence}
    when 'low' then 0 when 'medium' then 1 when 'high' then 2 else 1 end`;

  const orderBy =
    order === 'recent'
      ? [desc(intelEntities.createdAt)]
      : order === 'weakest'
        ? [sql`${confidenceRank} asc`, sql`relationship_count asc`, desc(intelEntities.createdAt)]
        : // impact: a decision about a hub changes more of the graph than a
          // decision about a leaf, so those come first.
          [sql`relationship_count desc`, desc(intelEntities.corroboration), desc(intelEntities.createdAt)];

  const [rows, [{ total }], types, alerts] = await Promise.all([
    db
      .select({
        id: intelEntities.id,
        name: intelEntities.name,
        summary: intelEntities.summary,
        aliases: intelEntities.aliases,
        typeId: intelEntities.typeId,
        typeName: intelEntityTypes.name,
        typeIcon: intelEntityTypes.icon,
        typeColor: intelEntityTypes.color,
        confidence: intelEntities.confidence,
        confidenceScore: intelEntities.confidenceScore,
        corroboration: intelEntities.corroboration,
        sourceGrade: intelEntities.sourceGrade,
        watched: intelEntities.watched,
        createdAt: intelEntities.createdAt,
        firstSeenIn: intelEntities.firstSeenIn,
        relationshipCount: relCount.as('relationship_count'),
        noteCount: noteCount.as('note_count'),
      })
      .from(intelEntities)
      .innerJoin(intelEntityTypes, eq(intelEntities.typeId, intelEntityTypes.id))
      .where(and(eq(intelEntities.confirmed, false), isNull(intelEntities.mergedIntoId)))
      .orderBy(...orderBy)
      .limit(QUEUE_LIMIT),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(intelEntities)
      .where(and(eq(intelEntities.confirmed, false), isNull(intelEntities.mergedIntoId))),
    listEntityTypes(),
    listAlerts({ limit: 30 }),
  ]);

  const ids = rows.map((r) => r.id);

  const [links, edges] = ids.length
    ? await Promise.all([
        db
          .select({
            entityId: intelNoteEntities.entityId,
            excerpt: intelNoteEntities.excerpt,
            relevance: intelNoteEntities.relevance,
            noteId: intelNotes.id,
            noteTitle: intelNotes.title,
            noteSource: intelNotes.source,
            createdAt: intelNotes.createdAt,
          })
          .from(intelNoteEntities)
          .innerJoin(intelNotes, eq(intelNoteEntities.noteId, intelNotes.id))
          .where(inArray(intelNoteEntities.entityId, ids))
          .orderBy(desc(intelNotes.createdAt)),
        db
          .select({
            sourceId: intelRelationships.sourceEntityId,
            targetId: intelRelationships.targetEntityId,
            label: intelRelationships.label,
            type: intelRelationships.type,
            otherId: intelEntities.id,
            otherName: intelEntities.name,
            otherIcon: intelEntityTypes.icon,
            otherType: intelEntityTypes.name,
          })
          .from(intelRelationships)
          .innerJoin(
            intelEntities,
            or(
              and(
                inArray(intelRelationships.sourceEntityId, ids),
                eq(intelRelationships.targetEntityId, intelEntities.id),
              ),
              and(
                inArray(intelRelationships.targetEntityId, ids),
                eq(intelRelationships.sourceEntityId, intelEntities.id),
              ),
            ),
          )
          .innerJoin(intelEntityTypes, eq(intelEntities.typeId, intelEntityTypes.id))
          .where(eq(intelRelationships.suppressed, false))
          // Neighbours are context, not evidence — a hard cap keeps a hub
          // entity from turning this into the page's dominant payload.
          .limit(NEIGHBOUR_ROW_CAP),
      ])
    : [[], []];

  const evidence = new Map<string, TriageEvidence[]>();
  for (const link of links) {
    const bucket = evidence.get(link.entityId) ?? [];
    if (bucket.length >= EXCERPTS_PER_ENTITY) continue;
    bucket.push({
      noteId: link.noteId,
      noteTitle: link.noteTitle,
      noteSource: link.noteSource,
      relevance: link.relevance,
      excerpt: link.excerpt,
      createdAt: link.createdAt,
    });
    evidence.set(link.entityId, bucket);
  }

  const neighbours = new Map<string, TriageNeighbour[]>();
  for (const edge of edges) {
    // The join can attach either end; the queue entity is whichever one is in `ids`.
    const owner = edge.otherId === edge.targetId ? edge.sourceId : edge.targetId;
    const bucket = neighbours.get(owner) ?? [];
    if (bucket.length >= NEIGHBOURS_PER_ENTITY) continue;
    if (bucket.some((n) => n.id === edge.otherId)) continue;
    bucket.push({
      id: edge.otherId,
      name: edge.otherName,
      icon: edge.otherIcon,
      type: edge.otherType,
      label: edge.label ?? edge.type,
    });
    neighbours.set(owner, bucket);
  }

  return {
    order,
    total,
    truncated: total > rows.length,
    entities: rows.map((row) => ({
      ...row,
      evidence: evidence.get(row.id) ?? [],
      neighbours: neighbours.get(row.id) ?? [],
    })),
    types: types.filter((t) => t.status !== 'retired'),
    alerts,
  };
};
