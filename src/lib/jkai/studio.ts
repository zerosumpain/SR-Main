/**
 * Studio build creator.
 *
 * Mirrors `forge.ts`: one place that creates a preconfigured build so every
 * entry point — the API route, the `studio_build` chat tool, the builds UI —
 * produces an identical row.
 *
 * A Studio build turns a challenge statement into a multi-chapter interactive
 * explainer published at /projects/<slug>/. See
 * docs/superpowers/specs/2026-08-10-jkai-studio-explainer-builds-design.md
 */
import { db } from '$lib/db';
import { jkaiBuilds } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { builderClient } from '$lib/jkai/builder-client';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { snapshotPrice } from '$lib/server/models/price-snapshot';
import type { BudgetConfig } from './types';

/**
 * Deeper than the app default (25 iterations / 1M tokens per hour / 120 min).
 *
 * The tokens-per-hour rise is the load-bearing change. `checkBudget` sums every
 * iteration in the trailing hour, failed ones included — correctly, after build
 * #126 spent 3.08M tokens across three iterations while only one completed
 * iteration's 490k was visible. But a chapter is a large unit of work, and at
 * 1M/hour a single 800k chapter sleeps the build for the rest of the hour.
 *
 * maxCostUsd is the real backstop and the number to tune: 15 is a first guess,
 * not a measurement. Calibrate on the first three builds.
 */
export const STUDIO_BUDGET: BudgetConfig = Object.freeze({
  maxIterations: 20,
  maxTotalMinutes: 480,
  maxTokensPerHour: 3_000_000,
  maxTokensPerIteration: 900_000,
  activeMinutesPerHour: 50,
  maxCostUsd: 15,
  maxIdleIterations: 3,
});

/**
 * Input caps live here, not on the route.
 *
 * There are two entry points and only one of them is an HTTP route: the
 * `studio_build` chat tool is registered in the `builds` toolset, so a running
 * build's own agent can start a Studio build over the tool bridge without ever
 * touching /api/jkai/studio's validation. Capping in the shared creator is the
 * only place both inherit it. Throw rather than truncate — a silently halved
 * challenge produces a confidently wrong syllabus, and the caller cannot tell.
 */
export const MAX_CHALLENGE_LEN = 4_000;
export const MAX_TITLE_LEN = 200;

export async function createStudioBuild({
  challenge,
  title,
}: {
  challenge: string;
  title?: string;
}): Promise<{ buildId: string }> {
  const trimmed = challenge.trim();
  if (!trimmed) throw new Error('createStudioBuild: challenge is required');
  if (trimmed.length > MAX_CHALLENGE_LEN) {
    throw new Error(
      `createStudioBuild: challenge too long (${trimmed.length} chars, max ${MAX_CHALLENGE_LEN})`,
    );
  }
  const trimmedTitle = title?.trim();
  if (trimmedTitle && trimmedTitle.length > MAX_TITLE_LEN) {
    throw new Error(
      `createStudioBuild: title too long (${trimmedTitle.length} chars, max ${MAX_TITLE_LEN})`,
    );
  }

  const ctx = await resolveDefaultModel();
  const priceSnapshot = await snapshotPrice(ctx);

  const [build] = await db
    .insert(jkaiBuilds)
    .values({
      title: trimmedTitle || `Studio: ${trimmed.slice(0, 60)}`,
      prompt: trimmed,
      origin: 'studio',
      // Design enforcement stays ON. Only the mounted worked example changes —
      // the linter was never the problem, the admin-list-page reference was.
      enforceDesignSystem: true,
      // No human approval gate: the research brief and the plan self-approve.
      planStatus: 'approved',
      budgetConfig: { ...STUDIO_BUDGET },
      chapterPlan: [],
      modelProvider: ctx.provider,
      modelId: ctx.modelId,
      priceSnapshot,
    } as never)
    .returning();

  try {
    await builderClient.startBuild(build.id);
  } catch (err) {
    await db.update(jkaiBuilds).set({ status: 'failed' }).where(eq(jkaiBuilds.id, build.id));
    throw err;
  }

  return { buildId: build.id };
}
