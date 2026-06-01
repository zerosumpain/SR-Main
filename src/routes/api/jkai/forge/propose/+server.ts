import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { db } from '$lib/db';
import { jkaiBuilds } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { builderClient } from '$lib/jkai/builder-client';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { snapshotPrice } from '$lib/server/models/price-snapshot';

// Owner allowlist — mirrors getAllowedEmails() in src/hooks.server.ts and
// /api/auth/me (the AUTH_ALLOWED_EMAILS env var, comma-separated, lower-cased
// for comparison).
function allowedEmails(): string[] {
  return (env.AUTH_ALLOWED_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

// Hard scope: the Forge may only ever drive the brass-and-rails game repo.
const ALLOWED_REPO = 'brass-and-rails';
const FORGE_GIT_TARGET = {
  repoUrl: 'git@github.com:zerosumpain/brass-and-rails.git',
  baseBranch: 'master',
  branchPrefix: 'forge/',
  gateCommand: 'npm run gate',
  openPr: true,
  prTitlePrefix: 'Forge: ',
} as const;

/**
 * POST /api/jkai/forge/propose — owner-gated. Creates a git-target jkai build
 * that autonomously extends the brass-and-rails game on a branch, runs the
 * gate, and opens a PR for human merge. Hard-scoped to brass-and-rails.
 *
 * Body: { repo: 'brass-and-rails', prompt: string, trigger?: string }
 * Returns: { buildId }
 */
export const POST: RequestHandler = async ({ request, locals }) => {
  const session = await locals.auth();
  const email = (session?.user?.email || '').toLowerCase();
  const isOwner = !!email && allowedEmails().includes(email);
  if (!isOwner) {
    return json({ error: 'forbidden' }, { status: 403 });
  }

  let body: { repo?: unknown; prompt?: unknown; trigger?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const { repo, prompt, trigger } = body;

  // Hard scope — reject anything that isn't the one allowed repo.
  if (repo !== ALLOWED_REPO) {
    return json({ error: `repo must be '${ALLOWED_REPO}'` }, { status: 400 });
  }
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

  const ctx = await resolveDefaultModel('builder');
  const priceSnapshot = await snapshotPrice(ctx);

  const title = typeof trigger === 'string' && trigger
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
  } catch (err: any) {
    await db.update(jkaiBuilds).set({ status: 'failed' }).where(eq(jkaiBuilds.id, build.id));
    return json(
      { error: `Build created but failed to start: ${err.message}`, buildId: build.id },
      { status: 500 },
    );
  }

  return json({ buildId: build.id }, { status: 201 });
};
