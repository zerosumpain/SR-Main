import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { jkaiBuildDeliveries, jkaiBuilds } from '$lib/db/schema';
import { desc, eq } from 'drizzle-orm';
import { ensureDelivery } from '$lib/jkai/development-state.server';
import { PRODUCT_AREAS } from '$lib/jkai/development';
import { SR_MAIN_GIT_TARGET } from '$lib/jkai/git-targets';
import { CHANGE_REQUEST_BUDGET } from '$lib/jkai/change-request';
import { resolveBuilderModel } from '$lib/server/models/workload-settings';
import type { RequestHandler } from './$types';

// /api/jkai inherits the owner gate in hooks.server.ts.
export const GET: RequestHandler = async () => json(await db.select({
  buildId: jkaiBuilds.id, title: jkaiBuilds.title, status: jkaiBuilds.status, outcome: jkaiBuilds.outcome,
  revision: jkaiBuildDeliveries.revision, state: jkaiBuildDeliveries.state,
}).from(jkaiBuildDeliveries).innerJoin(jkaiBuilds, eq(jkaiBuilds.id, jkaiBuildDeliveries.buildId))
  .orderBy(desc(jkaiBuildDeliveries.updatedAt)).limit(100));

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.outcome !== 'string' || !body.outcome.trim() || body.outcome.length > 20000) return json({ error: 'Describe the intended outcome (up to 20,000 characters).' }, { status: 400 });
  if (!PRODUCT_AREAS.includes(body.area)) return json({ error: 'Choose a product area.' }, { status: 400 });
  const model = await resolveBuilderModel();
  const [build] = await db.insert(jkaiBuilds).values({
    title: body.outcome.trim().split('\n')[0].slice(0, 100), prompt: body.outcome.trim(), status: 'paused',
    origin: 'manual', planStatus: 'approved', gitTargetConfig: { ...SR_MAIN_GIT_TARGET, openPr: false },
    budgetConfig: { ...CHANGE_REQUEST_BUDGET }, modelProvider: model.provider, modelId: model.modelId,
  }).returning();
  await ensureDelivery(build.id, body.area);
  return json({ buildId: build.id }, { status: 201 });
};
