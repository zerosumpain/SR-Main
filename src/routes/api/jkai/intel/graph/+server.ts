import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { intelEntities, intelEntityTypes, intelRelationships } from '$lib/db/schema';
import { eq, sql, isNull, and } from 'drizzle-orm';

export const GET: RequestHandler = async ({ url }) => {
  const typeId = url.searchParams.get('typeId') ?? undefined;

  const conditions = [isNull(intelEntities.mergedIntoId)];
  if (typeId) conditions.push(eq(intelEntities.typeId, typeId));

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
      connectionCount: sql<number>`(
        SELECT count(*) FROM intel_relationships
        WHERE intel_relationships.source_entity_id = intel_entities.id
           OR intel_relationships.target_entity_id = intel_entities.id
      )::int`.as('connection_count'),
    })
    .from(intelEntities)
    .innerJoin(intelEntityTypes, eq(intelEntities.typeId, intelEntityTypes.id))
    .where(and(...conditions));

  const entityIds = new Set(entities.map((e) => e.id));

  const relationships = await db
    .select({
      id: intelRelationships.id,
      sourceId: intelRelationships.sourceEntityId,
      targetId: intelRelationships.targetEntityId,
      type: intelRelationships.type,
      label: intelRelationships.label,
      strength: intelRelationships.strength,
    })
    .from(intelRelationships);

  const edges = relationships.filter((r) => entityIds.has(r.sourceId) && entityIds.has(r.targetId));

  const types = await db
    .select({
      id: intelEntityTypes.id,
      name: intelEntityTypes.name,
      icon: intelEntityTypes.icon,
      color: intelEntityTypes.color,
    })
    .from(intelEntityTypes);

  return json({
    nodes: entities.map((e) => ({
      id: e.id,
      name: e.name,
      type: e.typeName,
      icon: e.typeIcon,
      color: e.typeColor,
      summary: e.summary,
      connectionCount: e.connectionCount,
      confirmed: e.confirmed,
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.sourceId,
      target: e.targetId,
      type: e.type,
      label: e.label,
      strength: e.strength,
    })),
    types,
  });
};
