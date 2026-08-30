import { json } from '@sveltejs/kit';
import { DEFAULT_BUILD_BUDGET } from '$lib/jkai/budget';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { jkaiBuilds } from '$lib/db/schema';
import { getBuildList } from '$lib/jkai/queries';
import { builderClient } from '$lib/jkai/builder-client';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { snapshotPrice } from '$lib/server/models/price-snapshot';
import type { ModelContext } from '$lib/server/models/types';
import { resolveGitTarget, ALLOWED_GIT_TARGETS } from '$lib/jkai/git-targets';

export const GET: RequestHandler = async () => {
  // Shared list projection — see `getBuildList`. The canvas builder panel polls
  // this on a timer, so the full row went over the wire every few seconds to
  // find the one or two builds that are still running.
  return json(await getBuildList());
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
    gitTarget,
  } = body;
  /*
   * THE LANE, which this endpoint previously could not express at all.
   *
   * An app build and a repo build are different things and the difference is
   * fixed before the first token: `git_target_config` is what separates them.
   * Until now only two code paths ever set it — `createChangeRequest` and
   * `forge.ts` — so `POST /api/jkai/builds` was app-lane ALWAYS, and a prompt
   * typed at /jkai/builds/new asking for a change to the site could not produce
   * one however it was worded. There was no wrong choice being made; there was
   * no choice. Build dd2dcc57 spent five iterations and 2.8M tokens writing a
   * standalone `python3 server.py` imitation of a site page because of it.
   *
   * Allow-listed by KEY, never by a caller-supplied repoUrl — otherwise the
   * build system becomes a "push to any repo the host key can reach" primitive,
   * which is the whole reason `ALLOWED_GIT_TARGETS` exists.
   *
   * This does NOT let a build escalate itself. `request_change` is
   * `destructive: true` and `invokeTool` refuses destructive tools, so the
   * bridge cannot reach this route; and the route is owner-gated by Auth.js
   * like the rest of /api/jkai. Widening the lane is a decision a human makes
   * at the point of starting the build, which is exactly where it belongs.
   */
  let gitTargetConfig: unknown = null;
  if (gitTarget !== undefined && gitTarget !== null && gitTarget !== '') {
    if (typeof gitTarget !== 'string') {
      return json({ error: 'gitTarget must be a string key' }, { status: 400 });
    }
    const resolved = resolveGitTarget(gitTarget);
    if (!resolved) {
      return json(
        {
          error: `unknown gitTarget '${gitTarget}' — allowed: ${Object.keys(ALLOWED_GIT_TARGETS).join(', ')}`,
        },
        { status: 400 },
      );
    }
    gitTargetConfig = resolved;
  }

  if (!prompt || typeof prompt !== 'string') {
    return json({ error: 'prompt is required' }, { status: 400 });
  }
  const MAX_PROMPT_LEN = 20_000;
  if (prompt.length > MAX_PROMPT_LEN) {
    return json({ error: `prompt too long (max ${MAX_PROMPT_LEN} chars)` }, { status: 400 });
  }

  const DEFAULT_BUDGET = { ...DEFAULT_BUILD_BUDGET };

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
  // Left NULL for an app build. `git_target_config IS NOT NULL` is NOT the test
  // for a repo build anywhere else in the codebase — 44 of 82 matching rows hold
  // the JSON literal `null` — so writing the key only when a lane was actually
  // chosen keeps this endpoint out of that trap rather than adding to it.
  if (gitTargetConfig) insert.gitTargetConfig = gitTargetConfig;

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
