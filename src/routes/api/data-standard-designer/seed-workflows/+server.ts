// POST /api/data-standard-designer/seed-workflows — idempotently create the
// daily jkai cron workflow that keeps the emerging-standards registry fresh.
// Thin graph: cron trigger → http-request POST /api/data-standard-designer/ingest.
// Running this in the web process registers the cron live immediately (mirrors
// the policy-engine seed-workflows route). Hit once after each deploy.
//
// Auth: DSD_INGEST_SECRET as a Bearer token (if set).

import { json } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { db } from '$lib/db';
import { workflows, workflowNodes, workflowEdges, workflowSchedules } from '$lib/db/schema';
import { registerCronJob } from '$lib/workflows/scheduler';
import type { RequestHandler } from './$types';
import { assertBearerSecret } from '$lib/server/service-auth';
import { assertPublicRequestBudget } from '$lib/server/public-request-guard';

// Daily at 06:30 UTC — sources publish irregularly; the ingest route's
// dedup + change-detection makes daily polling cheap (no-ops cost nothing).
const CRON = '30 6 * * *';
const NAME = 'canvas:dsd-standards-discovery';

export const POST: RequestHandler = async (event) => {
  const { request, url } = event;
  assertPublicRequestBudget(event, {
    scope: 'dsd-seed', perClient: { capacity: 3, refillPerSecond: 3 / 3600 },
    global: { capacity: 6, refillPerSecond: 6 / 3600 },
  });
  assertBearerSecret(request, env.DSD_INGEST_SECRET, 'DSD_INGEST_SECRET');
  const origin = url.origin;
  const secret = env.DSD_INGEST_SECRET;

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
      description: 'Data Standard Designer — daily emerging-standards discovery sweep',
      trigger: { type: 'cron', config: { expression: CRON } },
    });
    await db.insert(workflowNodes).values([
      { id: triggerId, workflowId, type: 'trigger', position: { x: 0, y: 80 }, label: 'Daily', config: { kind: 'cron', cron: CRON } },
      {
        id: httpId, workflowId, type: 'http-request', position: { x: 320, y: 80 }, label: 'Discover standards',
        config: {
          method: 'POST',
          url: `${origin}/api/data-standard-designer/ingest`,
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
