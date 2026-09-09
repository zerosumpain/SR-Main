import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { jkaiBuildDeliveries, jkaiBuilds } from '$lib/db/schema';
import { desc, eq, sql } from 'drizzle-orm';
import { ensureDelivery } from '$lib/jkai/development-state.server';
import { PRODUCT_AREAS, RELEASE_POLICIES } from '$lib/jkai/development';
import type { ReleasePolicy } from '$lib/jkai/development';
import { SR_MAIN_GIT_TARGET } from '$lib/jkai/git-targets';
import { CHANGE_REQUEST_BUDGET } from '$lib/jkai/change-request';
import { resolveDevelopmentModel } from '$lib/jkai/development-models.server';
import type { RequestHandler } from './$types';

// /api/jkai inherits the owner gate in hooks.server.ts.
export const GET: RequestHandler = async () => {
  // The commissioned test runs in SQL, BEFORE the limit. Filtering a capped page
  // in JavaScript would drop rows the archive has already excluded, so a
  // feature could fall through the gap and appear in neither half of the page.
  // `IS DISTINCT FROM 'false'` is `isCommissioned` in SQL: absent means yes.
  const rows = await db.select({
    buildId: jkaiBuilds.id, title: jkaiBuilds.title, status: jkaiBuilds.status, outcome: jkaiBuilds.outcome,
    revision: jkaiBuildDeliveries.revision, state: jkaiBuildDeliveries.state,
  }).from(jkaiBuildDeliveries).innerJoin(jkaiBuilds, eq(jkaiBuilds.id, jkaiBuildDeliveries.buildId))
    .where(sql`${jkaiBuildDeliveries.state}->>'commissioned' IS DISTINCT FROM 'false'`)
    .orderBy(desc(jkaiBuildDeliveries.updatedAt)).limit(200);
  return json(rows);
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.outcome !== 'string' || !body.outcome.trim() || body.outcome.length > 20000) return json({ error: 'Describe the intended outcome (up to 20,000 characters).' }, { status: 400 });
  if (!PRODUCT_AREAS.includes(body.area)) return json({ error: 'Choose a product area.' }, { status: 400 });
  // Where a feature is allowed to stop is a permission, not a preference, so an
  // unrecognised value is refused rather than coerced to something safer-looking.
  const releasePolicy: ReleasePolicy = body.releasePolicy === undefined ? 'preview_only' : body.releasePolicy;
  if (!RELEASE_POLICIES.includes(releasePolicy)) return json({ error: 'Choose where this feature should stop.' }, { status: 400 });
  let model;
  try { model = await resolveDevelopmentModel(body.modelId); }
  catch (e) { return json({ error: (e as Error).message }, { status: 400 }); }
  const [build] = await db.insert(jkaiBuilds).values({
    title: body.outcome.trim().split('\n')[0].slice(0, 100), prompt: body.outcome.trim(), status: 'paused',
    origin: 'manual', planStatus: 'approved', gitTargetConfig: { ...SR_MAIN_GIT_TARGET, openPr: false },
    budgetConfig: { ...CHANGE_REQUEST_BUDGET }, modelProvider: model.provider, modelId: model.modelId,
  }).returning();
  await ensureDelivery(build.id, body.area, [], {
    commissioned: true,
    releasePolicy,
    autopilot: body.autopilot === true,
    maxRounds: typeof body.maxRounds === 'number' ? body.maxRounds : undefined,
  });
  return json({ buildId: build.id }, { status: 201 });
};
