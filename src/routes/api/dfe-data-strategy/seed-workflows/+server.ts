// POST /api/dfe-data-strategy/seed-workflows — idempotently create the daily jkai cron
// workflow that keeps the Keystone intelligence radar fresh. Thin graph: cron trigger →
// http-request POST /api/dfe-data-strategy/intel. Registers the cron live immediately
// (mirrors the policy-engine / data-standard-designer seed routes). Hit once after deploy.
// Auth: KEYSTONE_INTEL_SECRET as a Bearer token (if set).

import { json, error } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { db } from '$lib/db';
import { workflows, workflowNodes, workflowEdges, workflowSchedules } from '$lib/db/schema';
import { registerCronJob } from '$lib/workflows/scheduler';
import type { RequestHandler } from './$types';

const CRON = '40 6 * * *'; // daily 06:40 UTC (offset from the DSD sweep)
const NAME = 'canvas:keystone-intel-radar';

function authorized(request: Request): boolean {
  const secret = env.KEYSTONE_INTEL_SECRET;
  if (!secret) return true;
  return (request.headers.get('authorization') ?? '') === `Bearer ${secret}`;
}

export const POST: RequestHandler = async ({ request, url }) => {
  if (!authorized(request)) throw error(401, 'unauthorized');
  const origin = url.origin;
  const secret = env.KEYSTONE_INTEL_SECRET;

  const existing = await db.select().from(workflows).where(eq(workflows.name, NAME)).limit(1);
  let workflowId: string;
  let action: string;

  if (existing.length) {
    workflowId = existing[0].id;
    action = 'updated-schedule';
  } else {
    workflowId = randomUUID();
    const triggerId = randomUUID();
    const httpId = randomUUID();
    await db.insert(workflows).values({
      id: workflowId,
      name: NAME,
      description: 'Keystone — daily DfE data-strategy intelligence sweep',
      trigger: { type: 'cron', config: { expression: CRON } },
    });
    await db.insert(workflowNodes).values([
      { id: triggerId, workflowId, type: 'trigger', position: { x: 0, y: 80 }, label: 'Daily', config: { kind: 'cron', cron: CRON } },
      {
        id: httpId, workflowId, type: 'http-request', position: { x: 320, y: 80 }, label: 'Sweep intelligence',
        config: {
          method: 'POST',
          url: `${origin}/api/dfe-data-strategy/intel`,
          headers: '{"content-type":"application/json"}',
          body: JSON.stringify({ classify: true }),
          ...(secret ? { auth: 'bearer', authToken: secret } : { auth: 'none' }),
        },
      },
    ]);
    await db.insert(workflowEdges).values({ id: randomUUID(), workflowId, sourceNodeId: triggerId, targetNodeId: httpId });
    action = 'created';
  }

  const existingSched = await db.select().from(workflowSchedules).where(eq(workflowSchedules.workflowId, workflowId)).limit(1);
  let scheduleId: string;
  if (existingSched.length) {
    scheduleId = existingSched[0].id;
    await db.update(workflowSchedules).set({ type: 'cron', config: { expression: CRON }, enabled: true }).where(eq(workflowSchedules.id, scheduleId));
  } else {
    scheduleId = randomUUID();
    await db.insert(workflowSchedules).values({ id: scheduleId, workflowId, type: 'cron', config: { expression: CRON }, enabled: true });
  }
  registerCronJob({ id: scheduleId, workflowId, config: { expression: CRON } });

  return json({ seeded: { workflowId, action, cron: CRON } });
};
