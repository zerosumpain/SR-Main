import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { biomeConfig } from '$lib/db/schema';
import { BIOME_SETTINGS_DEFAULTS, type BiomeSettings } from '$lib/biome/settings';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  try {
    const rows = await db.select().from(biomeConfig).limit(1);
    if (rows.length === 0) {
      return json(BIOME_SETTINGS_DEFAULTS);
    }
    const parsed = JSON.parse(rows[0].settings) as Partial<BiomeSettings>;
    // Merge with defaults so new keys are always present even if DB row is old
    const merged: BiomeSettings = { ...BIOME_SETTINGS_DEFAULTS, ...parsed };
    return json(merged);
  } catch {
    return json(BIOME_SETTINGS_DEFAULTS);
  }
};

export const POST: RequestHandler = async ({ request }) => {
  let body: Partial<BiomeSettings>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const merged: BiomeSettings = { ...BIOME_SETTINGS_DEFAULTS, ...body };
  const settingsJson = JSON.stringify(merged);

  try {
    const existing = await db.select().from(biomeConfig).limit(1);
    if (existing.length === 0) {
      await db.insert(biomeConfig).values({ settings: settingsJson });
    } else {
      await db
        .update(biomeConfig)
        .set({ settings: settingsJson, updatedAt: new Date() });
    }
    return json({ ok: true, settings: merged });
  } catch (err) {
    console.error('Failed to save biome config:', err);
    return json({ error: 'Database error' }, { status: 500 });
  }
};
