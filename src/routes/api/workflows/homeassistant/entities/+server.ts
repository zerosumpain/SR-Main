import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { homeAssistantConfig } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ url }) => {
  const domain = url.searchParams.get('domain');

  const [config] = await db
    .select()
    .from(homeAssistantConfig)
    .where(eq(homeAssistantConfig.id, 'default'))
    .limit(1);

  let entities = Array.isArray(config?.entityRegistry) ? (config.entityRegistry as any[]) : [];

  if (domain) {
    entities = entities.filter((e: any) => e.domain === domain);
  }

  return json({ entities });
};
