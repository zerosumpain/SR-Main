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
 * token, the same remote and the same `openPrViaRestApi` the change-request
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
import { criterionResult, releaseBlocker } from './development';
import { SR_MAIN_GIT_TARGET } from './git-targets';

/** Big enough for a real feature, small enough that a runaway diff is refused. */
const MAX_PATCH_BYTES = 4_000_000;

function releaseBranch(buildId: string): string {
  return `${SR_MAIN_GIT_TARGET.branchPrefix}dev-${buildId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)}`;
}

function tokenRemote(token: string): string {
  return `https://x-access-token:${token}@github.com/zerosumpain/SR-Main.git`;
}

/** Never let the token reach a log line, a build event or an error message. */
function redact(text: string, token: string | undefined): string {
  return token ? text.split(token).join('***') : text;
}

export function prBody(input: { outcome: string; criteria: Array<{ text: string; verdict: string; evidence: string }>; gateEvidence: string; buildId: string; independent: boolean }): string {
  return [
    'Autonomous site development, proposed from `/jkai/develop`.',
    '',
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
    return { prUrl: state.release.prUrl, branch: state.release.branch ?? releaseBranch(buildId) };
  }
  const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, buildId));
  if (!build) throw new Error('Build not found');
  if (['running', 'queued'].includes(build.status)) throw new Error('Pause the build before releasing its candidate.');

  const token = process.env.FORGE_GITHUB_TOKEN;
  if (!token) throw new Error('Releasing needs FORGE_GITHUB_TOKEN on this host. The candidate and its batch are unchanged.');

  const branch = releaseBranch(buildId);
  await mutateDelivery(buildId, 'release_started', s => ({ ...s, release: { revision: candidate, branch, requestedAt: new Date().toISOString(), detail: 'Replaying the candidate onto a fresh clone of master.' } }), expectedRevision);

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
    if (prepared.exitCode !== 0) throw new Error(redact(`Could not prepare a master clone: ${prepared.stdout}\n${prepared.stderr}`, token).slice(0, 1200));

    const applied = await execInSandbox(
      `cd ${root}/repo && git apply --index --whitespace=nowarn ${patchPath} 2>&1`,
      180_000,
    );
    if (applied.exitCode !== 0) {
      throw new Error(
        `The candidate does not apply to current master, so it needs a rebase before release. ` +
          `Master has moved since this feature branched. git said: ${(applied.stdout + applied.stderr).slice(0, 800)}`,
      );
    }

    const title = `Develop: ${(build.title ?? state.brief.outcome ?? 'site feature').replace(/\s+/g, ' ').trim().slice(0, 110)}`;
    const titleB64 = Buffer.from(title, 'utf8').toString('base64');
    const committed = await execInSandbox(
      `cd ${root}/repo && git commit -m "$(echo '${titleB64}' | base64 -d)" 2>&1 && ` +
        `git push ${tokenRemote(token)} ${branch} --force-with-lease 2>&1`,
      300_000,
    );
    if (committed.exitCode !== 0) throw new Error(redact(`Could not push the release branch: ${committed.stdout}\n${committed.stderr}`, token).slice(0, 1200));

    const independent = state.criteria.some(c => c.assessment?.independent);
    const body = prBody({
      outcome: state.brief.outcome, buildId, independent,
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
    const { prUrl, prNumber } = await openPullRequest({ title, head: branch, body, token, draft });
    await mutateDelivery(buildId, 'release_pr_open', s => ({ ...s, stage: 'pr_open',
      release: { ...(s.release ?? { revision: candidate }), revision: candidate, branch, prUrl, prNumber, ci: 'pending',
        detail: draft ? 'Draft pull request open. Mark it ready on GitHub when you want CI to consider merging it.' : 'Pull request open. CI decides whether it merges.' } }));
    await db.update(jkaiBuilds).set({ publishedSlug: prUrl, outcome: 'pr_open', updatedAt: new Date() }).where(eq(jkaiBuilds.id, buildId));
    await emitLog(buildId, 'system', `Release proposed: ${prUrl}. Merging is CI's decision, not the builder's.`);
    return { prUrl, branch };
  } catch (error) {
    const message = redact(error instanceof Error ? error.message : 'Release failed.', token).slice(0, 1500);
    await mutateDelivery(buildId, 'release_failed', s => ({ ...s, release: { ...(s.release ?? { revision: candidate }), revision: candidate, branch, blocker: message, detail: 'The batch and the candidate are unchanged.' } }));
    await emitLog(buildId, 'error', `Release did not proceed: ${message}`);
    throw new Error(message);
  }
}

/** Open the pull request, or recover the one that already exists for this head. */
async function openPullRequest(args: { title: string; head: string; body: string; token: string; draft: boolean }): Promise<{ prUrl: string; prNumber: number }> {
  const headers = {
    Authorization: `Bearer ${args.token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'jkai-develop',
  };
  const created = await fetch('https://api.github.com/repos/zerosumpain/SR-Main/pulls', {
    method: 'POST', headers,
    body: JSON.stringify({ title: args.title, head: args.head, base: SR_MAIN_GIT_TARGET.baseBranch, body: args.body, draft: args.draft }),
  });
  if (created.ok) {
    const json = (await created.json()) as { html_url?: string; number?: number };
    if (json.html_url && json.number) return { prUrl: json.html_url, prNumber: json.number };
    throw new Error('GitHub accepted the pull request but returned no url.');
  }
  if (created.status === 422) {
    const existing = await fetch(`https://api.github.com/repos/zerosumpain/SR-Main/pulls?head=zerosumpain:${args.head}&state=open`, { headers });
    const list = (await existing.json().catch(() => [])) as Array<{ html_url?: string; number?: number }>;
    const match = list.find(p => p.html_url && p.number);
    if (match) return { prUrl: match.html_url!, prNumber: match.number! };
  }
  throw new Error(`GitHub refused the pull request (${created.status}): ${(await created.text().catch(() => '')).slice(0, 400)}`);
}

/**
 * Has the proposal actually shipped?
 *
 * Three separate facts, recorded separately, because conflating them is how a
 * build reports success it has not got: the pull request merged, the merge
 * commit exists, and the site is serving it. The last one comes from the same
 * public `/api/version` stamp a person would check.
 */
export async function watchDevelopmentRelease(buildId: string): Promise<'pending' | 'merged' | 'deployed' | 'closed'> {
  const delivery = await loadDelivery(buildId);
  const release = delivery?.state.release;
  if (!delivery || !release?.prNumber) return 'pending';
  const token = process.env.FORGE_GITHUB_TOKEN;
  if (!token) return 'pending';
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'jkai-develop' };
  const response = await fetch(`https://api.github.com/repos/zerosumpain/SR-Main/pulls/${release.prNumber}`, { headers });
  if (!response.ok) return 'pending';
  const pr = (await response.json()) as { merged?: boolean; merge_commit_sha?: string; state?: string; merged_at?: string };
  if (!pr.merged) {
    if (pr.state === 'closed') {
      // Back to review, not left at pr_open: developmentLane reads that stage as
      // shipped, so a rejected proposal would sit in the Shipped column and
      // autopilot would never leave the branch that only watches for a merge.
      await mutateDelivery(buildId, 'release_closed', s => ({ ...s, stage: 'review',
        release: { ...(s.release ?? { revision: '' }), ci: 'failure', prUrl: undefined, detail: 'The pull request was closed without merging. The candidate and its batch are unchanged.' } }));
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
  if (isLive) await db.update(jkaiBuilds).set({ outcome: 'delivered', updatedAt: new Date() }).where(eq(jkaiBuilds.id, buildId));
  return isLive ? 'deployed' : 'merged';
}

/**
 * Does `head` contain `base`?
 *
 * GitHub's compare endpoint answers this directly: `behind` or `identical`
 * means base is an ancestor of head. A failed lookup returns false, so an API
 * hiccup reports "not yet live" rather than inventing a deployment.
 */
async function commitContains(base: string, head: string, headers: Record<string, string>): Promise<boolean> {
  try {
    const response = await fetch(`https://api.github.com/repos/zerosumpain/SR-Main/compare/${base}...${head}`, { headers, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return false;
    const json = (await response.json()) as { status?: string };
    return json.status === 'ahead' || json.status === 'identical';
  } catch { return false; }
}

/** The sha production says it is serving, from the public stamp endpoint. */
async function servingSha(): Promise<string | null> {
  try {
    const response = await fetch('https://strangeramblings.com/api/version', { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return null;
    const json = (await response.json()) as { sha?: string | null };
    return json.sha ?? null;
  } catch { return null; }
}
