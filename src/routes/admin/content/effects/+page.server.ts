import { BIOME_SETTINGS_DEFAULTS, type BiomeSettings } from '$lib/biome/settings';
import { db } from '$lib/db';
import { biomeConfig } from '$lib/db/schema';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  try {
    const rows = await db.select().from(biomeConfig).limit(1);
    if (rows.length === 0) {
      return { settings: BIOME_SETTINGS_DEFAULTS };
    }
    const parsed = JSON.parse(rows[0].settings) as Partial<BiomeSettings>;
    const merged: BiomeSettings = { ...BIOME_SETTINGS_DEFAULTS, ...parsed };
    return { settings: merged };
  } catch {
    return { settings: BIOME_SETTINGS_DEFAULTS };
  }
};
