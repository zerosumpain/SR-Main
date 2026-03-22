import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { agentSettings } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ url }) => {
  const key = url.searchParams.get('key');

  if (key) {
    const [setting] = await db
      .select()
      .from(agentSettings)
      .where(eq(agentSettings.key, key));
    if (!setting) return Response.json({ key, value: '' });
    return Response.json(setting);
  }

  const all = await db.select().from(agentSettings);
  return Response.json(all);
};

export const PUT: RequestHandler = async ({ request }) => {
  const { key, value } = await request.json();

  if (!key) {
    return Response.json({ error: 'key is required' }, { status: 400 });
  }

  const [result] = await db
    .insert(agentSettings)
    .values({ key, value: value ?? '', updatedAt: new Date() })
    .onConflictDoUpdate({
      target: agentSettings.key,
      set: { value: value ?? '', updatedAt: new Date() },
    })
    .returning();

  return Response.json(result);
};
