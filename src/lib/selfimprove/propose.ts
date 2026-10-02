// src/lib/selfimprove/propose.ts
//
// PROPOSE phase — accepted backlog work goes to the builder that can build it.
//
// ── What changed, 2026-10-02 ────────────────────────────────────────────────
//
// Since 2026-09-04 this phase wrote ASKS rather than code: it opened a change
// request (GitHub issue → branch → PR) for the autonomous builder, and kept a
// blind, model-authored draft PR as the fallback for a host with no lane.
// Meanwhile `/jkai/develop` grew the fuller lane — a groomed brief with
// acceptance criteria, a preview, a reviewer that checks those criteria, and a
// release step — and a backlog item could never reach it.
//
// Now an accepted backlog item BECOMES a development delivery. The lane (in
// `$lib/heartbeat/build-lanes`, injected for the module-boundary reason written
// there) calls the same creator as the "New feature" form with the accepted
// brief, its criteria, release policy `pull_request` and autopilot on. It is
// groomed, built, previewed, reviewed and opened as a pull request without a
// person, and never merged by itself. The item records `delivery:<id>`, so the
// backlog links to `/jkai/develop/<id>`. The blind draft PR is gone: this phase
// no longer authors code nothing has run.
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
// A delivery runs against the £2 build ceiling, roughly ten times a whole night
// here, so the gate is explicit (owner decision, 2026-09-04, re-pointed by D3):
//
//   * an item whose brief the owner ACCEPTED in the backlog room is dispatched
//     — saving the accepted brief is the tap (`isOwnerAccepted`); or
//   * `daydream.appetite.autobuild` is explicitly true, in which case the
//     engine may dispatch on its own, one delivery and one watch a night.
//
// Only tapped items are PICKED. Picking first and checking the tap second let
// the highest-priority untapped items hold every slot, so a tapped item lower
// down was never reached. Everything else waits, and the run reports how many.
//
// ── One intake, one build per idea ──────────────────────────────────────────
//
// Every producer writes to the backlog (D3), so this phase is the only thing
// that turns an idea into a repo build. The backlog slug travels with the
// request, and the lane hands back a live delivery for the same slug rather
// than starting a second £2 build.

import { errMsg, WORK_CAPS, type BuildLanes, type DeliveryRequest, type RunAction } from './types';
import type { Budget } from './run';
import { isOwnerAccepted, listBacklog, markAttempt, pickWork, recordBuildRef } from './backlog';
import type { BacklogItemData } from './types';
import { renderBacklogBrief } from './grooming';

/** The kinds the repo builder takes. `tool` and `source` joined `feature` when
 *  the toolsmith was retired (D3): a tool is now repo code, built on a branch
 *  behind the gate, not authored unattended into the runtime. */
export const REPO_BUILD_KINDS: ReadonlyArray<BacklogItemData['kind']> = ['feature', 'tool', 'source'];

/** The delivery route refuses a longer outcome from a person; hold the engine
 *  to the same ceiling. */
const MAX_OUTCOME_CHARS = 20_000;

/**
 * The outcome handed to the delivery — its brief and the build's prompt.
 *
 * Written by code from recorded fields, not by a model. Grooming and the
 * worker both read it as the directive, so a hallucinated requirement here
 * becomes a branch of hallucinated code that costs an hour of agent time to
 * find out.
 */
export function deliveryOutcome(item: BacklogItemData, runId: string): string {
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
  ].join('\n').slice(0, MAX_OUTCOME_CHARS);
}

const bullets = (xs: readonly string[] | undefined) => (xs ?? []).map((x) => x.trim()).filter(Boolean).map((x) => `- ${x}`).join('\n');

/** The accepted backlog brief, as the fields a development delivery holds.
 *  Grooming on `/jkai/develop` starts from these instead of from a blank. */
export function deliveryRequest(item: BacklogItemData, runId: string): DeliveryRequest {
  const g = item.grooming;
  return {
    title: item.title,
    backlogSlug: item.slug,
    outcome: deliveryOutcome(item, runId),
    criteria: (g?.acceptanceCriteria ?? []).map((c) => c.trim()).filter(Boolean),
    brief: g ? {
      constraints: bullets([...g.constraints, ...g.nonGoals.map((n) => `Not in scope: ${n}`)]),
      dependencies: bullets(g.dependencies),
      assumptions: bullets(g.assumptions),
      validation: bullets(g.validation),
      questions: bullets(g.openQuestions),
    } : {},
  };
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

  // ── Repo changes → development deliveries ─────────────────────────────────
  reportWaiting(REPO_BUILD_KINDS, 'repo build(s)');
  // More candidates than slots, so an item that is already building hands its
  // slot to the next tapped one instead of ending the night.
  const featureWork = pickWork(tapped, REPO_BUILD_KINDS, WORK_CAPS.deliveryCandidates);
  if (featureWork.length === 0) return actions;
  if (!lanes.startDelivery) {
    actions.push({ kind: 'proposal', detail: 'no delivery lane on this host — nothing dispatched' });
    return actions;
  }

  let dispatched = 0;
  for (const item of featureWork) {
    if (dispatched >= WORK_CAPS.maxDeliveries) break;
    if (budget.timeLeftMs() < WORK_CAPS.reserveWallMs) break;
    try {
      const res = await lanes.startDelivery(deliveryRequest(item, runId));
      if (res.reused) {
        // The same idea already has a live delivery: point at it, spend
        // nothing, and leave tonight's slot for the next tapped item.
        await recordBuildRef(item, res.ref, runId);
        actions.push({ kind: 'proposal', detail: `${item.slug}: already in development — ${res.label}` });
        continue;
      }
      dispatched++;
      await markAttempt(item, { status: 'open', runId, buildRef: res.ref });
      actions.push({
        kind: 'delivery_started',
        detail: `${res.label} — "${item.title}"`,
        story: {
          subject: item.title,
          driver: (item.grooming?.problem || item.detail).slice(0, 400),
          driverRef: item.slug,
          solution: `Started a development delivery from the accepted brief (${res.label}).`,
          outcome: 'Autopilot grooms, builds, previews and reviews it against its criteria, then opens a PR; nothing merges itself.',
        },
      });
    } catch (err) {
      const reason = errMsg(err).slice(0, 300);
      await markAttempt(item, { status: 'open', error: reason, runId });
      actions.push({ kind: 'proposal', detail: `Delivery for "${item.title}" failed: ${reason}` });
    }
  }

  return actions;
}
