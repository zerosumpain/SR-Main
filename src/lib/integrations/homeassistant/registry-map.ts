import { db } from '$lib/db';
import { homeAssistantConfig } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export type RegistryMeta = { area_id: string | null; area_name: string | null; domain: string; friendly_name: string };

/** Load the cached entity registry (area/domain/friendly_name) as a lookup map.
 *  The live REST /api/states response has state + attributes but NO area, so
 *  query_state/get_history join it with this cached registry per entity_id. */
export async function loadRegistryMap(): Promise<Map<string, RegistryMeta>> {
  const map = new Map<string, RegistryMeta>();
  try {
    const [cfg] = await db
      .select()
      .from(homeAssistantConfig)
      .where(eq(homeAssistantConfig.id, 'default'))
      .limit(1);
    const reg = Array.isArray(cfg?.entityRegistry) ? (cfg.entityRegistry as Array<Record<string, unknown>>) : [];
    for (const e of reg) {
      const id = e.entity_id;
      if (typeof id === 'string') {
        map.set(id, {
          area_id: (e.area_id as string | null) ?? null,
          area_name: (e.area_name as string | null) ?? null,
          domain: (e.domain as string) || id.split('.')[0],
          friendly_name: (e.friendly_name as string) || id,
        });
      }
    }
  } catch {
    // registry unavailable — proceed without area enrichment
  }
  return map;
}
