import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { integrations } from '$lib/db/schema';

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const { name, description, baseUrl, authType, authConfig, operations } = body;

  if (!name || !baseUrl) {
    return json({ error: 'name and baseUrl are required' }, { status: 400 });
  }

  // Validate by making a test request to the base URL
  try {
    const testRes = await fetch(baseUrl, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000),
    }).catch(() => null);

    // Don't fail on non-200 — many APIs return 401/404 for HEAD on base URL
    // Just verify the host is reachable
    if (!testRes) {
      return json({ error: `Cannot reach ${baseUrl}` }, { status: 400 });
    }
  } catch {
    return json({ error: `Cannot reach ${baseUrl}` }, { status: 400 });
  }

  const [integration] = await db.insert(integrations).values({
    name,
    description: description || null,
    baseUrl,
    authType: authType || 'none',
    authConfig: authConfig || {},
    operations: operations || [],
  }).returning();

  return json({
    success: true,
    integration,
    nodeType: `integration:${integration.id}`,
  }, { status: 201 });
};
