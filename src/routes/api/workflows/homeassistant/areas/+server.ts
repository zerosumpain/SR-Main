import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { homeAssistantConfig } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async () => {
  const [config] = await db
    .select()
    .from(homeAssistantConfig)
    .where(eq(homeAssistantConfig.id, 'default'))
    .limit(1);

  const areas = Array.isArray(config?.areaRegistry) ? config.areaRegistry : [];
  return json({ areas });
};
