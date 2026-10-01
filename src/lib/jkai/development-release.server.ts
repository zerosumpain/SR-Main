/**
 * From an accepted candidate to a pull request, and then to a serving commit.
 *
 * The develop lane stops at a batch that nothing pushes: the broker keeps a
 * private git repository under its own volume, `git init`-ed from an archive of
 * the release sha, and accepted candidates are merged into that. It has no
 * remote, no network and no token, and its history shares no ancestor with
 * `origin/master`. Pushing that branch would present the entire tree as changed
 * and produce a pull request nobody can read.
 *
 * So the release takes the one thing that IS meaningful — the candidate's diff
 * against its own base — and replays it onto a fresh clone of master in the
 * builder's own shell, where `FORGE_GITHUB_TOKEN` exists. That is the same
 * token, the same remote and the same `openPullRequest` ($lib/github/pr) the change-request
 * lane has used since the Forge, so nothing new gets a credential.
 *
 * What this module deliberately cannot do:
 *
 *  - **Merge.** CI merges, and only a `tier=low` pull request from an `agent/`
 *    branch with `AUTOMERGE_TOKEN` set. Anything touching
 *    `.github/protected-paths.txt` — auth, secrets, the deploy path, the
 *    agent's own rails — is `tier=high` and waits for a human. That policy is
 *    the reviewed control and this code does not get a second one.
 *  - **Force anything.** A patch that does not apply cleanly to current master
 *    stops with the reason. Master has moved on; that is a rebase for a person.
 *  - **Run without permission.** `releasePolicy` is `preview_only` unless the
 *    owner chose otherwise when commissioning the feature.
 */
import { db } from '$lib/db';
import { jkaiBuilds } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { execInSandbox } from './sandbox';
import { emitLog } from './log-emitter';
import { loadDelivery, mutateDelivery } from './development-state.server';
import { workspaceBroker } from './development-workspace.server';
import { criterionResult, releaseBlocker, type DeliveryState } from './development';
import { SR_MAIN_GIT_TARGET } from './git-targets';
import { openPullRequest, closePullRequest, repoSlugFromUrl } from '$lib/github/pr';
import { redactGitHubSecrets } from '$lib/github/redact';

/** `owner/repo` of the target, derived rather than restated so the release and
 *  the change-request lane cannot disagree about where the site lives. */
const REPO = repoSlugFromUrl(SR_MAIN_GIT_TARGET.repoUrl);

/** Big enough for a real feature, small enough that a runaway diff is refused. */
const MAX_PATCH_BYTES = 4_000_000;

/**
 * A branch per CANDIDATE, not per build.
 *
 * The alternative — one branch reused for every attempt — needs a force push,
 * and `--force-with-lease` has no lease to check here: the clone is
 * `--depth 1 --branch master`, so there is never a remote-tracking ref for this
 * branch and the push refuses. Naming the revision means a plain push always
 * works, a re-release after a closed pull request is a new proposal rather than
 * a rewrite of the old one, and the branch says which candidate it carries.
 */
export function releaseBranchFor(buildId: string, revision: string, attempt = 0): string {
  // A candidate re-released after its red pull request was closed needs a new
  // branch: the old one still holds the previous commit, and a plain push of a
  // fresh commit onto it is a non-fast-forward.
  return `${SR_MAIN_GIT_TARGET.branchPrefix}dev-${buildId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)}-${revision.slice(0, 8)}${attempt ? `-r${attempt}` : ''}`;
}

function tokenRemote(token: string): string {
  return `https://x-access-token:${token}@github.com/${REPO}.git`;
}

export function prBody(input: { outcome: string; criteria: Array<{ text: string; verdict: string; evidence: string }>; gateEvidence: string; buildId: string; independent: boolean; tier?: 'low' | 'high'; protectedPaths?: string[] }): string {
  return [
    'Autonomous site development, proposed from `/jkai/develop`.',
    '',
    ...(input.tier === 'high' ? [`**Needs owner review:** this change touches protected paths, so CI will not merge it — ${(input.protectedPaths ?? []).slice(0, 12).map(p => `\`${p}\``).join(', ') || 'see the Risk tier check'}.`, ''] : []),
    `**Outcome:** ${input.outcome.slice(0, 1500)}`,
    '',
    '**Acceptance criteria and the evidence behind each verdict:**',
    ...input.criteria.map(c => `- **${c.verdict}** — ${c.text}\n  ${c.evidence.slice(0, 500)}`),
    '',
    `**Repository verification:** ${input.gateEvidence}`,
    '',
    input.independent
      ? 'Criteria were judged by a reviewer model separate from the one that wrote the change.'
      : 'No separate adversary model is pinned, so the criteria were judged by the same model that wrote the change. Treat the verdicts as self-reported.',
    '',
    `Workspace: /jkai/develop/${input.buildId}`,
  ].join('\n');
}

/**
 * Push the accepted candidate as a branch and open its pull request.
 *
 * Idempotent: a delivery that already has a pull request for this exact
 * candidate returns it rather than opening a second one.
 */
export async function releaseDevelopment(buildId: string, expectedRevision: number): Promise<{ prUrl: string; branch: string }> {
  const delivery = await loadDelivery(buildId);
  if (!delivery || delivery.revision !== expectedRevision) throw new Error('The workspace changed; reload before releasing.');
  const state = delivery.state;
  const blocker = releaseBlocker(state);
  if (blocker) throw new Error(blocker);
  const candidate = state.candidate!;
  if (state.release?.prUrl && state.release.revision === candidate) {
    return { prUrl: state.release.prUrl, branch: state.release.branch ?? releaseBranchFor(buildId, candidate) };
  }
  const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, buildId));
  if (!build) throw new Error('Build not found');
  if (['running', 'queued'].includes(build.status)) throw new Error('Pause the build before releasing its candidate.');

  const token = process.env.FORGE_GITHUB_TOKEN;
  if (!token) throw new Error('Releasing needs FORGE_GITHUB_TOKEN on this host. The candidate and its batch are unchanged.');

  const branch = releaseBranchFor(buildId, candidate, state.release?.supersededPrs?.length ?? 0);
  // History survives a new release: the superseded list is what numbers the
  // next branch, and the failed revision is what stops an unchanged re-release.
  await mutateDelivery(buildId, 'release_started', s => ({ ...s, release: { revision: candidate, branch, requestedAt: new Date().toISOString(), supersededPrs: s.release?.supersededPrs, failedRevision: s.release?.failedRevision, detail: 'Replaying the candidate onto a fresh clone of master.' } }), expectedRevision);

  try {
    // The full diff, not the review excerpt: /snapshot and /inspect cap their
    // patches at 20k and 40k characters, which is a reading aid, not a release
    // artefact. Applying a truncated patch would silently ship half a feature.
    //
    // The broker writes it to the workspace both processes can see, rather than
    // returning it: a megabyte of patch does not fit through `execInSandbox`,
    // whose exec buffer is 5MB and whose command is itself base64-enveloped.
    const patchResult = (await workspaceBroker('patch', buildId, { revision: candidate })) as unknown as { path?: string; bytes?: number };
    const patchPath = patchResult.path ?? '';
    const bytes = patchResult.bytes ?? 0;
    if (!patchPath || !bytes) throw new Error('The accepted candidate contains no changes against its base.');
    if (bytes > MAX_PATCH_BYTES) throw new Error(`The candidate's diff is ${bytes} bytes, past the ${MAX_PATCH_BYTES}-byte release limit. Split the feature.`);

    const root = `/home/jkai/workspace/${buildId}/release`;
    const prepared = await execInSandbox(
      `rm -rf ${root} && mkdir -p ${root} && ` +
        `git clone --depth 1 --branch ${SR_MAIN_GIT_TARGET.baseBranch} ${tokenRemote(token)} ${root}/repo 2>&1 && ` +
        `cd ${root}/repo && git remote set-url origin ${SR_MAIN_GIT_TARGET.repoUrl} && ` +
        `git config user.name "jkai develop" && git config user.email "builder@strangeramblings.com" && ` +
        `git checkout -b ${branch} 2>&1`,
      300_000,
    );
    if (prepared.exitCode !== 0) throw new Error(redactGitHubSecrets(`Could not prepare a master clone: ${prepared.stdout}\n${prepared.stderr}`, token).slice(0, 1200));

    const applied = await execInSandbox(
      `cd ${root}/repo && git apply --index --whitespace=nowarn ${patchPath} 2>&1`,
      180_000,
    );
    if (applied.exitCode !== 0) {
      throw new Error(
        `The candidate does not apply to current master, so it needs a rebase before release. ` +
          `Master has moved since this feature branched. git said: ${redactGitHubSecrets(applied.stdout + applied.stderr, token).slice(0, 800)}`,
      );
    }

    // CI's own classifier, run on the same change before anyone sees it, so a
    // protected-path change is known to need a person from the moment the pull
    // request exists instead of sitting green and unmerged with no explanation.
    const risk = await classifyRelease(root);

    const title = `Develop: ${(build.title ?? state.brief.outcome ?? 'site feature').replace(/\s+/g, ' ').trim().slice(0, 110)}`;
    const titleB64 = Buffer.from(title, 'utf8').toString('base64');
    const committed = await execInSandbox(
      `cd ${root}/repo && git commit -m "$(echo '${titleB64}' | base64 -d)" 2>&1 && ` +
        `git push ${tokenRemote(token)} ${branch} 2>&1`,
      300_000,
    );
    if (committed.exitCode !== 0) throw new Error(redactGitHubSecrets(`Could not push the release branch: ${committed.stdout}\n${committed.stderr}`, token).slice(0, 1200));

    const independent = state.criteria.some(c => c.assessment?.independent);
    const body = prBody({
      outcome: state.brief.outcome, buildId, independent, tier: risk.tier, protectedPaths: risk.matched,
      gateEvidence: state.gate?.evidence ?? 'Isolated repository verification passed for this candidate.',
      // criterionResult, not the assessment: an owner who recorded a verdict
      // outranks the reviewer everywhere else, and a pull request that says
      // otherwise misreports the one judgement that is not a model's.
      criteria: state.criteria.map(c => {
        const result = criterionResult(c, candidate);
        return { text: c.text, verdict: result.verdict, evidence: result.evidence };
      }),
    });
    // The two permissions have to differ in something CI can see, or "open a
    // pull request" and "ship to production" are the same button with different
    // labels. A DRAFT is exactly that lever: ci.yml's auto-merge job requires
    // `pull_request.draft == false`, so a draft waits for a person to mark it
    // ready however green it goes.
    const draft = state.releasePolicy !== 'production';
    const pr = await openPullRequest({ repo: REPO, title, head: branch, base: SR_MAIN_GIT_TARGET.baseBranch, body, token, draft, userAgent: 'jkai-develop' });
    const prUrl = pr.url;
    const prNumber = pr.number;
    await mutateDelivery(buildId, 'release_pr_open', s => ({ ...s, stage: 'pr_open',
      release: { ...(s.release ?? { revision: candidate }), revision: candidate, branch, prUrl, prNumber, ci: 'pending', ciFailure: undefined, ciGreenAt: undefined, awaitingOwner: undefined, tier: risk.tier, protectedPaths: risk.matched,
        detail: draft ? 'Draft pull request open. Mark it ready on GitHub when you want CI to consider merging it.' : 'Pull request open. CI decides whether it merges.' } }));
    await db.update(jkaiBuilds).set({ publishedSlug: prUrl, outcome: 'pr_open', updatedAt: new Date() }).where(eq(jkaiBuilds.id, buildId));
    await emitLog(buildId, 'system', `Release proposed: ${prUrl}. Merging is CI's decision, not the builder's.`);
    return { prUrl, branch };
  } catch (error) {
    const message = redactGitHubSecrets(error instanceof Error ? error.message : 'Release failed.', token).slice(0, 1500);
    await mutateDelivery(buildId, 'release_failed', s => ({ ...s, release: { ...(s.release ?? { revision: candidate }), revision: candidate, branch, blocker: message, detail: 'The batch and the candidate are unchanged.' } }));
    await emitLog(buildId, 'error', `Release did not proceed: ${message}`);
    throw new Error(message);
  }
}

/**
 * Run CI's risk classifier over the applied, uncommitted change.
 *
 * The classifier and its rules come from MASTER (`git show HEAD:…`, before the
 * commit), never from the candidate's working tree — exactly as ci.yml's Risk
 * tier job does. The candidate's copy is worker-written: running it would
 * execute the worker's code on this host, and an emptied rules file would
 * report `low`. Merge base HEAD with itself is HEAD and the script diffs the
 * working tree against it, so the answer is what CI will say.
 *
 * A failure to classify reports `high`: a wrong `low` is a stalled pull request
 * nobody was told about, a wrong `high` is one extra push notification.
 */
async function classifyRelease(root: string): Promise<{ tier: 'low' | 'high'; matched: string[] }> {
  const rules = `${root}/rules`;
  const out = `${root}/risk-tier.out`;
  const run = await execInSandbox(
    `rm -rf ${rules} ${out} && mkdir -p ${rules}/scripts ${rules}/.github && cd ${root}/repo && ` +
      `git show HEAD:scripts/classify-pr-risk.sh > ${rules}/scripts/classify-pr-risk.sh && ` +
      `git show HEAD:.github/protected-paths.txt > ${rules}/.github/protected-paths.txt && ` +
      `GITHUB_OUTPUT=${out} bash ${rules}/scripts/classify-pr-risk.sh HEAD >/dev/null 2>&1; cat ${out} 2>/dev/null`,
    60_000,
  ).catch(() => null);
  return parseRiskOutput(run?.stdout ?? '');
}

/** Parse the `tier=` / `matched=` lines the classifier writes to GITHUB_OUTPUT. */
export function parseRiskOutput(text: string): { tier: 'low' | 'high'; matched: string[] } {
  const tier = /^tier=(low|high)$/m.exec(text)?.[1] as 'low' | 'high' | undefined;
  // `matched` may be a heredoc block (matched<<EOF … EOF) or a single line.
  const block = /^matched<<(\S+)\n([\s\S]*?)\n\1$/m.exec(text)?.[2] ?? /^matched=(.*)$/m.exec(text)?.[1] ?? '';
  const matched = block.split(/\n|,\s*/).map(line => line.replace(/\s*\(rule:.*$/, '').trim()).filter(Boolean);
  return { tier: tier ?? 'high', matched: [...new Set(matched)] };
}

/** Close this feature's open pull request, for a repair round. */
export async function closeDevelopmentPullRequest(buildId: string, comment: string): Promise<void> {
  const delivery = await loadDelivery(buildId);
  const number = delivery?.state.release?.prNumber;
  const token = process.env.FORGE_GITHUB_TOKEN;
  if (!number || !token) return;
  await closePullRequest({ repo: REPO, number, comment, token, userAgent: 'jkai-develop' });
}

type CheckRun = { id: number; name: string; status: string; conclusion: string | null; app?: { slug?: string }; output?: { title?: string | null; summary?: string | null } };

/**
 * One verdict over every check on the head commit.
 *
 * `cancelled` and `skipped` are not failures: CI cancels a superseded run, and
 * the auto-merge job skips itself on anything that is not a low-tier agent
 * branch. Anything still queued or running means pending.
 */
export function ciVerdict(runs: CheckRun[]): { state: 'pending' | 'success' | 'failure'; failed: CheckRun[]; mergeFailed: boolean } {
  const failedRun = (r: CheckRun) => r.status === 'completed' && ['failure', 'timed_out', 'action_required', 'startup_failure'].includes(r.conclusion ?? '');
  // The Auto-merge job failing is a merge that did not happen — branch
  // protection, a PR behind master — not code the worker can fix.
  const mergeFailed = runs.some(r => AUTO_MERGE.test(r.name) && failedRun(r));
  const verdictRuns = runs.filter(r => !AUTO_MERGE.test(r.name));
  if (!verdictRuns.length) return { state: 'pending', failed: [], mergeFailed };
  // The aggregate Gate job fails whenever a shard does, carrying only its
  // verdict; the shard's own log is the one worth reading, so it goes first.
  const failed = verdictRuns.filter(failedRun).sort((a, b) => Number(/^Gate\b/.test(a.name)) - Number(/^Gate\b/.test(b.name)));
  if (failed.length) return { state: 'failure', failed, mergeFailed };
  if (verdictRuns.some(r => r.status !== 'completed')) return { state: 'pending', failed: [], mergeFailed };
  return { state: 'success', failed: [], mergeFailed };
}
const AUTO_MERGE = /^Auto-merge\b/i;

/**
 * The part of a GitHub Actions job log worth a model's attention: the lines
 * around each `##[error]`, with timestamps and colour codes stripped.
 */
export function ciLogExcerpt(log: string, limit = 1800): string {
  const lines = log.split('\n').map(l => l.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z\s?/, '').replace(/\x1b\[[0-9;]*m/g, ''));
  const errors = lines.flatMap((l, i) => l.includes('##[error]') ? [i] : []);
  if (!errors.length) return lines.slice(-30).join('\n').slice(-limit);
  const first = errors[0];
  return [...lines.slice(Math.max(0, first - 25), first), ...errors.map(i => lines[i])]
    .filter((l, i, all) => all.indexOf(l) === i).join('\n').slice(-limit);
}

async function ciFailureSummary(failed: CheckRun[], headers: Record<string, string>): Promise<string> {
  const parts: string[] = [];
  for (const run of failed.slice(0, 2)) {
    let excerpt = [run.output?.title, run.output?.summary].filter(Boolean).join('\n').slice(0, 600);
    if (run.app?.slug === 'github-actions') {
      // The job log redirects to a signed URL; fetch drops the Authorization
      // header on that cross-origin hop, which the signed URL does not need.
      const log = await fetch(`https://api.github.com/repos/${REPO}/actions/jobs/${run.id}/logs`, { headers, signal: AbortSignal.timeout(20_000) })
        .then(r => r.ok ? r.text() : '').catch(() => '');
      if (log) excerpt = ciLogExcerpt(log);
    }
    parts.push(`Check "${run.name}" ${run.conclusion}:\n${excerpt || '(no log available)'}`);
  }
  const more = failed.length > 2 ? `\nAlso failed: ${failed.slice(2).map(r => r.name).join(', ')}` : '';
  return (parts.join('\n\n') + more).slice(0, 4000);
}

/** CI green but unmerged this long means auto-merge declined it. */
const MERGE_GRACE_MS = 20 * 60 * 1000;

/**
 * Has the proposal actually shipped?
 *
 * Three separate facts, recorded separately, because conflating them is how a
 * build reports success it has not got: the pull request merged, the merge
 * commit exists, and the site is serving it. The last one comes from the same
 * public `/api/version` stamp a person would check.
 */
export async function watchDevelopmentRelease(buildId: string): Promise<'pending' | 'merged' | 'deployed' | 'closed' | 'ci_failed' | 'awaiting_owner'> {
  const delivery = await loadDelivery(buildId);
  const release = delivery?.state.release;
  if (!delivery || !release?.prNumber) return 'pending';
  const token = process.env.FORGE_GITHUB_TOKEN;
  if (!token) return 'pending';
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'jkai-develop' };
  const response = await fetch(`https://api.github.com/repos/${REPO}/pulls/${release.prNumber}`, { headers });
  if (!response.ok) return 'pending';
  const pr = (await response.json()) as { merged?: boolean; merge_commit_sha?: string; state?: string; merged_at?: string; draft?: boolean; head?: { sha?: string }; mergeable_state?: string };
  if (!pr.merged) {
    if (pr.state === 'open' && pr.head?.sha) return watchOpenPullRequest(buildId, release, pr as { draft?: boolean; head: { sha: string }; mergeable_state?: string }, headers);
    if (pr.state === 'closed') {
      // Back to review, not left at pr_open: developmentLane reads that stage as
      // shipped, so a rejected proposal would sit in the Shipped column and
      // autopilot would never leave the branch that only watches for a merge.
      await mutateDelivery(buildId, 'release_closed', s => ({ ...s, stage: 'review',
        release: { ...(s.release ?? { revision: '' }), ci: 'failure', prUrl: undefined, detail: 'The pull request was closed without merging. The candidate and its batch are unchanged.' } }));
      await (await import('$lib/codegraph/development.server')).observeDevelopmentRelease(buildId, release.revision, 'closed', `pull request #${release.prNumber} closed without merging`, release.prNumber).catch(() => {});
      return 'closed';
    }
    return 'pending';
  }
  const mergeSha = pr.merge_commit_sha ?? undefined;
  const deployed = await servingSha();
  // ANCESTRY, not equality. Master moves: any other pull request merging in the
  // window means the serving sha will never equal this merge sha, and a watcher
  // testing `===` waits for a coincidence that may never arrive. What "shipped"
  // means is that the serving commit CONTAINS the merge.
  const isLive = Boolean(deployed && mergeSha && (deployed === mergeSha || (await commitContains(mergeSha, deployed, headers))));
  await mutateDelivery(buildId, isLive ? 'release_deployed' : 'release_merged', s => ({
    ...s, stage: isLive ? 'deployed' : s.stage,
    release: { ...(s.release ?? { revision: '' }), ci: 'success', mergedAt: pr.merged_at ?? new Date().toISOString(), mergeSha,
      deployedSha: deployed ?? undefined, deployedAt: isLive ? new Date().toISOString() : undefined,
      detail: isLive ? 'Merged and serving in production.' : 'Merged. Waiting for the deploy to report this commit.' },
  }));
  // A merge is CI's green too — auto-merge can land between two sweeps, so the
  // open-and-green state above may never have been seen. No-op once paired.
  if (release.ci !== 'success') {
    await (await import('$lib/codegraph/development.server')).observeDevelopmentCi(buildId, { passed: true, revision: release.revision, prNumber: release.prNumber,
      detail: `CI passed and pull request #${release.prNumber} merged for candidate ${release.revision.slice(0, 12)}.` }).catch(() => {});
  }
  if (isLive) {
    await db.update(jkaiBuilds).set({ outcome: 'delivered', updatedAt: new Date() }).where(eq(jkaiBuilds.id, buildId));
    // Only now is the accepted feature's episode `verified`: merged AND serving,
    // not merely accepted on a local batch.
    await (await import('$lib/codegraph/development.server')).observeDevelopmentRelease(buildId, release.revision, 'deployed',
      `pull request #${release.prNumber} merged as ${mergeSha?.slice(0, 12)}; production serving ${deployed?.slice(0, 12)}`, release.prNumber).catch(() => {});
  }
  return isLive ? 'deployed' : 'merged';
}

/**
 * An open pull request: read its checks, and say whether it is progressing,
 * failed, or parked on a person. Every transition is written to the delivery
 * so the page shows the same thing autopilot acted on.
 */
async function watchOpenPullRequest(
  buildId: string,
  release: NonNullable<DeliveryState['release']>,
  pr: { draft?: boolean; head: { sha: string }; mergeable_state?: string },
  headers: Record<string, string>,
): Promise<'pending' | 'ci_failed' | 'awaiting_owner'> {
  const checks = await fetch(`https://api.github.com/repos/${REPO}/commits/${pr.head.sha}/check-runs?per_page=100`, { headers, signal: AbortSignal.timeout(15_000) })
    .then(r => r.ok ? r.json() as Promise<{ check_runs?: CheckRun[] }> : { check_runs: [] }).catch(() => ({ check_runs: [] as CheckRun[] }));
  const verdict = ciVerdict(checks.check_runs ?? []);

  if (verdict.state === 'failure') {
    if (release.ci === 'failure' && release.ciFailure) return 'ci_failed';
    const summary = await ciFailureSummary(verdict.failed, headers);
    await mutateDelivery(buildId, 'release_ci_failed', s => ({ ...s, release: { ...(s.release ?? release), ci: 'failure', ciFailure: summary, detail: `CI failed: ${verdict.failed.map(r => r.name).join(', ')}.` } }));
    await emitLog(buildId, 'error', `CI failed on ${release.prUrl}: ${verdict.failed.map(r => r.name).join(', ')}`);
    await (await import('$lib/codegraph/development.server')).observeDevelopmentCi(buildId, { passed: false, revision: release.revision, prNumber: release.prNumber, detail: summary }).catch(() => {});
    return 'ci_failed';
  }

  if (pr.mergeable_state === 'dirty') {
    return parkOnOwner(buildId, release, 'The pull request conflicts with master. It needs a rebase by hand; autopilot does not rewrite history.');
  }
  if (verdict.mergeFailed) return parkOnOwner(buildId, release, 'CI passed but the Auto-merge job failed. Check it on GitHub.');
  if (verdict.state !== 'success') {
    // Moving again (a re-run, a push by hand): no longer parked.
    if (release.awaitingOwner) await mutateDelivery(buildId, 'release_resumed', s => ({ ...s, release: { ...(s.release ?? release), awaitingOwner: undefined } }));
    return 'pending';
  }

  const greenAt = release.ciGreenAt ?? new Date().toISOString();
  if (!release.ciGreenAt || release.ci !== 'success') {
    await mutateDelivery(buildId, 'release_ci_green', s => ({ ...s, release: { ...(s.release ?? release), ci: 'success', ciGreenAt: greenAt, detail: 'CI passed. Waiting for the merge.' } }));
    // The other end of a red pull request this feature closed to repair.
    await (await import('$lib/codegraph/development.server')).observeDevelopmentCi(buildId, { passed: true, revision: release.revision, prNumber: release.prNumber,
      detail: `CI passed on pull request #${release.prNumber} for candidate ${release.revision.slice(0, 12)}.` }).catch(() => {});
  }
  if (pr.draft) return parkOnOwner(buildId, release, 'CI passed on a draft pull request. Mark it ready for review on GitHub when you want it merged.');
  if (release.tier === 'high') return parkOnOwner(buildId, release, `CI passed, but the change touches protected paths (${(release.protectedPaths ?? []).slice(0, 6).join(', ') || 'see the Risk tier check'}), so it waits for your review and merge.`);
  if (Date.now() - Date.parse(greenAt) > MERGE_GRACE_MS) return parkOnOwner(buildId, release, 'CI passed twenty minutes ago and the pull request has not merged. Check the Auto-merge job on GitHub.');
  return 'pending';
}

async function parkOnOwner(buildId: string, release: NonNullable<DeliveryState['release']>, reason: string): Promise<'awaiting_owner'> {
  if (release.awaitingOwner !== reason) {
    await mutateDelivery(buildId, 'release_awaiting_owner', s => ({ ...s, release: { ...(s.release ?? release), awaitingOwner: reason, detail: reason } }));
  }
  return 'awaiting_owner';
}

/**
 * Does `head` contain `base`?
 *
 * GitHub's compare endpoint answers this directly: `behind` or `identical`
 * means base is an ancestor of head. A failed lookup returns false, so an API
 * hiccup reports "not yet live" rather than inventing a deployment.
 */
export async function commitContains(base: string, head: string, headers: Record<string, string>): Promise<boolean> {
  try {
    const response = await fetch(`https://api.github.com/repos/${REPO}/compare/${base}...${head}`, { headers, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return false;
    const json = (await response.json()) as { status?: string };
    return json.status === 'ahead' || json.status === 'identical';
  } catch { return false; }
}

/** The sha production says it is serving, from the public stamp endpoint. */
export async function servingSha(): Promise<string | null> {
  try {
    const response = await fetch('https://strangeramblings.com/api/version', { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return null;
    const json = (await response.json()) as { sha?: string | null };
    return json.sha ?? null;
  } catch { return null; }
}
