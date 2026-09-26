// src/lib/selfimprove/propose.ts
//
// PROPOSE phase — ideas too big for a runtime tool go to a builder that can
// actually build them.
//
// ── What changed, 2026-09-04 ────────────────────────────────────────────────
//
// This phase used to author whole files blind from a flash model and open a
// draft PR whose own body had to say "This is a draft. Nothing here has been
// run." The engine could not execute a test, could not read an existing file,
// and could not iterate — so every PR was a plausible patch nobody had
// compiled, and CI on the branch was the first thing to find out.
//
// The site has had a better builder the whole time. `createChangeRequest`
// opens a GitHub issue, cuts a branch from master, hands the ask to the
// autonomous agent behind `/jkai/builds`, runs `npm run gate` on every
// iteration, and opens a PR at the end. It still never merges — the safety
// model is unchanged and lives in the layers around it (gate per iteration,
// `risk-tier` refusing to auto-merge a protected path, the £2 ceiling).
//
// So the phase stopped writing code and started writing ASKS. The blind draft
// PR survives as the fallback for a host with no GitHub token, because "no
// token" should degrade to the old behaviour rather than to nothing.
//
// ── And watches ─────────────────────────────────────────────────────────────
//
// The same phase also provisions monitors, which is what "watches, triggers
// and workflows" all reduce to here: `createMonitor` generates a scheduled
// workflow with a dedupe step and a notifier. It is one phase because it is
// one job — turning a queued idea into work something else does — and because
// a new `PhaseName` would leave every historical `improvement_runs` record
// with a hole the dashboards would have to special-case.
//
// ── Who is allowed to spend ─────────────────────────────────────────────────
//
// A change-request build can cost £2, roughly ten times a whole night here, so
// the gate is explicit (owner decision, 2026-09-04, re-pointed by D3):
//
//   * an item whose brief the owner ACCEPTED in the backlog room is dispatched
//     — saving the accepted brief is the tap (`isOwnerAccepted`); or
//   * `daydream.appetite.autobuild` is explicitly true, in which case the
//     engine may dispatch on its own, one change request and one watch a night.
//
// Only tapped items are PICKED. Picking first and checking the tap second let
// the highest-priority untapped items hold every slot, so a tapped item lower
// down was never reached. Everything else waits, and the run reports how many.
//
// ── One intake, one build per idea ──────────────────────────────────────────
//
// Every producer now writes to the backlog (D3), so this phase is the only
// thing that turns an idea into a repo build. The backlog slug travels with
// the ask, and `createChangeRequest` hands back an open build for the same
// slug or title rather than opening a second issue and a second £2 build.

import { errMsg, WORK_CAPS, type BuildLanes, type RunAction } from './types';
import type { Budget } from './run';
import { buildContextPack, renderContext } from './context';
import { isOwnerAccepted, listBacklog, markAttempt, pickWork, recordBuildRef } from './backlog';
import { openDraftPr, pathAllowed, prConfigured, type FileChange } from '$lib/github/pr';
import type { BacklogItemData } from './types';
import { renderBacklogBrief } from './grooming';

/** The kinds the repo builder takes. `tool` and `source` joined `feature` when
 *  the toolsmith was retired (D3): a tool is now repo code, built on a branch
 *  behind the gate, not authored unattended into the runtime. */
export const REPO_BUILD_KINDS: ReadonlyArray<BacklogItemData['kind']> = ['feature', 'tool', 'source'];

interface ProposedChange {
  title: string;
  summary: string;
  files: FileChange[];
  wiringNotes: string;
}

function coerceChange(json: unknown): ProposedChange | null {
  if (!json || typeof json !== 'object') return null;
  const o = json as Record<string, unknown>;
  const filesRaw = Array.isArray(o.files) ? o.files : [];
  const files: FileChange[] = filesRaw
    .map((f) => {
      const fo = (f && typeof f === 'object' ? f : {}) as Record<string, unknown>;
      const path = typeof fo.path === 'string' ? fo.path.trim() : '';
      const content = typeof fo.content === 'string' ? fo.content : '';
      return path && content ? { path, content } : null;
    })
    .filter((f): f is FileChange => f !== null)
    .filter((f) => pathAllowed(f.path))
    .slice(0, 6);

  if (files.length === 0) return null;
  return {
    title: typeof o.title === 'string' && o.title ? o.title : 'Self-improvement proposal',
    summary: typeof o.summary === 'string' ? o.summary : '',
    files,
    wiringNotes: typeof o.wiringNotes === 'string' ? o.wiringNotes : '',
  };
}

function buildMessages(
  item: BacklogItemData,
  contextText: string,
): Array<{ role: 'system' | 'user'; content: string }> {
  const system =
    'You are a senior TypeScript engineer working in a SvelteKit 2 + Svelte 5 (runes) codebase that uses Drizzle ' +
    'ORM over PostgreSQL and Vitest for tests. Implement the requested capability as a SELF-CONTAINED set of NEW ' +
    'files — you cannot modify existing files in this change.\n\n' +
    'Rules:\n' +
    '- Write complete, compiling TypeScript. No placeholders, no TODO stubs, no pseudo-code.\n' +
    '- Prefer a pure module in src/lib/<area>/ plus a colocated *.test.ts using Vitest (describe/it/expect).\n' +
    '- Import aliases: $lib/* for src/lib/*. Do not invent dependencies — use what a standard Node 22 + the ' +
    'existing stack provides.\n' +
    '- Keep it small: 1-3 source files plus tests. A tight, correct change beats a broad speculative one.\n' +
    '- Explain in wiringNotes exactly what a human must do to connect this to the app (routes to add, ' +
    'call sites, schema pushes) — be honest that this PR does not do it.\n\n' +
    'Respond with ONLY JSON: {"title": string, "summary": string, "wiringNotes": string, ' +
    '"files": [{"path": "src/lib/…", "content": "<full file contents>"}]}. No prose outside the JSON.';

  const user =
    `Capability to implement:\n${renderBacklogBrief(item)}\n\n` +
    (item.lastError ? `A previous attempt failed with: ${item.lastError}\n\n` : '') +
    `Platform reference (for context on what already exists):\n${contextText}`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

function branchName(item: BacklogItemData, runId: string): string {
  return `selfimprove/${item.slug.slice(0, 40)}-${runId.slice(0, 8)}`;
}

function prBody(item: BacklogItemData, change: ProposedChange, runId: string): string {
  return [
    '## What this is',
    '',
    `Authored unattended by the nightly self-improvement engine (run \`${runId}\`) from backlog item \`${item.slug}\`.`,
    '',
    '**This is a draft. Nothing here has been run.** The engine cannot execute the test suite or a build — CI\'s',
    'gate job on this branch is the first real verification. Review it as you would any untrusted patch.',
    '',
    '## Idea',
    '',
    renderBacklogBrief(item),
    '',
    '## Summary of the change',
    '',
    change.summary,
    '',
    '## Files',
    '',
    ...change.files.map((f) => `- \`${f.path}\``),
    '',
    '## Still needs wiring',
    '',
    change.wiringNotes || '_None stated by the author._',
    '',
    '---',
    '',
    '_Opened by `src/lib/selfimprove/propose.ts`. The engine cannot merge — draft PRs only._',
  ].join('\n');
}

/**
 * The ask handed to the autonomous builder.
 *
 * Written by code from recorded fields, not by a model. The builder is going
 * to read this as its directive and the issue keeps it forever, so a
 * hallucinated requirement here becomes a branch of hallucinated code — and
 * unlike a draft PR, that one costs an hour of agent time to find out.
 */
export function changeRequestBody(item: BacklogItemData, runId: string): string {
  return [
    '## Accepted implementation brief',
    '',
    renderBacklogBrief(item),
    '',
    '## Where this came from',
    '',
    `The improvement backlog (\`${item.slug}\`)${item.source ? `, first raised through the \`${item.source}\` channel` : ''}${(item.citations?.length ?? 0) > 1 ? ` and asked for by ${item.citations!.length} producers since` : ''}. The owner accepted the brief above.`,
    `Dispatched by self-improvement run \`${runId}\`.`,
    '',
    '## What is being asked for',
    '',
    'Implement this as a real change to the site: routes, schema, UI and tests as the change needs, following the',
    'patterns already in the repo rather than inventing new ones. Read the neighbouring code first and match its',
    'shape. If the change turns out to be larger than the ask implies, implement the smallest honest version and',
    'say plainly in the PR what was left out.',
    '',
    'Do not weaken a gate, a permission check or a public-route allow-list to make something pass.',
  ].join('\n');
}

export interface ProposeOpts {
  lanes?: BuildLanes;
  /** `daydream.appetite.autobuild` — may the engine dispatch without a tap?
   *  (The key predates D3; see `SETTINGS_AUTOBUILD_KEY`.) */
  autobuild?: boolean;
}

/** PROPOSE: hand queued work to the builder that can do it. */
export async function proposeFeatures(
  budget: Budget,
  runId: string,
  opts: ProposeOpts = {},
): Promise<RunAction[]> {
  const actions: RunAction[] = [];
  const lanes = opts.lanes ?? {};
  const autobuild = opts.autobuild === true;

  const backlog = await listBacklog();

  // Which items may spend. The owner's accepted brief is the tap; autobuild
  // is the explicit, default-off exception.
  const mayDispatch = (item: BacklogItemData) => autobuild || isOwnerAccepted(item);
  const tapped = backlog.filter(mayDispatch);
  const reportWaiting = (kinds: ReadonlyArray<BacklogItemData['kind']>, what: string) => {
    const waiting = pickWork(backlog.filter((i) => !mayDispatch(i)), kinds, Number.MAX_SAFE_INTEGER).length;
    if (waiting) {
      actions.push({
        kind: 'proposal',
        detail: `${waiting} ${what} waiting for a tap — accept its brief in the backlog room (or set daydream.appetite.autobuild)`,
      });
    }
  };

  // ── Watches ───────────────────────────────────────────────────────────────
  const watchWork = pickWork(tapped, 'watch', WORK_CAPS.maxWatches);
  reportWaiting(['watch'], 'watch(es)');
  for (const item of watchWork) {
    if (!lanes.createWatch) {
      actions.push({ kind: 'proposal', detail: `${item.slug}: no watch lane on this host` });
      continue;
    }
    try {
      const res = await lanes.createWatch({ description: renderBacklogBrief(item).slice(0, 1000) });
      await markAttempt(item, { status: 'shipped', runId });
      actions.push({
        kind: 'watch_created',
        detail: `${res.label} — for "${item.title}"`,
        story: {
          subject: item.title,
          driver: (item.grooming?.problem || item.detail).slice(0, 400),
          driverRef: item.slug,
          solution: `Generated a recurring monitor: ${res.label}.`,
          outcome: 'Runs on its schedule and notifies only when something is new.',
        },
      });
    } catch (err) {
      const reason = errMsg(err).slice(0, 300);
      await markAttempt(item, { status: 'open', error: reason, runId });
      actions.push({ kind: 'proposal', detail: `Watch for "${item.title}" failed: ${reason}` });
    }
  }

  // ── Repo changes ──────────────────────────────────────────────────────────
  reportWaiting(REPO_BUILD_KINDS, 'repo build(s)');
  const featureWork = pickWork(tapped, REPO_BUILD_KINDS, Math.max(WORK_CAPS.maxPullRequests, WORK_CAPS.maxChangeRequests));
  if (featureWork.length === 0) return actions;

  let dispatched = 0;
  let contextText: string | null = null;

  for (const item of featureWork) {
    if (budget.timeLeftMs() < WORK_CAPS.reserveWallMs) break;

    // The build lane first: it is the only one of the two that produces code
    // anybody has run.
    if (lanes.changeRequest && dispatched < WORK_CAPS.maxChangeRequests) {
      try {
        const res = await lanes.changeRequest({
          title: item.title,
          request: changeRequestBody(item, runId),
          backlogSlug: item.slug,
        });
        if (res.reused) {
          // The same idea already has an open build: point at it, spend
          // nothing, and leave tonight's slot for the next tapped item.
          await recordBuildRef(item, res.ref, runId);
          actions.push({ kind: 'proposal', detail: `${item.slug}: already building — ${res.label}` });
          continue;
        }
        dispatched++;
        await markAttempt(item, { status: 'open', runId, buildRef: res.ref });
        actions.push({
          kind: 'change_requested',
          detail: `${res.label} — "${item.title}"`,
          story: {
            subject: item.title,
            driver: (item.grooming?.problem || item.detail).slice(0, 400),
            driverRef: item.slug,
            solution: `Opened a change request and started a gated repo build (${res.label}).`,
            outcome: 'The build runs the gate on every iteration and opens a PR; nothing merges itself.',
          },
        });
      } catch (err) {
        const reason = errMsg(err).slice(0, 300);
        await markAttempt(item, { status: 'open', error: reason, runId });
        actions.push({ kind: 'proposal', detail: `Change request for "${item.title}" failed: ${reason}` });
      }
      continue;
    }
    // The nightly cap is spent; the rest wait for tomorrow.
    if (lanes.changeRequest) break;

    // ── Fallback: the blind draft PR ────────────────────────────────────────
    //
    // Only reached when there is no build lane at all — a dev host with no
    // GitHub token, or a manual run that did not inject one. Unchanged from
    // what shipped in July, including its honest PR body.
    if (!prConfigured()) {
      actions.push({ kind: 'proposal', detail: 'no build lane and no GitHub token — nothing dispatched' });
      break;
    }
    if (contextText === null) contextText = renderContext(await buildContextPack());

    try {
      const { json } = await budget.call(buildMessages(item, contextText), {
        maxTokens: 12000,
        temperature: 0.2,
      });
      const change = coerceChange(json);
      if (!change) {
        await markAttempt(item, { status: 'open', error: 'model returned no usable files', runId });
        actions.push({ kind: 'proposal', detail: `${item.slug}: no usable code produced` });
        continue;
      }

      const pr = await openDraftPr({
        branch: branchName(item, runId),
        title: change.title.slice(0, 120),
        body: prBody(item, change, runId),
        files: change.files,
        commitMessage: `feat(selfimprove): ${change.title.slice(0, 80)}\n\nAuthored by the nightly self-improvement engine (run ${runId}).`,
      });

      await markAttempt(item, { status: 'shipped', runId, prUrl: pr.url });
      actions.push({
        kind: 'pr_opened',
        detail: `#${pr.number} ${change.title} — ${pr.url} (${change.files.length} file(s), draft)`,
      });
    } catch (err) {
      const reason = errMsg(err).slice(0, 300);
      await markAttempt(item, { status: 'open', error: reason, runId });
      actions.push({ kind: 'proposal', detail: `PR for "${item.title}" failed: ${reason}` });
    }
  }

  return actions;
}
