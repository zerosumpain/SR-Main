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
import { normaliseConversationId } from '$lib/jkai/conversation-id';
import { db } from '$lib/db';
import { jkaiBuilds } from '$lib/db/schema';
import { and, desc, eq, gte, inArray, or, sql } from 'drizzle-orm';
import { builderClient } from '$lib/jkai/builder-client';
import { resolveBuilderModel } from '$lib/server/models/workload-settings';
import type { ModelContext } from '$lib/server/models/types';
import { snapshotPrice } from '$lib/server/models/price-snapshot';
import { SR_MAIN_GIT_TARGET } from '$lib/jkai/git-targets';
import { createIssue, commentOnIssue, githubConfigured, REPO_SLUG } from '$lib/github/issues';
// The same rule as the backlog's `isSameIdea` (`$lib/selfimprove/same-idea`),
// imported from underneath both: `$lib/selfimprove` and `$lib/daydream`
// already import `$lib/jkai`.
import { TITLE_ECHO_SIMILARITY, titleSimilarity } from '$lib/utils/title-similarity';

export const CHANGE_REQUEST_BUDGET = {
  maxIterations: 25,
  maxTotalMinutes: 120,
  // MIND THE UNIT — it is not the same as maxTokensPerIteration below.
  // `checkBudget` sums `jkai_iterations.tokens_used`, which is TOTAL tokens:
  // input, output and the whole conversation re-sent on every one of an
  // iteration's tool calls. A single ordinary iteration of a small change costs
  // 0.9-1.1M of those, so the old 1M ceiling was reached by the FIRST one.
  //
  // What that looked like in practice (change request #204): the agent wrote
  // the feature in two iterations and sixteen minutes, then spent the next
  // thirty-six logging "Cooling down: Token limit reached (2009819/1000000)"
  // every five minutes until the owner killed it. Nothing was wrong; the brake
  // was simply set below the speed of walking.
  //
  // 3M matches STUDIO_BUDGET, which was sized against real iterations for the
  // same reason. It still stops a genuine runaway inside an hour, and four
  // other brakes sit in front of it: maxIterations, maxTotalMinutes,
  // maxCostUsd, and the per-iteration output cap.
  maxTokensPerHour: 3_000_000,
  activeMinutesPerHour: 45,
  // The per-hour cap is only consulted between iterations, so on its own it
  // cannot stop a single iteration running away — two spent 1.5M tokens each
  // on 2026-08-07 without it ever engaging.
  //
  // NOTE THE UNIT: this counts OUTPUT tokens now. It used to sum
  // `usage.totalTokens`, which is per API call and includes the whole re-sent
  // conversation, so 400k was reached after ~15 turns regardless of how much
  // work had been done — six iterations died to it in 30 days, including both
  // of change request #159. With the wall-clock deadline already bounding an
  // iteration, this is the secondary brake for a genuine runaway loop, so it
  // is set well above any plausible legitimate iteration.
  maxTokensPerIteration: 150_000,
  // A change request is one surgical edit. If it has cost more than this, the
  // request was too big or the agent is stuck — either way a human should look
  // before more is spent.
  maxCostUsd: 2,
  // Three iterations in a row that change nothing is a verification loop, not
  // work. Stop and hand back.
  maxIdleIterations: 3,
};

export interface ChangeRequestResult {
  buildId: string;
  issueNumber: number;
  issueUrl: string;
  /** True when an open change request for the same idea was handed back
   *  instead of opening a new issue and starting a new build. */
  reused?: boolean;
}

// ── Dedup ─────────────────────────────────────────────────────────────────
//
// Every call used to open a new issue and start a new build, at up to £2
// each, so the same idea asked twice — by the nightly engine on two nights, by
// chat and the engine, or by two producers that phrased it differently — was
// built twice. Since D3 (spec 2026-09-25) an ask first looks for a change
// request that is still live for the same idea, and returns it.

/** Build statuses that are still doing (or about to do) the work. */
export const OPEN_BUILD_STATUSES = ['pending', 'running', 'paused'] as const;

/** How long a finished build whose outcome is an open PR still counts as the
 *  answer to its ask. The outcome does not change when the PR merges, so this
 *  is a window rather than a state: two weeks covers review, and a re-ask
 *  after that is a new request. */
export const OPEN_PR_WINDOW_DAYS = 14;

/** What the dedup reads from a `jkai_builds` row. */
export interface ChangeRequestRow {
  id: string;
  title: string | null;
  status: string;
  outcome: string | null;
  gitTargetConfig: unknown;
  createdAt: Date;
}

/** The ask's own title, as recorded. Builds from before this stored only the
 *  display title, `Change request #n: <first 60 chars>`. */
function askTitle(row: ChangeRequestRow): string {
  const cfg = (row.gitTargetConfig ?? {}) as { requestTitle?: unknown };
  if (typeof cfg.requestTitle === 'string' && cfg.requestTitle) return cfg.requestTitle;
  return (row.title ?? '').replace(/^Change request #\d+:\s*/, '');
}

/**
 * The live change request this ask would duplicate, or null. PURE.
 *
 * Live means still building, or finished with a PR inside
 * `OPEN_PR_WINDOW_DAYS`. A backlog slug is the exact identity and wins; a
 * near-identical title (the backlog's `isSameIdea` rule) catches the same idea
 * asked through chat or under other words.
 */
export function matchOpenChangeRequest(
  rows: readonly ChangeRequestRow[],
  ask: { title: string; backlogSlug?: string },
  now = Date.now(),
): ChangeRequestRow | null {
  const since = now - OPEN_PR_WINDOW_DAYS * 86_400_000;
  const live = rows.filter(
    (r) =>
      (OPEN_BUILD_STATUSES as readonly string[]).includes(r.status) ||
      (r.outcome === 'pr_open' && r.createdAt.getTime() >= since),
  );
  if (ask.backlogSlug) {
    const bySlug = live.find((r) => ((r.gitTargetConfig ?? {}) as { backlogSlug?: unknown }).backlogSlug === ask.backlogSlug);
    if (bySlug) return bySlug;
  }
  return live.find((r) => titleSimilarity(ask.title, askTitle(r)) >= TITLE_ECHO_SIMILARITY) ?? null;
}

/** Read the live change requests and match. Soft on a read failure: a lookup
 *  that cannot run must not block the owner's ask — it degrades to the old
 *  behaviour of opening a new one. */
async function findOpenChangeRequest(ask: { title: string; backlogSlug?: string }): Promise<ChangeRequestRow | null> {
  try {
    const since = new Date(Date.now() - OPEN_PR_WINDOW_DAYS * 86_400_000);
    const rows = await db
      .select({
        id: jkaiBuilds.id,
        title: jkaiBuilds.title,
        status: jkaiBuilds.status,
        outcome: jkaiBuilds.outcome,
        gitTargetConfig: jkaiBuilds.gitTargetConfig,
        createdAt: jkaiBuilds.createdAt,
      })
      .from(jkaiBuilds)
      .where(
        and(
          // Not in the column's declared enum (the insert below casts), so
          // compared as SQL rather than through the typed `eq`.
          sql`${jkaiBuilds.origin} = 'change-request'`,
          or(
            inArray(jkaiBuilds.status, [...OPEN_BUILD_STATUSES]),
            and(eq(jkaiBuilds.outcome, 'pr_open'), gte(jkaiBuilds.createdAt, since)),
          ),
        ),
      )
      .orderBy(desc(jkaiBuilds.createdAt))
      .limit(200);
    return matchOpenChangeRequest(rows as ChangeRequestRow[], ask);
  } catch (err) {
    console.warn(`[change-request] dedup lookup failed, opening a new one: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Open an issue for `request`, then start a git-target build that implements it.
 *
 * @param title    short issue title — what is being asked for.
 * @param request  the full ask, in the requester's words. Preserved verbatim in
 *                 the issue body so the original intent survives, and handed to
 *                 the agent as its directive.
 * @param labels   optional issue labels.
 * @param conversationId
 *                 the chat that asked for the change. Without it the build is
 *                 invisible to `build-progress-check`, whose filter requires a
 *                 non-null conversation_id — which is why every change-request
 *                 build reported "no slow running builds" while four of them
 *                 were grinding away.
 */
export async function createChangeRequest({
  title,
  request,
  labels,
  conversationId,
  modelContext,
  backlogSlug,
}: {
  title: string;
  request: string;
  labels?: string[];
  conversationId?: string;
  /** The chat session's pinned model, when the asking thread had one. */
  modelContext?: ModelContext;
  /** The improvement-backlog item this implements, when it came from one.
   *  Stored on the build so a second ask for the same item finds it. */
  backlogSlug?: string;
}): Promise<ChangeRequestResult> {
  // The same idea already live? Hand it back rather than paying twice.
  const open = await findOpenChangeRequest({ title, backlogSlug });
  if (open) {
    const issueNumber = Number(((open.gitTargetConfig ?? {}) as { issueNumber?: unknown }).issueNumber) || 0;
    return {
      buildId: open.id,
      issueNumber,
      issueUrl: issueNumber ? `https://github.com/${REPO_SLUG}/issues/${issueNumber}` : '',
      reused: true,
    };
  }

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

  // The asking session's pin, then the `builder` workload. A thread pinned to a
  // model now re-tasks the builder it starts, which is the behaviour the picker
  // always implied and never had — before this, a change request raised from a
  // thread running on one model built on whichever model happened to be the
  // site default when the build began. With no pin the role answers, and the
  // role follows the site default until someone points it elsewhere.
  const ctx = modelContext ?? (await resolveBuilderModel());
  const priceSnapshot = await snapshotPrice(ctx);

  // Whichever of those two it was, the agent runtime has to recognise the id.
  // That is fine for a model it knows; it is not fine for one it doesn't. On
  // 2026-08-07 the default was `~deepseek/deepseek-v4-flash-latest`, which pi
  // reports as "not found for provider openrouter — using custom model id":
  // no context-window metadata, so nothing manages context, and both builds
  // ballooned past a million tokens per iteration. Record it on the issue
  // rather than blocking — the build may still work, but the trail should say
  // the model was unrecognised before anyone blames the code.
  //
  // Now that a chat pin reaches here, the message has to name WHICH of the two
  // chose the model: "the current site default" was the only possibility when
  // this was written, and sending someone to /admin/ai/models to change a model
  // their own thread picked would be a wild goose chase.
  if (/^[~@]/.test(ctx.modelId)) {
    const origin = modelContext
      ? 'the model pinned on the chat that asked for it'
      : 'the current site default';
    const remedy = modelContext
      ? 'pick a plain model id in the chat composer before raising the request'
      : 'set a plain id at /admin/ai/models';
    await commentOnIssue(
      issue.number,
      `⚠️ Starting this build on \`${ctx.modelId}\`, ${origin}. That id carries a ` +
        `provider-alias prefix the agent runtime does not resolve to a known model, so it has no ` +
        `context-window metadata for it and cannot manage context. If this build burns tokens or ` +
        `stalls, check the model before the code — ${remedy}.`,
    ).catch(() => {});
  }

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
      // `requestTitle` and `backlogSlug` are what the dedup above matches on;
      // the display title is truncated and prefixed.
      gitTargetConfig: {
        ...SR_MAIN_GIT_TARGET,
        issueNumber: issue.number,
        requestTitle: title.slice(0, 200),
        ...(backlogSlug ? { backlogSlug } : {}),
      },
      // This IS the SR site, so the warm-brutalist design linter applies here
      // (unlike the Forge, whose game repo owns its own checks).
      enforceDesignSystem: true,
      planStatus: 'approved',
      // Spread, so a per-build override can never write back onto the shared
      // constant — same reason createStudioBuild spreads STUDIO_BUDGET.
      budgetConfig: { ...CHANGE_REQUEST_BUDGET },
      modelProvider: ctx.provider,
      modelId: ctx.modelId,
      priceSnapshot,
      ...(conversationId ? { conversationId: normaliseConversationId(conversationId) } : {}),
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
