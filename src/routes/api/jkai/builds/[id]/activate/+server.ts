import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { jkaiBuilds, jkaiIterations } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { activateSnapshot, readServeJson } from '$lib/jkai/sandbox';
import { validateServeConfig } from '$lib/jkai/serve';

export const POST: RequestHandler = async ({ params, request }) => {
  const body = await request.json();
  const { iterationNumber } = body;

  if (typeof iterationNumber !== 'number') {
    return json({ error: 'iterationNumber is required' }, { status: 400 });
  }

  const [build] = await db
    .select()
    .from(jkaiBuilds)
    .where(eq(jkaiBuilds.id, params.id));

  if (!build) return json({ error: 'Not found' }, { status: 404 });

  // Get the iteration to check it exists
  const [iteration] = await db
    .select()
    .from(jkaiIterations)
    .where(
      and(
        eq(jkaiIterations.buildId, params.id),
        eq(jkaiIterations.number, iterationNumber),
      ),
    );

  if (!iteration) return json({ error: 'Iteration not found' }, { status: 404 });

  // We need serve config to know how to start the server
  const serveConfig = build.serveConfig as any;
  if (!serveConfig) {
    return json({ error: 'No serve config — project has never been serveable' }, { status: 400 });
  }

  const healthy = await activateSnapshot(
    params.id,
    iterationNumber,
    serveConfig.startCommand,
    serveConfig.port,
    serveConfig.healthCheck,
  );

  if (!healthy) {
    return json({ error: 'Server failed health check after activation' }, { status: 500 });
  }

  return json({ ok: true, activeIteration: iterationNumber });
};
