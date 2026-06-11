// POST /api/policy-engine/seed-workflows — create (idempotently) the four jkai cron
// workflows that keep The Whitehall Model's live-data layer fresh. Each is a thin
// graph: cron trigger → http-request POST /api/policy-engine/ingest {group}. Running
// this IN the web process means registerCronJob() registers the crons live immediately.
//
// Auth: POLICY_INGEST_SECRET as a Bearer token (if set). Hit once after each deploy.

import { json, error } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { db } from '$lib/db';
import { workflows, workflowNodes, workflowEdges, workflowSchedules } from '$lib/db/schema';
import { registerCronJob } from '$lib/workflows/scheduler';
import type { RequestHandler } from './$types';

interface GroupCfg {
  group: 'ees' | 'neet' | 'context' | 'annual';
  cron: string;
  title: string;
  body: Record<string, unknown>;
}

// Polls slightly more often than each source's real cadence; the ingest route's
// release-gate suppresses no-op writes, so over-polling is cheap.
const GROUPS: GroupCfg[] = [
  { group: 'ees', cron: '0 6 * * 1', title: 'EES weekly sweep (KS4/KS2/EYFSP/SEN/absence)', body: { group: 'ees' } },
  { group: 'neet', cron: '0 8 1 1,4,7,10 *', title: 'NEET quarterly (ONS LFS + EES 16-17)', body: { group: 'neet' } },
  { group: 'context', cron: '0 7 1 * *', title: 'International context monthly (World Bank)', body: { group: 'context' } },
  { group: 'annual', cron: '0 9 15 5 *', title: 'Annual census + manual indicators', body: { group: 'annual', includeManual: true, force: true } },
];

function authorized(request: Request): boolean {
  const secret = env.POLICY_INGEST_SECRET;
  if (!secret) return true;
  return (request.headers.get('authorization') ?? '') === `Bearer ${secret}`;
}

export const POST: RequestHandler = async ({ request, url }) => {
  if (!authorized(request)) throw error(401, 'unauthorized');
  const origin = url.origin;
  const secret = env.POLICY_INGEST_SECRET;
  const results: Array<{ group: string; workflowId: string; action: string; cron: string }> = [];

  for (const cfg of GROUPS) {
    const name = `canvas:pe-track-${cfg.group}`;
    const existing = await db.select().from(workflows).where(eq(workflows.name, name)).limit(1);

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
        name,
        description: `Whitehall Model live-data tracker — ${cfg.title}`,
        trigger: { type: 'cron', config: { expression: cfg.cron } },
      });
      await db.insert(workflowNodes).values([
        { id: triggerId, workflowId, type: 'trigger', position: { x: 0, y: 80 }, label: 'Schedule', config: { kind: 'cron', cron: cfg.cron } },
        {
          id: httpId, workflowId, type: 'http-request', position: { x: 320, y: 80 }, label: `Refresh ${cfg.group}`,
          config: {
            method: 'POST',
            url: `${origin}/api/policy-engine/ingest`,
            headers: '{"content-type":"application/json"}',
            body: JSON.stringify(cfg.body),
            ...(secret ? { auth: 'bearer', authToken: secret } : { auth: 'none' }),
          },
        },
      ]);
      await db.insert(workflowEdges).values({ id: randomUUID(), workflowId, sourceNodeId: triggerId, targetNodeId: httpId });
      action = 'created';
    }

    // upsert the schedule (one per workflow) and register it live in this process
    const existingSched = await db.select().from(workflowSchedules).where(eq(workflowSchedules.workflowId, workflowId)).limit(1);
    let scheduleId: string;
    if (existingSched.length) {
      scheduleId = existingSched[0].id;
      await db.update(workflowSchedules).set({ type: 'cron', config: { expression: cfg.cron }, enabled: true }).where(eq(workflowSchedules.id, scheduleId));
    } else {
      scheduleId = randomUUID();
      await db.insert(workflowSchedules).values({ id: scheduleId, workflowId, type: 'cron', config: { expression: cfg.cron }, enabled: true });
    }
    registerCronJob({ id: scheduleId, workflowId, config: { expression: cfg.cron } });

    results.push({ group: cfg.group, workflowId, action, cron: cfg.cron });
  }

  return json({ seeded: results });
};
