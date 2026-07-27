/**
 * Change-request builds: the issue → branch → gate → PR cycle against the
 * site's own repo.
 *
 * Mirrors `createForgeBuild` (which drives the game repo) but targets SR-Main,
 * and threads a GitHub issue through the whole run so the work is
 * self-documenting: the issue holds the ask, the build comments progress onto
 * it, and the PR body closes it.
 *
 * The safety model is NOT in this file — it is the layers around it: the build
 * only ever opens a PR (never merges), `npm run gate` runs per iteration, and
 * the `risk-tier` CI job refuses to auto-merge anything touching
 * `.github/protected-paths.txt`. See `$lib/jkai/git-targets`.
 */
import { db } from '$lib/db';
import { jkaiBuilds } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { builderClient } from '$lib/jkai/builder-client';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { snapshotPrice } from '$lib/server/models/price-snapshot';
import { SR_MAIN_GIT_TARGET } from '$lib/jkai/git-targets';
import { createIssue, commentOnIssue, githubConfigured, REPO_SLUG } from '$lib/github/issues';

const DEFAULT_BUDGET = {
  maxIterations: 25,
  maxTotalMinutes: 120,
  maxTokensPerHour: 1_000_000,
  activeMinutesPerHour: 45,
};

export interface ChangeRequestResult {
  buildId: string;
  issueNumber: number;
  issueUrl: string;
}

/**
 * Open an issue for `request`, then start a git-target build that implements it.
 *
 * @param title    short issue title — what is being asked for.
 * @param request  the full ask, in the requester's words. Preserved verbatim in
 *                 the issue body so the original intent survives, and handed to
 *                 the agent as its directive.
 * @param labels   optional issue labels.
 */
export async function createChangeRequest({
  title,
  request,
  labels,
}: {
  title: string;
  request: string;
  labels?: string[];
}): Promise<ChangeRequestResult> {
  if (!githubConfigured()) {
    throw new Error(
      'GitHub is not configured — set GITHUB_API_TOKEN (fine-grained PAT scoped to ' +
        `${REPO_SLUG}) before requesting changes.`,
    );
  }

  // The issue first: if this fails we have created nothing, whereas a build
  // without an issue would be an orphan with no record of why it exists.
  const issue = await createIssue({
    title,
    body: [
      request,
      '',
      '---',
      '',
      'Opened automatically as a change request. An autonomous build will branch from',
      `\`${SR_MAIN_GIT_TARGET.baseBranch}\`, implement this, run \`${SR_MAIN_GIT_TARGET.gateCommand}\`,`,
      'and open a pull request that closes this issue.',
      '',
      'It will **not** merge itself. If the change touches a path listed in',
      '`.github/protected-paths.txt` (auth, schema, deploy, CI, agent safety rails)',
      'the `risk-tier` job marks it high and a human reviews it.',
    ].join('\n'),
    labels: labels ?? ['change-request'],
  });

  const ctx = await resolveDefaultModel();
  const priceSnapshot = await snapshotPrice(ctx);

  // The agent's directive: the ask, plus the issue to close. `Closes #n` is also
  // appended to the PR body from gitTargetConfig.issueNumber, so the link holds
  // even if the agent's own summary omits it.
  const prompt = [
    request,
    '',
    `This work implements GitHub issue #${issue.number} (${issue.url}).`,
    `Reference "Closes #${issue.number}" in your summary.`,
  ].join('\n');

  const [build] = await db
    .insert(jkaiBuilds)
    .values({
      title: `Change request #${issue.number}: ${title.slice(0, 60)}`,
      prompt,
      origin: 'change-request',
      gitTargetConfig: { ...SR_MAIN_GIT_TARGET, issueNumber: issue.number },
      // This IS the SR site, so the warm-brutalist design linter applies here
      // (unlike the Forge, whose game repo owns its own checks).
      enforceDesignSystem: true,
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
    // Leave a trail on the issue rather than failing silently — otherwise the
    // issue sits there looking like work is underway when nothing is running.
    await commentOnIssue(
      issue.number,
      `⚠️ Build \`${build.id}\` failed to start: ${err instanceof Error ? err.message : String(err)}`,
    ).catch(() => {});
    throw err;
  }

  await commentOnIssue(
    issue.number,
    [
      `🤖 Build [\`${build.id}\`](https://strangeramblings.com/jkai/builds/${build.id}) started.`,
      '',
      `Branch prefix \`${SR_MAIN_GIT_TARGET.branchPrefix}\`, gate \`${SR_MAIN_GIT_TARGET.gateCommand}\`.`,
      'A pull request will appear here when it has something that passes.',
    ].join('\n'),
  ).catch(() => {});

  return { buildId: build.id, issueNumber: issue.number, issueUrl: issue.url };
}
