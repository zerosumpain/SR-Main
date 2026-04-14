import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { homeAssistantConfig } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { getHomeAssistantService } from '$lib/workflows/homeassistant/service';

export const POST: RequestHandler = async () => {
  const service = getHomeAssistantService();

  try {
    const { entities, entityCount } = await service.syncRegistries();

    const areaMap = new Map<string, string>();
    for (const e of entities) {
      if (e.area_id && e.area_name) {
        areaMap.set(e.area_id, e.area_name);
      }
    }
    const areas = Array.from(areaMap.entries()).map(([id, name]) => ({ id, name }));

    await db.update(homeAssistantConfig).set({
      entityRegistry: entities,
      areaRegistry: areas,
      lastSynced: new Date(),
      updatedAt: new Date(),
    }).where(eq(homeAssistantConfig.id, 'default'));

    return json({ success: true, entityCount, areaCount: areas.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return json({ success: false, error: message }, { status: 500 });
  }
};
