/**
 * Git targets an autonomous build may drive.
 *
 * The Forge's target lives in `$lib/jkai/forge.ts` and is deliberately pinned
 * to one game repo. This module adds SR-Main — the site's own repo — which is a
 * materially bigger deal: a merged PR here auto-deploys to production via
 * `.github/workflows/ci.yml`. The safety model is therefore layered, and the
 * layers matter more than this const:
 *
 *   1. `openPr: true` with NO auto-merge in the build itself. The agent's output
 *      is always a proposal — same contract as the Forge.
 *   2. `gateCommand` runs per iteration, so the agent gets `npm run gate`
 *      feedback while it works rather than discovering breakage in CI.
 *   3. The `risk-tier` CI job classifies every PR against
 *      `.github/protected-paths.txt`. Auth, schema, deploy scripts and the
 *      agent's own safety rails are tier=high and are never auto-merged.
 *
 * Prerequisite before this can actually be driven from the VPS: opening a PR
 * needs a GitHub token. The VPS authenticates to GitHub with a DEPLOY KEY
 * (verified 2026-07-25: `ssh -T git@github.com` returns "Hi zerosumpain/SR-Main!"),
 * which can push but cannot call the REST API, and `gh` is not installed there.
 * So `finalizeGitTarget` will push the branch and then fail to open the PR until
 * `FORGE_GITHUB_TOKEN` is set in the VPS env — a fine-grained PAT scoped to
 * SR-Main with contents:write + pull_requests:write.
 */
import type { GitTargetConfig } from '$lib/jkai/sandbox';

/**
 * The site's own repo. `branchPrefix` is 'agent/' so these are distinguishable
 * from the Forge's 'forge/' branches and from hand-cut ones at a glance.
 */
export const SR_MAIN_GIT_TARGET = {
  repoUrl: 'git@github.com:zerosumpain/SR-Main.git',
  baseBranch: 'master',
  branchPrefix: 'agent/',
  gateCommand: 'npm run gate',
  openPr: true,
  prTitlePrefix: 'Agent: ',
} as const satisfies GitTargetConfig;

/**
 * Every git target a build is allowed to drive, by key. Anything not in here is
 * rejected — the caller must not accept a caller-supplied `repoUrl`, or the
 * build system becomes a "push to any repo the host key can reach" primitive.
 */
export const ALLOWED_GIT_TARGETS = {
  'sr-main': SR_MAIN_GIT_TARGET,
} as const;

export type GitTargetKey = keyof typeof ALLOWED_GIT_TARGETS;

/** Resolve a target by key, or null when the key is not allow-listed. */
export function resolveGitTarget(key: string): GitTargetConfig | null {
  return (ALLOWED_GIT_TARGETS as Record<string, GitTargetConfig>)[key] ?? null;
}
