import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflows, intelEntities, intelEntityTypes, intelRelationships } from '$lib/db/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { OWNER_INTEL_SCOPE, spaceIn } from '$lib/jkai/intel/scope';

// Owner scope, explicitly — not resolveRequestScope. A canvas is the owner's and
// its nodes also run unattended (cron, webhooks), where there is no request
// principal to resolve; its intel reads are the owner's graph either way.
export const POST: RequestHandler = async ({ params, request }) => {
  const [wf] = await db
    .select({ id: workflows.id })
    .from(workflows)
    .where(eq(workflows.name, `canvas:${params.slug}`))
    .limit(1);
  if (!wf) throw error(404, 'Canvas not found');

  const body = await request.json();
  const entityIds: string[] = Array.isArray(body?.entityIds) ? body.entityIds : [];

  if (entityIds.length === 0) {
    return json({ nodes: [], edges: [] });
  }

  const entities = await db
    .select({
      id: intelEntities.id,
      name: intelEntities.name,
      typeName: intelEntityTypes.name,
      typeIcon: intelEntityTypes.icon,
      typeColor: intelEntityTypes.color,
      summary: intelEntities.summary,
      connectionCount: sql<number>`(
        SELECT count(*) FROM intel_relationships
        WHERE (intel_relationships.source_entity_id = intel_entities.id
           OR intel_relationships.target_entity_id = intel_entities.id)
          AND ${spaceIn(sql`intel_relationships.space_id`, OWNER_INTEL_SCOPE)}
      )::int`.as('connection_count'),
    })
    .from(intelEntities)
    .innerJoin(intelEntityTypes, eq(intelEntities.typeId, intelEntityTypes.id))
    .where(and(inArray(intelEntities.id, entityIds), spaceIn(intelEntities.spaceId, OWNER_INTEL_SCOPE)));

  const entityIdSet = new Set(entityIds);

  const relationships = await db
    .select({
      id: intelRelationships.id,
      sourceId: intelRelationships.sourceEntityId,
      targetId: intelRelationships.targetEntityId,
      type: intelRelationships.type,
      label: intelRelationships.label,
      strength: intelRelationships.strength,
    })
    .from(intelRelationships)
    .where(
      and(
        inArray(intelRelationships.sourceEntityId, entityIds),
        spaceIn(intelRelationships.spaceId, OWNER_INTEL_SCOPE),
      ),
    );

  const edges = relationships.filter(
    (r) => entityIdSet.has(r.sourceId) && entityIdSet.has(r.targetId),
  );

  return json({
    nodes: entities.map((e) => ({
      id: e.id,
      name: e.name,
      type: e.typeName,
      icon: e.typeIcon,
      color: e.typeColor,
      summary: e.summary,
      connectionCount: e.connectionCount,
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.sourceId,
      target: e.targetId,
      type: e.type,
      label: e.label,
      strength: e.strength,
    })),
  });
};
