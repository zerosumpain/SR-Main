import { db } from '$lib/db';
import { jkaiIterations } from '$lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { json, error } from '@sveltejs/kit';
import { runningBridgeBuild } from '$lib/jkai/bridge-auth.server';
import { invokeTool, definitionsForBuild } from '$lib/jkai/tool-bridge';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  // A recent token for a build that is still running — not merely one that
  // exists. See $lib/jkai/bridge-auth.server.
  const build = await runningBridgeBuild(request.headers.get('authorization'));
  if (!build) throw error(401, 'invalid token');
  const buildId = build.id;
  const body = await request.json().catch(() => null) as { name?: unknown; args?: unknown } | null;
  if (!body || typeof body.name !== 'string') throw error(400, 'name required');
  try {
    const allowed = (await definitionsForBuild((build.enabledToolsets ?? ['all']) as string[])).map(d => d.function.name);
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
