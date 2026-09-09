import { db } from '$lib/db';
import { jkaiBuilds, jkaiIterations } from '$lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { json, error } from '@sveltejs/kit';
import { verifyBridgeToken, invokeTool, definitionsForBuild } from '$lib/jkai/tool-bridge';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  const auth = request.headers.get('authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  const buildId = verifyBridgeToken(token);
  if (!buildId) throw error(401, 'invalid token');
  const body = await request.json().catch(() => null) as { name?: unknown; args?: unknown } | null;
  if (!body || typeof body.name !== 'string') throw error(400, 'name required');
  try {
    const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, buildId));
    if (!build) throw new Error('build not found');
    const allowed = definitionsForBuild((build.enabledToolsets ?? ['all']) as string[]).map(d => d.function.name);
    const [iteration] = await db.select({ id: jkaiIterations.id }).from(jkaiIterations).where(eq(jkaiIterations.buildId, buildId)).orderBy(desc(jkaiIterations.createdAt)).limit(1);
    const result = await invokeTool(body.name, body.args, allowed, { buildId, iterationId: iteration?.id });
    return json({ ok: true, result });
  } catch (e) {
    return json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 400 },
    );
  }
};
