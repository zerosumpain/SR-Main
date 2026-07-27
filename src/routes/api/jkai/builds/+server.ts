import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { jkaiBuilds } from '$lib/db/schema';
import { desc } from 'drizzle-orm';
import { builderClient } from '$lib/jkai/builder-client';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { snapshotPrice } from '$lib/server/models/price-snapshot';
import type { ModelContext } from '$lib/server/models/types';

export const GET: RequestHandler = async () => {
  const builds = await db.select().from(jkaiBuilds).orderBy(desc(jkaiBuilds.createdAt));
  return json(builds);
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const {
    prompt,
    title,
    budgetConfig,
    modelProvider,
    modelId,
    enforceDesignSystem,
    planFirst,
    thinkingLevel,
    enabledToolsets,
    conversationId,
    attachedWorkflowIds,
  } = body;
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
    ctx = await resolveDefaultModel();
  }

  const priceSnapshot = await snapshotPrice(ctx);

  const insert: Record<string, unknown> = {
    title: title || null,
    prompt,
    budgetConfig: { ...DEFAULT_BUDGET, ...(budgetConfig || {}) },
    modelProvider: ctx.provider,
    modelId: ctx.modelId,
    priceSnapshot,
  };
  if (typeof enforceDesignSystem === 'boolean') insert.enforceDesignSystem = enforceDesignSystem;
  if (typeof planFirst === 'boolean') insert.planStatus = planFirst ? 'pending' : 'approved';
  if (typeof thinkingLevel === 'string') {
    const allowed = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']);
    if (allowed.has(thinkingLevel)) insert.thinkingLevel = thinkingLevel;
  }
  if (Array.isArray(enabledToolsets) && enabledToolsets.every((s) => typeof s === 'string') && enabledToolsets.length > 0) {
    insert.enabledToolsets = enabledToolsets;
  }
  if (typeof conversationId === 'string' && conversationId.length > 0) {
    insert.conversationId = conversationId;
  }
  if (Array.isArray(attachedWorkflowIds) && attachedWorkflowIds.every((s) => typeof s === 'string')) {
    insert.attachedWorkflowIds = attachedWorkflowIds;
  }

  const [build] = await db.insert(jkaiBuilds).values(insert as any).returning();

  try {
    await builderClient.startBuild(build.id);
  } catch (err: any) {
    // Build record created but the builder couldn't be reached — surface as
    // failed. (The orchestrator no longer throws when another build is active;
    // it queues instead. So this catch only fires on transport/init errors.)
    const { eq } = await import('drizzle-orm');
    await db.update(jkaiBuilds).set({ status: 'failed' }).where(eq(jkaiBuilds.id, build.id));
    return json({ error: `Build created but failed to start: ${err.message}` }, { status: 500 });
  }

  // Re-read so the response reflects the orchestrator's decision (running vs queued).
  const { eq } = await import('drizzle-orm');
  const [refreshed] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, build.id));
  return json(refreshed ?? build, { status: 201 });
};
