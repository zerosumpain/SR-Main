/**
 * Shared Forge build-creator.
 *
 * The Forge drives autonomous git-target jkai builds against the brass-and-rails
 * game repo: clone → branch → agent edits → `npm run gate` → push → PR (no
 * auto-merge). This module owns the build-creation logic so BOTH the owner-gated
 * `POST /api/jkai/forge/propose` route and the cron/autonomous forge scheduler
 * create builds identically.
 *
 * Hard scope lives in the route (it rejects anything that isn't the one allowed
 * repo); the const here is the only git target the Forge ever uses.
 */
import { db } from '$lib/db';
import { jkaiBuilds } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { builderClient } from '$lib/jkai/builder-client';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { snapshotPrice } from '$lib/server/models/price-snapshot';

// The Forge may only ever drive the brass-and-rails game repo.
export const FORGE_GIT_TARGET = {
  repoUrl: 'git@github.com:zerosumpain/brass-and-rails.git',
  baseBranch: 'master',
  branchPrefix: 'forge/',
  gateCommand: 'npm run gate',
  openPr: true,
  prTitlePrefix: 'Forge: ',
} as const;

const DEFAULT_BUDGET = {
  maxIterations: 25,
  maxTotalMinutes: 120,
  // Total tokens, not output tokens — one ordinary iteration costs ~1M of
  // them, so 1M here stalled a build after its first. See change-request.ts.
  maxTokensPerHour: 3_000_000,
  activeMinutesPerHour: 45,
};

/**
 * Create + start a Forge git-target jkai build. Inserts the `jkai_builds` row
 * (origin='forge', the FORGE_GIT_TARGET git target, no design-system gate, plan
 * pre-approved, default budget, builder default model + price snapshot) then
 * hands it to the builder sidecar via `startBuild`. On start failure the build
 * is marked failed and the error rethrown.
 *
 * @param prompt  the agent directive (scheduled directive, or the autonomous
 *                ROADMAP template — caller decides).
 * @param trigger optional source label folded into the title, e.g. 'scheduled'
 *                or 'autonomous' or 'manual'.
 */
export async function createForgeBuild({
  prompt,
  trigger,
}: {
  prompt: string;
  trigger?: string;
}): Promise<{ buildId: string }> {
  const ctx = await resolveDefaultModel();
  const priceSnapshot = await snapshotPrice(ctx);

  const title = trigger
    ? `Forge (${trigger}): ${prompt.slice(0, 60)}`
    : `Forge: ${prompt.slice(0, 60)}`;

  const [build] = await db
    .insert(jkaiBuilds)
    .values({
      title,
      prompt,
      origin: 'forge',
      // Git-target mode: the entire flagged builder path keys off this column.
      gitTargetConfig: { ...FORGE_GIT_TARGET },
      // The game owns its own design checks (inside `npm run gate`); the SR
      // warm-brutalist linter doesn't apply to the game's source tree.
      enforceDesignSystem: false,
      // No plan-approval gate — go straight to iterating.
      planStatus: 'approved',
      budgetConfig: DEFAULT_BUDGET,
      modelProvider: ctx.provider,
      modelId: ctx.modelId,
      priceSnapshot,
    } as any)
    .returning();

  try {
    await builderClient.startBuild(build.id);
  } catch (err) {
    await db.update(jkaiBuilds).set({ status: 'failed' }).where(eq(jkaiBuilds.id, build.id));
    throw err;
  }

  return { buildId: build.id };
}
