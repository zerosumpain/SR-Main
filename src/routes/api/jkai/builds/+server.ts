import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { jkaiBuilds, openrouterModels } from '$lib/db/schema';
import { desc, eq } from 'drizzle-orm';
import { orchestrator } from '$lib/jkai/orchestrator';
import { resolveDefaultModel } from '$lib/server/models/settings';
import type { ModelContext } from '$lib/server/models/types';

export const GET: RequestHandler = async () => {
  const builds = await db.select().from(jkaiBuilds).orderBy(desc(jkaiBuilds.createdAt));
  return json(builds);
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const { prompt, title, budgetConfig, modelProvider, modelId } = body;
  if (!prompt || typeof prompt !== 'string') {
    return json({ error: 'prompt is required' }, { status: 400 });
  }
  const MAX_PROMPT_LEN = 20_000;
  if (prompt.length > MAX_PROMPT_LEN) {
    return json({ error: `prompt too long (max ${MAX_PROMPT_LEN} chars)` }, { status: 400 });
  }

  const DEFAULT_BUDGET = {
    maxIterations: 25,
    maxTotalMinutes: 120,
    maxTokensPerHour: 1_000_000,
    activeMinutesPerHour: 45,
  };

  let ctx: ModelContext;
  if (modelProvider && modelId) {
    ctx = { provider: modelProvider, modelId };
  } else {
    ctx = await resolveDefaultModel('builder');
  }

  let priceSnapshot: { promptPrice: number; completionPrice: number } | null = null;
  if (ctx.provider === 'openrouter') {
    const [row] = await db
      .select()
      .from(openrouterModels)
      .where(eq(openrouterModels.id, ctx.modelId))
      .limit(1);
    if (row) {
      priceSnapshot = {
        promptPrice: Number(row.promptPrice ?? 0),
        completionPrice: Number(row.completionPrice ?? 0),
      };
    }
  }

  const [build] = await db.insert(jkaiBuilds).values({
    title: title || null,
    prompt,
    budgetConfig: { ...DEFAULT_BUDGET, ...(budgetConfig || {}) },
    modelProvider: ctx.provider,
    modelId: ctx.modelId,
    priceSnapshot,
  }).returning();

  try {
    await orchestrator.startBuild(build.id);
  } catch (err: any) {
    // Build record created but orchestrator failed to start — update status
    await db.update(jkaiBuilds).set({ status: 'failed' }).where(
      (await import('drizzle-orm')).eq(jkaiBuilds.id, build.id),
    );
    return json({ error: `Build created but failed to start: ${err.message}` }, { status: 500 });
  }

  return json(build, { status: 201 });
};
