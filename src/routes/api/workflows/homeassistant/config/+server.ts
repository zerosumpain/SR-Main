import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { homeAssistantConfig } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { initHomeAssistantService } from '$lib/workflows/homeassistant/service';

export const GET: RequestHandler = async () => {
  const [config] = await db
    .select()
    .from(homeAssistantConfig)
    .where(eq(homeAssistantConfig.id, 'default'))
    .limit(1);

  if (!config) {
    return json({ url: 'http://localhost:8123', hasToken: false, lastSynced: null, entityCount: 0, areaCount: 0 });
  }

  return json({
    url: config.url,
    hasToken: !!config.token,
    lastSynced: config.lastSynced,
    entityCount: Array.isArray(config.entityRegistry) ? (config.entityRegistry as any[]).length : 0,
    areaCount: Array.isArray(config.areaRegistry) ? (config.areaRegistry as any[]).length : 0,
  });
};

export const PUT: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const { url, token } = body;

  const values: Record<string, unknown> = { id: 'default', updatedAt: new Date() };
  if (typeof url === 'string') values.url = url;
  if (typeof token === 'string') values.token = token;

  await db
    .insert(homeAssistantConfig)
    .values(values as any)
    .onConflictDoUpdate({
      target: homeAssistantConfig.id,
      set: { ...values, id: undefined } as any,
    });

  if (url || token) {
    const [config] = await db.select().from(homeAssistantConfig).where(eq(homeAssistantConfig.id, 'default')).limit(1);
    if (config?.token) {
      initHomeAssistantService(config.url, config.token);
    }
  }

  return json({ success: true });
};
