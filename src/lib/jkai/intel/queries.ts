import { db } from '$lib/db';
import {
  intelNotes,
  intelEntities,
  intelEntityTypes,
  intelRelationships,
  intelNoteEntities,
  intelTimelineEvents,
  intelAlerts,
  intelDossiers,
} from '$lib/db/schema';
import { desc, eq, sql, isNull, asc, and } from 'drizzle-orm';
import { linksToItem, observedAtSql, sourceHref } from './provenance';
import { OWNER_INTEL_SCOPE, spaceIn, type IntelScope } from './scope';

// Every reader here takes the reader's scope (default: the owner's). A lookup
// by id gets the predicate too: an id from another space returns null, which a
// route turns into a 404, rather than loading someone else's row.

export async function listNotes(
  opts: { limit?: number; offset?: number; source?: string; format?: string; scope?: IntelScope } = {},
) {
  const { limit = 50, offset = 0, source, format, scope = OWNER_INTEL_SCOPE } = opts;

  const conditions = [
    spaceIn(intelNotes.spaceId, scope),
    ...(source ? [eq(intelNotes.source, source)] : []),
    ...(format ? [eq(intelNotes.format, format)] : []),
  ];

  const where = and(...conditions);

  const notes = await db
    .select({
      id: intelNotes.id,
      title: intelNotes.title,
      source: intelNotes.source,
      format: intelNotes.format,
      status: intelNotes.status,
      createdAt: intelNotes.createdAt,
      updatedAt: intelNotes.updatedAt,
      entityCount: sql<number>`(
        select count(*) from intel_note_entities
        where intel_note_entities.note_id = intel_notes.id
      )::int`.as('entity_count'),
    })
    .from(intelNotes)
    .where(where)
    .orderBy(desc(intelNotes.createdAt))
    .limit(limit)
    .offset(offset);

  return notes;
}

export async function getNoteDetail(id: string, scope: IntelScope = OWNER_INTEL_SCOPE) {
  const [note] = await db
    .select()
    .from(intelNotes)
    .where(and(eq(intelNotes.id, id), spaceIn(intelNotes.spaceId, scope)))
    .limit(1);

  if (!note) return null;

  const entities = await db
    .select({
      entityId: intelNoteEntities.entityId,
      relevance: intelNoteEntities.relevance,
      excerpt: intelNoteEntities.excerpt,
      entityName: intelEntities.name,
      entityType: intelEntityTypes.name,
      entityTypeIcon: intelEntityTypes.icon,
      entityTypeColor: intelEntityTypes.color,
    })
    .from(intelNoteEntities)
    .innerJoin(intelEntities, eq(intelNoteEntities.entityId, intelEntities.id))
    .innerJoin(intelEntityTypes, eq(intelEntities.typeId, intelEntityTypes.id))
    .where(and(eq(intelNoteEntities.noteId, id), spaceIn(intelEntities.spaceId, scope)));

  const timelineEvents = await db
    .select()
    .from(intelTimelineEvents)
    .where(and(eq(intelTimelineEvents.noteId, id), spaceIn(intelTimelineEvents.spaceId, scope)))
    .orderBy(asc(intelTimelineEvents.date));

  return { note, entities, timelineEvents };
}

export async function listEntities(
  opts: { limit?: number; offset?: number; typeId?: string; scope?: IntelScope } = {},
) {
  const { limit = 50, offset = 0, typeId, scope = OWNER_INTEL_SCOPE } = opts;

  const conditions = [
    isNull(intelEntities.mergedIntoId),
    spaceIn(intelEntities.spaceId, scope),
    ...(typeId ? [eq(intelEntities.typeId, typeId)] : []),
  ];

  const entities = await db
    .select({
      id: intelEntities.id,
      name: intelEntities.name,
      typeId: intelEntities.typeId,
      typeName: intelEntityTypes.name,
      typeIcon: intelEntityTypes.icon,
      typeColor: intelEntityTypes.color,
      summary: intelEntities.summary,
      confidence: intelEntities.confidence,
      confirmed: intelEntities.confirmed,
      createdAt: intelEntities.createdAt,
      noteCount: sql<number>`(
        select count(*) from intel_note_entities
        where intel_note_entities.entity_id = intel_entities.id
      )::int`.as('note_count'),
      relationshipCount: sql<number>`(
        select count(*) from intel_relationships
        where (intel_relationships.source_entity_id = intel_entities.id
           or intel_relationships.target_entity_id = intel_entities.id)
          and ${spaceIn(sql`intel_relationships.space_id`, scope)}
      )::int`.as('relationship_count'),
    })
    .from(intelEntities)
    .innerJoin(intelEntityTypes, eq(intelEntities.typeId, intelEntityTypes.id))
    .where(and(...conditions))
    .orderBy(desc(intelEntities.updatedAt))
    .limit(limit)
    .offset(offset);

  return entities;
}

/** `sourceHref` plus whether it reached the item or fell back to the note. */
function hrefFields(noteId: string, metadata: unknown) {
  const href = sourceHref(noteId, metadata);
  return { href, direct: linksToItem(href) };
}

export async function getEntityDetail(id: string, scope: IntelScope = OWNER_INTEL_SCOPE) {
  const [entity] = await db
    .select({
      id: intelEntities.id,
      name: intelEntities.name,
      typeId: intelEntities.typeId,
      typeName: intelEntityTypes.name,
      typeIcon: intelEntityTypes.icon,
      typeColor: intelEntityTypes.color,
      summary: intelEntities.summary,
      properties: intelEntities.properties,
      confidence: intelEntities.confidence,
      confirmed: intelEntities.confirmed,
      createdAt: intelEntities.createdAt,
      updatedAt: intelEntities.updatedAt,
      firstSeenIn: intelEntities.firstSeenIn,
    })
    .from(intelEntities)
    .innerJoin(intelEntityTypes, eq(intelEntities.typeId, intelEntityTypes.id))
    .where(and(eq(intelEntities.id, id), spaceIn(intelEntities.spaceId, scope)))
    .limit(1);

  if (!entity) return null;

  const relationships = await db
    .select({
      id: intelRelationships.id,
      type: intelRelationships.type,
      label: intelRelationships.label,
      strength: intelRelationships.strength,
      confidence: intelRelationships.confidence,
      sourceEntityId: intelRelationships.sourceEntityId,
      targetEntityId: intelRelationships.targetEntityId,
    })
    .from(intelRelationships)
    .where(
      and(
        sql`(${intelRelationships.sourceEntityId} = ${id} OR ${intelRelationships.targetEntityId} = ${id})`,
        spaceIn(intelRelationships.spaceId, scope),
      ),
    );

  const relatedIds = new Set<string>();
  for (const r of relationships) {
    relatedIds.add(r.sourceEntityId);
    relatedIds.add(r.targetEntityId);
  }
  relatedIds.delete(id);

  const relatedEntities = relatedIds.size > 0
    ? await db
        .select({ id: intelEntities.id, name: intelEntities.name, typeIcon: intelEntityTypes.icon })
        .from(intelEntities)
        .innerJoin(intelEntityTypes, eq(intelEntities.typeId, intelEntityTypes.id))
        .where(
          and(
            sql`${intelEntities.id} IN (${sql.join([...relatedIds].map(i => sql`${i}`), sql`, `)})`,
            spaceIn(intelEntities.spaceId, scope),
          ),
        )
    : [];

  const entityNameMap = new Map(relatedEntities.map((e) => [e.id, { name: e.name, icon: e.typeIcon }]));

  // Provenance, in the same shape the hover card serves so both surfaces answer
  // "where did this come from" identically — see `provenance.ts`.
  const linked = await db
    .select({
      id: intelNoteEntities.noteId,
      relevance: intelNoteEntities.relevance,
      excerpt: intelNoteEntities.excerpt,
      title: intelNotes.title,
      source: intelNotes.source,
      metadata: intelNotes.metadata,
      createdAt: intelNotes.createdAt,
      observedAt: observedAtSql(intelNotes.observedAt, intelNotes.id).as('observed_at'),
    })
    .from(intelNoteEntities)
    .innerJoin(intelNotes, eq(intelNoteEntities.noteId, intelNotes.id))
    .where(and(eq(intelNoteEntities.entityId, id), spaceIn(intelNotes.spaceId, scope)))
    .orderBy(sql`COALESCE(${observedAtSql(intelNotes.observedAt, intelNotes.id)}, ${intelNotes.createdAt}) DESC`);

  // The note the entity was first extracted from is not always among the linked
  // ones: an entity lifted from a deep dive or a chat thread often has no
  // `intel_note_entities` row at all — 561 of 4,737 on 2026-08-05 — and its page
  // showed no provenance whatsoever even though `first_seen_in` recorded it the
  // whole time. Fetched separately so that entity still has a way back.
  const firstSeenId = entity.firstSeenIn;
  const [firstSeenNote] =
    firstSeenId && !linked.some((n) => n.id === firstSeenId)
      ? await db
          .select({
            id: intelNotes.id,
            title: intelNotes.title,
            source: intelNotes.source,
            metadata: intelNotes.metadata,
            createdAt: intelNotes.createdAt,
            observedAt: observedAtSql(intelNotes.observedAt, intelNotes.id).as('observed_at'),
          })
          .from(intelNotes)
          .where(and(eq(intelNotes.id, firstSeenId), spaceIn(intelNotes.spaceId, scope)))
          .limit(1)
      : [];

  const notes = [
    ...linked.map((n) => ({
      id: n.id,
      title: n.title ?? 'Untitled',
      source: n.source,
      createdAt: n.createdAt,
      observedAt: n.observedAt ?? null,
      relevance: n.relevance,
      excerpt: n.excerpt,
      ...hrefFields(n.id, n.metadata),
      firstSeen: n.id === firstSeenId,
    })),
    ...(firstSeenNote
      ? [
          {
            id: firstSeenNote.id,
            title: firstSeenNote.title ?? 'Untitled',
            source: firstSeenNote.source,
            createdAt: firstSeenNote.createdAt,
            observedAt: firstSeenNote.observedAt ?? null,
            relevance: null as string | null,
            excerpt: null as string | null,
            ...hrefFields(firstSeenNote.id, firstSeenNote.metadata),
            firstSeen: true,
          },
        ]
      : []),
  ];

  // Split rather than flagged-in-place: the origin and what has happened since
  // are two different questions, and a "first seen" badge buried at position
  // nine of a date-ordered list answers neither.
  const firstSource = notes.find((n) => n.firstSeen) ?? null;
  const laterSources = notes.filter((n) => !n.firstSeen);

  const timelineEvents = await db
    .select()
    .from(intelTimelineEvents)
    .where(and(eq(intelTimelineEvents.entityId, id), spaceIn(intelTimelineEvents.spaceId, scope)))
    .orderBy(asc(intelTimelineEvents.date));

  return {
    entity,
    relationships: relationships.map((r) => {
      const otherId = r.sourceEntityId === id ? r.targetEntityId : r.sourceEntityId;
      const other = entityNameMap.get(otherId);
      const direction = r.sourceEntityId === id ? 'outgoing' : 'incoming';
      return { ...r, direction, otherEntityId: otherId, otherEntityName: other?.name ?? 'Unknown', otherEntityIcon: other?.icon ?? '🔷' };
    }),
    notes,
    firstSource,
    laterSources,
    timelineEvents,
  };
}

export async function getIntelStats(scope: IntelScope = OWNER_INTEL_SCOPE) {
  const [
    [noteCount],
    [entityCount],
    [riskCount],
    [pendingReviewCount],
    [unconnectedCount],
    [dossierCount],
  ] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(intelNotes).where(spaceIn(intelNotes.spaceId, scope)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(intelEntities)
      .where(and(isNull(intelEntities.mergedIntoId), spaceIn(intelEntities.spaceId, scope))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(intelEntities)
      .innerJoin(intelEntityTypes, eq(intelEntities.typeId, intelEntityTypes.id))
      .where(and(eq(intelEntityTypes.name, 'risk'), isNull(intelEntities.mergedIntoId), spaceIn(intelEntities.spaceId, scope))),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(intelEntities)
      .where(
        and(
          eq(intelEntities.confirmed, false),
          eq(intelEntities.confidence, 'low'),
          isNull(intelEntities.mergedIntoId),
          spaceIn(intelEntities.spaceId, scope),
        ),
      ),
    // The `03 repair` reading: live entities with no edge in either direction.
    // Fragments that never joined up are the thing that stage exists to fix.
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(intelEntities)
      .where(
        and(
          isNull(intelEntities.mergedIntoId),
          spaceIn(intelEntities.spaceId, scope),
          sql`not exists (
            select 1 from intel_relationships r
            where (r.source_entity_id = ${intelEntities.id}
               or r.target_entity_id = ${intelEntities.id})
              and ${spaceIn(sql`r.space_id`, scope)}
          )`,
        ),
      ),
    // Open case files only — a closed dossier is not part of this month's
    // working set, which is what `05 collect` is counting.
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(intelDossiers)
      .where(and(eq(intelDossiers.status, 'open'), spaceIn(intelDossiers.spaceId, scope))),
  ]);

  return {
    noteCount: noteCount.count,
    entityCount: entityCount.count,
    riskCount: riskCount.count,
    pendingReviewCount: pendingReviewCount.count,
    unconnectedCount: unconnectedCount.count,
    dossierCount: dossierCount.count,
  };
}

export async function listEntityTypes() {
  return db.select().from(intelEntityTypes).orderBy(asc(intelEntityTypes.name));
}

export async function listTimelineEvents(
  opts: { limit?: number; entityId?: string; type?: string; scope?: IntelScope } = {},
) {
  const { limit = 100, entityId, type, scope = OWNER_INTEL_SCOPE } = opts;

  const conditions = [
    spaceIn(intelTimelineEvents.spaceId, scope),
    ...(entityId ? [eq(intelTimelineEvents.entityId, entityId)] : []),
    ...(type ? [eq(intelTimelineEvents.type, type)] : []),
  ];

  const where = and(...conditions);

  return db
    .select({
      id: intelTimelineEvents.id,
      date: intelTimelineEvents.date,
      dateEnd: intelTimelineEvents.dateEnd,
      type: intelTimelineEvents.type,
      title: intelTimelineEvents.title,
      description: intelTimelineEvents.description,
      entityId: intelTimelineEvents.entityId,
      entityName: intelEntities.name,
      entityTypeIcon: intelEntityTypes.icon,
      noteId: intelTimelineEvents.noteId,
      createdAt: intelTimelineEvents.createdAt,
    })
    .from(intelTimelineEvents)
    // Scoped in the ON clause, so an event with no (visible) entity is kept
    // but can never carry another space's entity name.
    .leftJoin(intelEntities, and(eq(intelTimelineEvents.entityId, intelEntities.id), spaceIn(intelEntities.spaceId, scope)))
    .leftJoin(intelEntityTypes, eq(intelEntities.typeId, intelEntityTypes.id))
    .where(where)
    .orderBy(asc(intelTimelineEvents.date))
    .limit(limit);
}

export async function listAlerts(
  opts: { limit?: number; significance?: string; includeDismissed?: boolean; scope?: IntelScope } = {},
) {
  const { limit = 50, significance, includeDismissed = false, scope = OWNER_INTEL_SCOPE } = opts;

  const conditions = [
    spaceIn(intelAlerts.spaceId, scope),
    ...(significance ? [eq(intelAlerts.significance, significance)] : []),
    ...(!includeDismissed ? [eq(intelAlerts.dismissed, false)] : []),
  ];

  const where = and(...conditions);

  return db
    .select()
    .from(intelAlerts)
    .where(where)
    .orderBy(desc(intelAlerts.createdAt))
    .limit(limit);
}

export async function listPendingReview(scope: IntelScope = OWNER_INTEL_SCOPE) {
  const entities = await db
    .select({
      id: intelEntities.id,
      name: intelEntities.name,
      typeId: intelEntities.typeId,
      typeName: intelEntityTypes.name,
      typeIcon: intelEntityTypes.icon,
      confidence: intelEntities.confidence,
      properties: intelEntities.properties,
      createdAt: intelEntities.createdAt,
      noteTitle: intelNotes.title,
    })
    .from(intelEntities)
    .innerJoin(intelEntityTypes, eq(intelEntities.typeId, intelEntityTypes.id))
    .leftJoin(intelNotes, and(eq(intelEntities.firstSeenIn, intelNotes.id), spaceIn(intelNotes.spaceId, scope)))
    .where(and(
      eq(intelEntities.confirmed, false),
      isNull(intelEntities.mergedIntoId),
      spaceIn(intelEntities.spaceId, scope),
    ))
    .orderBy(asc(intelEntities.confidence), desc(intelEntities.createdAt));

  const newTypes = await db
    .select()
    .from(intelEntityTypes)
    .where(eq(intelEntityTypes.isSeeded, false))
    .orderBy(desc(intelEntityTypes.createdAt));

  return { entities, newTypes };
}
