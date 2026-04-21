import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { workflows, intelEntities, intelEntityTypes } from '$lib/db/schema';
import { eq, inArray } from 'drizzle-orm';

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
    return json({ items: [] });
  }

  const entities = await db
    .select({
      id: intelEntities.id,
      name: intelEntities.name,
      properties: intelEntities.properties,
      typeName: intelEntityTypes.name,
    })
    .from(intelEntities)
    .innerJoin(intelEntityTypes, eq(intelEntities.typeId, intelEntityTypes.id))
    .where(inArray(intelEntities.id, entityIds));

  type GeoItem = { id: string; name: string; lat: number; lng: number; type: string };

  const items: GeoItem[] = [];
  for (const e of entities) {
    const props = e.properties ?? {};

    // Strategy 1: flat lat/lng
    if (typeof props.lat === 'number' && typeof props.lng === 'number') {
      items.push({ id: e.id, name: e.name, lat: props.lat, lng: props.lng, type: e.typeName });
      continue;
    }

    // Strategy 2: coordinates as { lat, lng }
    const coords = props.coordinates;
    if (coords && typeof coords === 'object' && !Array.isArray(coords)) {
      const c = coords as Record<string, unknown>;
      if (typeof c.lat === 'number' && typeof c.lng === 'number') {
        items.push({ id: e.id, name: e.name, lat: c.lat, lng: c.lng, type: e.typeName });
        continue;
      }
    }

    // Strategy 3: GeoJSON [lng, lat] array
    if (Array.isArray(coords) && coords.length >= 2) {
      const [lng, lat] = coords as number[];
      if (typeof lat === 'number' && typeof lng === 'number') {
        items.push({ id: e.id, name: e.name, lat, lng, type: e.typeName });
        continue;
      }
    }
  }

  return json({ items });
};
