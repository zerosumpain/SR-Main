import { db } from '$lib/db';
import { jkaiBuilds, jkaiIterations } from '$lib/db/schema';
import { eq, and, desc, asc, isNotNull } from 'drizzle-orm';
import { checkBudget } from './budget';
import {
  ensureSandboxRunning,
  ensureWorkspace,
  ensureGitWorkspace,
  publishViaGit,
  listWorkspaceFiles,
  seedDevFromLive,
  promoteDevToLive,
  countBuiltChapters,
  writeStudioSpine,
  snapshotIteration,
  execInSandbox,
  type GitTargetConfig,
} from './sandbox';
import { manageServeConfig } from './serve-manager';
import { describeDbError } from './db-error';
import {
  isTransientProviderFailure,
  transientBackoffMs,
  MAX_CONSECUTIVE_TRANSIENT,
} from './transient-failure';
import { failOrphanedIterations } from './orchestrator-helpers';
import { executeIteration } from './executor';
import { runTests, extractDiagnostics, formatTestSummary } from './test-runner';
import { emitLog, onBuildLog } from './log-emitter';
import { planBuild, replanBuild } from './planner';
import type { BudgetConfig, FailureEnvelope } from './types';
import { emitStage } from './stage-events';
import { notifyAllSubscribers } from '$lib/server/push';

/**
 * How often a running iteration stamps `jkai_builds.heartbeat_at`.
 * Must stay well under STALE_BUILD_MS in the sidecar's reaper, and the reaper's
 * threshold must in turn exceed the 20-minute gate cap — a 5-minute rule like
 * the workflow reaper's would kill perfectly healthy builds mid-gate.
 */
const LIVENESS_PING_MS = 15_000;

/**
 * How quiet a `running` build must go before the reaper calls it abandoned.
 * Above the gate's 1_200_000 ms cap with room to spare — see reapStaleBuilds.
 */
const STALE_BUILD_MS = 30 * 60_000;

/**
 * Kit files the studio gate checks are actually served (see runStudioGate's
 * chapter-0 `kit-missing` check). Paths relative to the served root, matching
 * where `syncExplainerKit` (./sandbox) mounts the kit — `dev/explainer-kit/`.
 *
 * This is a small sample, not the full `EXPLAINER_FILES` list from
 * design-assets.ts — deliberately, but NOT because some of those files are
 * "referenced in place" and others get copied. They don't split that way:
 * `promoteDevToLive` does an unconditional `cp -a dev/. live/` every
 * iteration, so every file under `dev/explainer-kit/` — copied by the agent
 * elsewhere or not, edited or not — is physically present under
 * `live/explainer-kit/` regardless. (An earlier version of this comment
 * claimed tokens.css/three.min.js are referenced at the mount path while
 * sim.js/diagram.js get relocated; the kit's own worked example,
 * static/explainer-kit/examples/chapter.html, references tokens.css with
 * `href="../tokens.css"` exactly like it references the JS modules, and
 * VENDOR.md documents three.min.js as copied too — so that distinction was
 * wrong and is not the reason for this list.)
 *
 * What this check actually tests is one binary fact: does the build's own
 * server expose the `/explainer-kit/` subtree at all. If it does, any file
 * in it will resolve, so a handful is exactly as informative as all nine —
 * checking more would only mean more HTTP round trips for the same yes/no
 * answer. If it doesn't (the server is scoped to a `public/`/`dist/`
 * subdirectory that excludes the mount), every file in the list 404s
 * together, which is itself the signal worth surfacing — see the
 * kit-missing remedy in scripts/studio-gate.mjs, which now names that as the
 * more likely, and agent-fixable, cause.
 */
const STUDIO_KIT_CHECK_FILES = ['explainer-kit/tokens.css', 'explainer-kit/three.min.js', 'explainer-kit/README.md'];

export { onBuildLog } from './log-emitter';

/**
 * Detect whether an iteration's evaluation signals the project is complete.
 * Looks for strong completion signals in the evaluation text.
 */
function detectCompletion(evaluation: string | null): boolean {
  if (!evaluation) return false;
  const lower = evaluation.toLowerCase();

  // Look for completion percentages anchored to progress/completion context
  // Must be near words like "complete", "done", "progress", "goal" to avoid false positives
  // like "95% of tests passing" or "95% of CSS work done"
  const pctMatch = lower.match(/(?:progress|complete|done|goal|finished|overall)[^.]{0,30}(\d+)\s*%|(\d+)\s*%[^.]{0,30}(?:complete|done|finished|overall)/);
  const pctValue = pctMatch ? parseInt(pctMatch[1] || pctMatch[2]) : 0;
  if (pctValue >= 95) return true;

  // Strong completion phrases
  const completionPhrases = [
    'project is complete',
    'project complete',
    'all features implemented',
    'all features have been implemented',
    'fully complete',
    'fully implemented',
    'nothing remains',
    'no remaining work',
    'all goals achieved',
    'all objectives met',
    'everything is working',
    'all requirements met',
    'all requirements have been met',
    'project is finished',
    'build is complete',
  ];

  return completionPhrases.some((phrase) => lower.includes(phrase));
}

// --- Orchestrator Singleton ---

type QueuedAction =
  | { kind: 'start' }
  | { kind: 'resume' }
  | { kind: 'restart' }
  | { kind: 'approvePlan' }
  | { kind: 'skipPlan' }
  | { kind: 'approveIteration' }
  | { kind: 'replan'; revisedPrompt?: string }
  | { kind: 'continue'; prompt: string; modelOverride?: { provider?: string; modelId?: string } }
  | { kind: 'rejectIteration'; notes: string };

class Orchestrator {
  private activeBuildId: string | null = null;
  private loopTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  // Mutable deadline for the currently-executing iteration's Pi process.
  // The UI can push this back via extendDeadline() to grant more time.
  private currentDeadline: { current: number } | null = null;
  // Re-entrancy guard: when an entry-point is being called by dequeueNext()
  // itself, we want to bypass the "queue if active" check. Without this,
  // dequeueNext could see activeBuildId still set during an in-progress
  // transition and re-queue the build it was trying to dispatch.
  private dequeueing = false;

  extendDeadline(buildId: string, additionalMs: number): number | null {
    if (this.activeBuildId !== buildId || !this.currentDeadline) return null;
    this.currentDeadline.current += additionalMs;
    return this.currentDeadline.current;
  }

  getCurrentDeadline(buildId: string): number | null {
    if (this.activeBuildId !== buildId || !this.currentDeadline) return null;
    return this.currentDeadline.current;
  }

  async startBuild(buildId: string): Promise<void> {
    if (this.activeBuildId && this.activeBuildId !== buildId && !this.dequeueing) {
      await this.enqueue(buildId, { kind: 'start' });
      return;
    }

    this.activeBuildId = buildId;
    this.stopped = false;

    await db
      .update(jkaiBuilds)
      .set({ status: 'running', queuedAction: null, queuedAt: null, updatedAt: new Date() })
      .where(eq(jkaiBuilds.id, buildId));

    await emitLog(buildId, 'system', 'Build started');
    await emitStage(buildId, { stage: 'planning' });

    // Run setup and planning asynchronously so the API returns immediately
    this.initAndPlan(buildId).catch(async (err) => {
      await emitLog(buildId, 'error', `Build init failed: ${err.message}`);
      await emitStage(buildId, { stage: 'failed', failureKind: 'init_error', message: err.message });
      await db
        .update(jkaiBuilds)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(eq(jkaiBuilds.id, buildId));
      if (this.activeBuildId === buildId) {
        this.activeBuildId = null;
        await this.dequeueNext();
      }
    });
  }

  async pauseBuild(buildId: string): Promise<void> {
    // Pause is also valid for queued builds — flip status to paused and clear
    // the queue entry so the user sees a coherent state.
    const wasActive = this.activeBuildId === buildId;
    if (wasActive) {
      this.stopped = true;
      if (this.loopTimer) clearTimeout(this.loopTimer);
      this.loopTimer = null;
      this.activeBuildId = null;
    }

    // Mark any running iterations as failed (they were interrupted)
    await failOrphanedIterations(buildId);

    await db
      .update(jkaiBuilds)
      .set({ status: 'paused', queuedAction: null, queuedAt: null, updatedAt: new Date() })
      .where(eq(jkaiBuilds.id, buildId));

    await emitLog(buildId, 'system', 'Build paused');
    await emitStage(buildId, { stage: 'paused' });

    if (wasActive) await this.dequeueNext();
  }

  /**
   * Pure restart from the last good iteration. Use after a service restart
   * killed the in-flight pi process and `recoverOnStartup` marked the build
   * `failed` — no new instructions, no re-planning, just clear the failure
   * flag and schedule the next iteration. The dev/ workspace still has
   * whatever pi wrote before it was killed.
   */
  async restartBuild(buildId: string): Promise<void> {
    if (this.activeBuildId && this.activeBuildId !== buildId && !this.dequeueing) {
      await this.enqueue(buildId, { kind: 'restart' });
      return;
    }
    await failOrphanedIterations(buildId);
    await db
      .update(jkaiBuilds)
      .set({
        status: 'running',
        failure: null,
        consecutiveFailures: 0,
        queuedAction: null,
        queuedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(jkaiBuilds.id, buildId));
    await emitLog(buildId, 'system', 'Build restarted — picking up from last good iteration.');
    this.activeBuildId = buildId;
    this.stopped = false;
    this.scheduleNext(buildId);
  }

  async resumeBuild(buildId: string): Promise<void> {
    if (this.activeBuildId && this.activeBuildId !== buildId && !this.dequeueing) {
      await this.enqueue(buildId, { kind: 'resume' });
      return;
    }

    // Clean up any orphaned running iterations before resuming
    await failOrphanedIterations(buildId);

    this.activeBuildId = buildId;
    this.stopped = false;

    await db
      .update(jkaiBuilds)
      .set({ status: 'running', queuedAction: null, queuedAt: null, updatedAt: new Date() })
      .where(eq(jkaiBuilds.id, buildId));

    await emitLog(buildId, 'system', 'Build resumed');
    await emitStage(buildId, { stage: 'iterating' });
    this.scheduleNext(buildId);
  }

  async stopBuild(buildId: string): Promise<void> {
    const wasActive = this.activeBuildId === buildId;
    if (wasActive) {
      this.stopped = true;
      if (this.loopTimer) clearTimeout(this.loopTimer);
      this.loopTimer = null;
      this.activeBuildId = null;
    }

    // Mark any running iterations as failed
    await failOrphanedIterations(buildId);

    // Don't paint over a build that already failed. This set `completed`
    // unconditionally and never cleared the `failure` envelope `abortBuild`
    // had written, so builds whose every iteration was killed by the token cap
    // ended up reading `status='completed'` with `consecutive_failures=2` and
    // a populated failure — and `build_inspect` reported them as completed.
    const [current] = await db
      .select({ failure: jkaiBuilds.failure })
      .from(jkaiBuilds)
      .where(eq(jkaiBuilds.id, buildId))
      .limit(1);
    await db
      .update(jkaiBuilds)
      .set({
        status: current?.failure ? 'failed' : 'completed',
        queuedAction: null,
        queuedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(jkaiBuilds.id, buildId));

    await emitLog(buildId, 'system', 'Build stopped by user');
    await emitStage(buildId, { stage: 'completed', message: 'Stopped by user' });

    if (wasActive) await this.dequeueNext();
  }

  async continueBuild(
    buildId: string,
    improvementPrompt: string,
    modelOverride?: { provider?: string; modelId?: string },
  ): Promise<void> {
    if (this.activeBuildId && this.activeBuildId !== buildId && !this.dequeueing) {
      await this.enqueue(buildId, { kind: 'continue', prompt: improvementPrompt, modelOverride });
      return;
    }

    const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, buildId));
    if (!build) throw new Error('Build not found');

    // Clean up any orphaned running iterations
    await failOrphanedIterations(buildId);

    this.activeBuildId = buildId;
    this.stopped = false;

    // Append the improvement prompt to the original build prompt
    const combinedPrompt = `${build.prompt}\n\n--- Continuation ---\nThe project above has been built. The user now wants the following improvements:\n${improvementPrompt}`;

    // Bump activeMinutesUsed down by maxTotalMinutes so the continuation
    // gets a fresh time budget. Without this, any build that hit its cap
    // before is unrecoverable — the first iteration's checkBudget() trips
    // instantly and the build "completes" without running. Subtracting
    // (rather than zeroing) preserves the historical "minutes ever burned"
    // figure for accounting across multiple continuations.
    const cfg = (build.budgetConfig ?? {}) as BudgetConfig;
    const carryover = cfg.maxTotalMinutes
      ? Math.max(0, build.activeMinutesUsed - cfg.maxTotalMinutes)
      : build.activeMinutesUsed;

    const updates: Record<string, unknown> = {
      status: 'running',
      prompt: combinedPrompt,
      updatedAt: new Date(),
      failure: null,
      consecutiveFailures: 0,
      queuedAction: null,
      queuedAt: null,
      activeMinutesUsed: carryover,
    };
    if (modelOverride?.provider) updates.modelProvider = modelOverride.provider;
    if (modelOverride?.modelId) updates.modelId = modelOverride.modelId;

    await db.update(jkaiBuilds).set(updates).where(eq(jkaiBuilds.id, buildId));

    const modelNote = modelOverride?.provider || modelOverride?.modelId
      ? ` (model: ${modelOverride.provider ?? build.modelProvider}/${modelOverride.modelId ?? build.modelId})`
      : '';
    await emitLog(buildId, 'system', `Build continuing with new objectives${modelNote}: ${improvementPrompt.slice(0, 200)}`);

    // Run a fresh planning debate with full context of existing work, then resume iterations
    this.initContinuation(buildId, combinedPrompt).catch(async (err) => {
      await emitLog(buildId, 'error', `Continuation init failed: ${err.message}`);
      await db
        .update(jkaiBuilds)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(eq(jkaiBuilds.id, buildId));
      this.activeBuildId = null;
      await this.dequeueNext();
    });
  }

  private async initContinuation(buildId: string, combinedPrompt: string): Promise<void> {
    await ensureSandboxRunning();

    // Remove the old plan iteration (#0) so planBuild can create a fresh one
    await db
      .delete(jkaiIterations)
      .where(
        and(
          eq(jkaiIterations.buildId, buildId),
          eq(jkaiIterations.number, 0),
        ),
      );

    // Gather context from existing iterations
    const completedIterations = await db
      .select()
      .from(jkaiIterations)
      .where(
        and(
          eq(jkaiIterations.buildId, buildId),
          eq(jkaiIterations.status, 'completed'),
        ),
      )
      .orderBy(jkaiIterations.number);

    const existingWork = completedIterations
      .filter((it) => it.number > 0)
      .map((it) => `### Iteration ${it.number}\n${it.evaluation || 'No evaluation'}`)
      .join('\n\n');

    const fileList = await listWorkspaceFiles(buildId);

    // Augment the prompt with existing work context
    const contextPrompt = `${combinedPrompt}\n\n--- Existing Work ---\nThe following iterations have already been completed:\n${existingWork}\n\nCurrent workspace files:\n${fileList || '(empty)'}\n\nPlan the next set of iterations to deliver the improvements. Build on what exists — do not start over.`;

    // Run a new 3-round planning debate
    await planBuild(buildId, contextPrompt);

    if (!this.stopped) {
      this.scheduleNext(buildId);
    }
  }

  getActiveBuildId(): string | null {
    return this.activeBuildId;
  }

  /**
   * Park a build behind the currently-active one. Called by every entry point
   * that previously threw "another build is active". The recorded action is
   * what the user actually wanted (start / resume / continue with prompt /
   * etc.) — `dequeueNext` replays it when the active build clears.
   */
  private async enqueue(buildId: string, action: QueuedAction): Promise<void> {
    await db
      .update(jkaiBuilds)
      .set({
        status: 'queued',
        queuedAction: action,
        queuedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(jkaiBuilds.id, buildId));
    const ahead = await db
      .select()
      .from(jkaiBuilds)
      .where(eq(jkaiBuilds.status, 'queued'))
      .orderBy(asc(jkaiBuilds.queuedAt));
    const position = ahead.findIndex((b) => b.id === buildId);
    const positionLabel = position >= 0 ? ` (#${position + 1} in queue)` : '';
    const activeLabel = this.activeBuildId ? ` behind ${this.activeBuildId.slice(0, 8)}` : '';
    await emitLog(buildId, 'system', `Queued${activeLabel}${positionLabel} — will start when the active build finishes.`);
    await emitStage(buildId, { stage: 'queued' as any, message: `Queued${positionLabel}` } as any);
  }

  /**
   * Pop the oldest queued build and re-issue the action the user originally
   * requested. Called after every clean termination of the active build
   * (paused / stopped / completed / failed / awaiting approval). Re-entry
   * is guarded by `dequeueing` so the entry-point methods know to bypass
   * their own enqueue check.
   */
  private async dequeueNext(): Promise<void> {
    if (this.activeBuildId) return; // race guard — something else took the slot
    const [next] = await db
      .select()
      .from(jkaiBuilds)
      .where(eq(jkaiBuilds.status, 'queued'))
      .orderBy(asc(jkaiBuilds.queuedAt))
      .limit(1);
    if (!next) return;
    const action = (next.queuedAction as QueuedAction | null) ?? { kind: 'start' };
    this.dequeueing = true;
    try {
      switch (action.kind) {
        case 'start':       await this.startBuild(next.id); break;
        case 'resume':      await this.resumeBuild(next.id); break;
        case 'restart':     await this.restartBuild(next.id); break;
        case 'approvePlan': await this.approvePlan(next.id); break;
        case 'skipPlan':    await this.skipPlan(next.id); break;
        case 'replan':      await this.replan(next.id, action.revisedPrompt); break;
        case 'continue':    await this.continueBuild(next.id, action.prompt, action.modelOverride); break;
        case 'approveIteration': await this.approveIteration(next.id); break;
        case 'rejectIteration':  await this.rejectIteration(next.id, action.notes); break;
        default: {
          // Unknown action — clear the queue entry so we don't loop forever.
          await db
            .update(jkaiBuilds)
            .set({ status: 'paused', queuedAction: null, queuedAt: null, updatedAt: new Date() })
            .where(eq(jkaiBuilds.id, next.id));
        }
      }
    } catch (err: any) {
      await emitLog(next.id, 'error', `Dequeue failed: ${err.message}`);
      await db
        .update(jkaiBuilds)
        .set({ status: 'failed', queuedAction: null, queuedAt: null, updatedAt: new Date() })
        .where(eq(jkaiBuilds.id, next.id));
      // Try the next one.
      this.dequeueing = false;
      await this.dequeueNext();
      return;
    } finally {
      this.dequeueing = false;
    }
  }

  /**
   * Pull a build out of the queue without starting it. Status flips to
   * paused so the user can resume manually (or delete) later.
   */
  async cancelQueued(buildId: string): Promise<void> {
    const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, buildId));
    if (!build) throw new Error('build not found');
    if (build.status !== 'queued') return; // idempotent
    await db
      .update(jkaiBuilds)
      .set({ status: 'paused', queuedAction: null, queuedAt: null, updatedAt: new Date() })
      .where(eq(jkaiBuilds.id, buildId));
    await emitLog(buildId, 'system', 'Removed from queue.');
    await emitStage(buildId, { stage: 'paused' });
  }

  async recoverOnStartup(): Promise<void> {
    // Mark every build that was mid-flight as failed. A pi subprocess lives
    // in our process tree, so a systemctl restart kills it mid-iteration —
    // there is no safe way to resume from that state. The user can retry
    // with /continue if they want to pick up the work.
    const runningBuilds = await db
      .select()
      .from(jkaiBuilds)
      .where(eq(jkaiBuilds.status, 'running'));

    for (const build of runningBuilds) {
      await failOrphanedIterations(build.id);
      await db
        .update(jkaiBuilds)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(eq(jkaiBuilds.id, build.id));
      await emitLog(
        build.id,
        'error',
        'Service restarted mid-build — marked failed. Use Continue to pick up from the last good iteration.',
      );
    }

    // Queued builds survive a restart — kick the next one in line.
    await this.dequeueNext();
  }

  /**
   * Reap builds whose liveness ping has gone quiet.
   *
   * The boot sweep above only runs when the sidecar restarts, which covers the
   * common case (a deploy) and nothing else. A wedged or killed sidecar that
   * never comes back leaves a row `running` with a frozen timestamp forever,
   * and every tool that reads it keeps reporting a healthy build.
   *
   * The threshold deliberately exceeds the gate's own 20-minute cap — copying
   * the workflow reaper's 5-minute rule here would kill healthy builds mid-gate.
   * A build that predates this column (heartbeat_at NULL) is judged on
   * updated_at instead, so old rows aren't immortal.
   */
  async reapStaleBuilds(): Promise<number> {
    const cutoff = new Date(Date.now() - STALE_BUILD_MS);
    const running = await db
      .select({
        id: jkaiBuilds.id,
        heartbeatAt: jkaiBuilds.heartbeatAt,
        updatedAt: jkaiBuilds.updatedAt,
      })
      .from(jkaiBuilds)
      .where(eq(jkaiBuilds.status, 'running'));

    let reaped = 0;
    for (const b of running) {
      if (this.activeBuildId === b.id) continue; // ours, and alive
      const lastSeen = b.heartbeatAt ?? b.updatedAt;
      if (!lastSeen || lastSeen > cutoff) continue;
      await failOrphanedIterations(b.id);
      await db
        .update(jkaiBuilds)
        .set({
          status: 'failed',
          failure: { kind: 'abandoned', message: `No liveness ping since ${lastSeen.toISOString()}.` },
          updatedAt: new Date(),
        })
        .where(eq(jkaiBuilds.id, b.id));
      await emitLog(b.id, 'error', 'Build abandoned — no liveness ping from the builder. Use Continue to pick it up.');
      reaped++;
    }
    if (reaped > 0) console.log(`[orchestrator] reaped ${reaped} abandoned build(s)`);
    return reaped;
  }

  private async initAndPlan(buildId: string): Promise<void> {
    await ensureSandboxRunning();

    const [buildRecord] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, buildId));
    if (!buildRecord || this.stopped) return;

    // Belt and braces: `runIteration` keys the streak counters to the build id
    // and zeroes them when it changes, which covers the paths that never come
    // through here (restart/resume/continue). This keeps the planning entry
    // point honest on its own terms.
    this.consecutiveIdleIterations = 0;
    this.consecutiveTransient = 0;

    // Workspace creation branch-point. Normal builds get the empty dev/live
    // skeleton; git-target builds clone the target repo + branch off base.
    if (buildRecord.gitTargetConfig) {
      await emitLog(buildId, 'system', `Git-target mode — cloning ${buildRecord.gitTargetConfig.repoUrl} and branching off ${buildRecord.gitTargetConfig.baseBranch}.`);
      await ensureGitWorkspace(buildId, buildRecord.gitTargetConfig as GitTargetConfig);
    } else {
      await ensureWorkspace(buildId);
    }

    const isStudio = buildRecord.origin === 'studio';

    // Studio builds run a research stage before the planner — everything the
    // planner (and every chapter after it) writes must trace back to sourced
    // facts, so this has to land before planBuild is ever invoked. Gated on
    // researchBrief already being null so a re-entry into initAndPlan (e.g.
    // replan()) does not re-run 20 minutes of research it already has.
    if (isStudio && !buildRecord.researchBrief) {
      try {
        const { buildResearchBrief } = await import('./research-brief');
        const brief = await buildResearchBrief(
            buildId,
            buildRecord.prompt,
            buildRecord.researchMode ?? 'extend',
          );
        await db.update(jkaiBuilds).set({ researchBrief: brief }).where(eq(jkaiBuilds.id, buildId));
        await emitLog(buildId, 'system', 'Research brief attached — proceeding to planning.');
      } catch (err: any) {
        // Do not fall through to planning. An explainer built without sources
        // is confidently wrong, which is worse than one that does not exist.
        await this.abortBuild(buildId, {
          kind: 'nonzero_exit',
          message: `Research stage failed: ${err.message}`,
          attempts: 1,
        });
        return;
      }
    }

    // Honour planStatus from the create-build form. When planFirst=false
    // the API sets planStatus='approved' at insert time — meaning the user
    // explicitly opted out of the proposer/critic/revision debate. Pre-fix,
    // we ran planBuild() anyway and just threw the 90 seconds of output
    // away because the gate didn't fire. Now: skip the planner entirely
    // and go straight to iteration 1.
    //
    // Studio builds are exempted from this skip. createStudioBuild also sets
    // planStatus='approved', but there it means "no human approval PAUSE"
    // (see the pending-check below) — not "no planner". Without planBuild
    // actually running, a studio build never gets a chapter spine and the
    // research brief attached above is never read by anything.
    const skipPlanning = !isStudio && buildRecord.planStatus !== 'pending';
    if (skipPlanning) {
      await emitLog(
        buildId,
        'system',
        'Skipping planner debate — going straight to iteration 1 (planFirst was off at create-time).',
      );
    } else {
      await planBuild(buildId, buildRecord.prompt);
    }
    if (this.stopped) return;

    // Plan-approval gate: when planStatus === 'pending', park the build
    // awaiting human approval instead of auto-scheduling iteration #1.
    const [refreshed] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, buildId));
    if (refreshed?.planStatus === 'pending') {
      await db
        .update(jkaiBuilds)
        .set({ status: 'awaiting_plan_approval', updatedAt: new Date() })
        .where(eq(jkaiBuilds.id, buildId));
      await emitLog(
        buildId,
        'system',
        'Plan ready — awaiting approval before iterations begin.',
      );
      await emitStage(buildId, { stage: 'awaiting_plan_approval' });
      this.activeBuildId = null;
      await this.dequeueNext();
      return;
    }

    await emitStage(buildId, { stage: 'iterating', iteration: 1 });
    this.scheduleNext(buildId);
  }

  // --- Plan gate API (called from /api/jkai/builds/[id]/plan) ---

  async approvePlan(buildId: string): Promise<void> {
    const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, buildId));
    if (!build) throw new Error('build not found');
    if (build.planStatus !== 'pending') {
      // Idempotent: silently no-op (double-click, already approved/skipped).
      return;
    }
    if (this.activeBuildId && this.activeBuildId !== buildId && !this.dequeueing) {
      await this.enqueue(buildId, { kind: 'approvePlan' });
      return;
    }

    const [iter0] = await db
      .select()
      .from(jkaiIterations)
      .where(and(eq(jkaiIterations.buildId, buildId), eq(jkaiIterations.number, 0)))
      .limit(1);
    const { parsePlanMilestones } = await import('./plan-parse');
    const milestones = parsePlanMilestones(iter0?.plan ?? null);

    await failOrphanedIterations(buildId);
    await db
      .update(jkaiBuilds)
      .set({
        status: 'running',
        planStatus: 'approved',
        milestones,
        failure: null,
        consecutiveFailures: 0,
        queuedAction: null,
        queuedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(jkaiBuilds.id, buildId));
    await emitLog(buildId, 'system', `Plan approved — starting iterations (${milestones.length} milestones).`);
    await emitStage(buildId, { stage: 'iterating', iteration: 1, totalEstimate: milestones.length });
    this.activeBuildId = buildId;
    this.stopped = false;
    this.scheduleNext(buildId);
  }

  async skipPlan(buildId: string): Promise<void> {
    if (this.activeBuildId && this.activeBuildId !== buildId && !this.dequeueing) {
      await this.enqueue(buildId, { kind: 'skipPlan' });
      return;
    }
    await failOrphanedIterations(buildId);
    await db
      .update(jkaiBuilds)
      .set({
        status: 'running',
        planStatus: 'skipped',
        failure: null,
        consecutiveFailures: 0,
        queuedAction: null,
        queuedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(jkaiBuilds.id, buildId));
    await emitLog(buildId, 'system', 'Plan skipped — proceeding without milestone tracking.');
    await emitStage(buildId, { stage: 'iterating', iteration: 1 });
    this.activeBuildId = buildId;
    this.stopped = false;
    this.scheduleNext(buildId);
  }

  async replan(buildId: string, revisedPrompt?: string): Promise<void> {
    if (this.activeBuildId && this.activeBuildId !== buildId && !this.dequeueing) {
      await this.enqueue(buildId, { kind: 'replan', revisedPrompt });
      return;
    }
    await failOrphanedIterations(buildId);
    await db
      .delete(jkaiIterations)
      .where(eq(jkaiIterations.buildId, buildId));
    if (revisedPrompt && revisedPrompt.trim()) {
      await db
        .update(jkaiBuilds)
        .set({ prompt: revisedPrompt.trim(), updatedAt: new Date() })
        .where(eq(jkaiBuilds.id, buildId));
    }
    // Studio builds carry no human approval gate: createStudioBuild sets
    // planStatus='approved' at creation, and the Studio UI (BuildSession, the
    // v3 build-detail chrome) has no Approve/Skip/Re-plan control at all — the
    // only surface offering "Re-plan from scratch" is FailureRecovery in the
    // classic BuildDetailV2 view, which is origin-blind and reachable for any
    // failed build. Setting planStatus='pending' below unconditionally, as
    // this did before, would park a re-planned studio build at
    // awaiting_plan_approval with no in-Studio-UI way to un-park it. Self-
    // approve for studio the same way creation does, instead of parking.
    const [existing] = await db
      .select({ origin: jkaiBuilds.origin })
      .from(jkaiBuilds)
      .where(eq(jkaiBuilds.id, buildId))
      .limit(1);
    const isStudio = existing?.origin === 'studio';
    await db
      .update(jkaiBuilds)
      .set({
        status: 'running',
        planStatus: isStudio ? 'approved' : 'pending',
        failure: null,
        consecutiveFailures: 0,
        iterationsCompleted: 0,
        queuedAction: null,
        queuedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(jkaiBuilds.id, buildId));
    this.activeBuildId = buildId;
    this.stopped = false;
    await emitLog(buildId, 'system', 'Re-planning — wiping previous iterations and starting fresh.');
    await this.initAndPlan(buildId);
  }

  async editPlan(buildId: string, plan: string): Promise<void> {
    await db
      .update(jkaiIterations)
      .set({ plan })
      .where(and(eq(jkaiIterations.buildId, buildId), eq(jkaiIterations.number, 0)));
  }

  // --- Iteration-approval API (Phase 2) ---

  async approveIteration(buildId: string): Promise<void> {
    if (this.activeBuildId && this.activeBuildId !== buildId && !this.dequeueing) {
      await this.enqueue(buildId, { kind: 'approveIteration' });
      return;
    }
    const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, buildId));
    if (!build) throw new Error('build not found');
    if (build.status !== 'awaiting_iter_approval' && build.status !== 'queued') return;
    await db
      .update(jkaiBuilds)
      .set({ status: 'running', queuedAction: null, queuedAt: null, updatedAt: new Date() })
      .where(eq(jkaiBuilds.id, buildId));
    await emitLog(buildId, 'system', 'Iteration approved — continuing.');
    this.activeBuildId = buildId;
    this.stopped = false;
    this.scheduleNext(buildId);
  }

  async rejectIteration(buildId: string, notes: string): Promise<void> {
    if (this.activeBuildId && this.activeBuildId !== buildId && !this.dequeueing) {
      await this.enqueue(buildId, { kind: 'rejectIteration', notes });
      return;
    }
    const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, buildId));
    if (!build) throw new Error('build not found');
    if (build.status !== 'awaiting_iter_approval' && build.status !== 'queued') return;
    const trimmed = (notes ?? '').trim();
    const combinedPrompt = trimmed
      ? `${build.prompt}\n\n--- Iteration rejected ---\n${trimmed}`
      : build.prompt;
    await db
      .update(jkaiBuilds)
      .set({ status: 'running', prompt: combinedPrompt, queuedAction: null, queuedAt: null, updatedAt: new Date() })
      .where(eq(jkaiBuilds.id, buildId));
    await emitLog(
      buildId,
      'system',
      trimmed
        ? `Iteration rejected with notes: ${trimmed.slice(0, 200)}`
        : 'Iteration rejected — continuing without notes.',
    );
    this.activeBuildId = buildId;
    this.stopped = false;
    this.scheduleNext(buildId);
  }

  // --- Private: Loop ---

  private scheduleNext(buildId: string, delayMs = 0): void {
    this.loopTimer = setTimeout(() => this.runIteration(buildId), delayMs);
  }

  private async runIteration(buildId: string): Promise<void> {
    if (this.stopped || this.activeBuildId !== buildId) return;

    // Liveness ping for the whole iteration, including the gate. `updated_at`
    // is only stamped at iteration boundaries, and the gate can run for twenty
    // minutes writing nothing — so without this a build in the gate and a build
    // whose sidecar died look identical to every reader. Same shape as the
    // workflow engine's run heartbeat: a ticker around the long await, cleared
    // in `finally`.
    const liveness = this.startLivenessTicker(buildId);

    try {
      // Re-fetch build to get latest counters
      const [build] = await db
        .select()
        .from(jkaiBuilds)
        .where(eq(jkaiBuilds.id, buildId));

      if (!build || build.status !== 'running') return;

      // The streak counters below are per-BUILD, but they live on the
      // orchestrator instance, which outlives any one build. Only
      // `initAndPlan` ever zeroed them, and `restartBuild`, `resumeBuild` and
      // `continueBuild` all reach an iteration without passing through it — so
      // a build dequeued after one that ended on three idle iterations began
      // life on three, and aborted as `no_progress` the first time it wrote
      // nothing. Keying them to the build makes that unreachable by
      // construction, including from entry points added later.
      if (this.countersBuildId !== buildId) {
        this.countersBuildId = buildId;
        this.consecutiveIdleIterations = 0;
        this.consecutiveTransient = 0;
      }

      const budget = await checkBudget(build);
      if (!budget.canProceed) {
        if (budget.shouldComplete) {
          await db
            .update(jkaiBuilds)
            .set({ status: 'completed', updatedAt: new Date() })
            .where(eq(jkaiBuilds.id, buildId));
          await emitLog(buildId, 'system', `Build completed: ${budget.reason}`);
          this.activeBuildId = null;
          await this.dequeueNext();
          return;
        }
        await emitLog(buildId, 'system', `Cooling down: ${budget.reason}`);
        this.scheduleNext(buildId, budget.sleepMs || 60000);
        return;
      }

      // Get the highest iteration number (completed or failed) to avoid duplicates
      const [lastIteration] = await db
        .select()
        .from(jkaiIterations)
        .where(eq(jkaiIterations.buildId, buildId))
        .orderBy(desc(jkaiIterations.number))
        .limit(1);

      // Get last completed iteration for context
      const [prevIteration] = await db
        .select()
        .from(jkaiIterations)
        .where(
          and(
            eq(jkaiIterations.buildId, buildId),
            eq(jkaiIterations.status, 'completed'),
          ),
        )
        .orderBy(desc(jkaiIterations.number))
        .limit(1);

      const iterationNumber = (lastIteration?.number || 0) + 1;

      // If the previous iteration failed with empty_output, this one is a retry
      // with a corrective prompt nudge. Track that so the retry's own failure
      // signals the build-level abort rather than another retry.
      const isEmptyOutputRetry =
        lastIteration?.status === 'failed' &&
        (lastIteration.failure as FailureEnvelope | null)?.kind === 'empty_output';

      const [iteration] = await db
        .insert(jkaiIterations)
        .values({
          buildId,
          number: iterationNumber,
          status: 'running',
          retryOfIterationId: isEmptyOutputRetry ? lastIteration!.id : null,
        })
        .returning();

      await emitLog(buildId, 'system', `━━━ Iteration #${iterationNumber} started ━━━`, iteration.id);
      await emitStage(buildId, {
        stage: 'iterating',
        iteration: iterationNumber,
        totalEstimate: (build.milestones as Array<{ done: boolean }> | undefined)?.length,
      }, iteration.id);

      // Fetch the project plan (iteration #0) if it exists
      const [planIteration] = await db
        .select()
        .from(jkaiIterations)
        .where(
          and(
            eq(jkaiIterations.buildId, buildId),
            eq(jkaiIterations.number, 0),
            eq(jkaiIterations.status, 'completed'),
          ),
        )
        .limit(1);
      const projectPlan = planIteration?.plan || null;

      // Seed dev from live so the LLM starts with the latest working version
      await seedDevFromLive(buildId);

      // Put the spine where the agent's own checker reads it, before the agent
      // runs. Refreshed every iteration so a re-plan cannot leave a stale copy
      // that quietly disagrees with what the gate is looking for.
      if (build.origin === 'studio' && build.chapterPlan.length > 0) {
        await writeStudioSpine(buildId, {
          chapters: build.chapterPlan,
          sourceUrls: (build.researchBrief?.facts ?? []).map((f) => f.sourceUrl),
          kitFiles: STUDIO_KIT_CHECK_FILES,
        }).catch(async (err) => {
          // Not fatal: the checker still runs, it just cannot check lever ids
          // or citations. Say so rather than letting the agent wonder why.
          await emitLog(
            buildId,
            'system',
            `Could not write the chapter spine for the checker (${
              err instanceof Error ? err.message : String(err)
            }); it will check structure only this iteration.`,
            iteration.id,
          );
        });
      }

      const startTime = Date.now();

      const retryNudge = isEmptyOutputRetry
        ? 'Your previous turn produced no tool calls and no structured evaluation. Re-read the plan and make at least one concrete action this turn.'
        : undefined;

      const deadlineRef = { current: Date.now() + 30 * 60 * 1000 };
      this.currentDeadline = deadlineRef;

      const result = await executeIteration(
        build,
        iteration,
        prevIteration,
        projectPlan,
        iterationNumber,
        () => this.stopped,
        retryNudge,
        deadlineRef,
      );

      this.currentDeadline = null;

      const durationMs = Date.now() - startTime;
      const failure = result.failure;
      const iterationStatus: 'completed' | 'failed' = failure ? 'failed' : 'completed';

      // Promote FIRST — before the transcript write, before the counters,
      // before every early return below.
      //
      // Promotion used to happen only via manageServeConfig on the happy path.
      // Anything that returned early skipped it, and seedDevFromLive then
      // deleted dev/ at the top of the next iteration. Build 85dac418 lost 57%
      // of its total tokens that way: 33% to ordinary provider overload and
      // 24% to a database write that threw on NUL bytes, each one costing a
      // completed chapter's worth of files.
      //
      // Ordering is the whole point, so this cannot move below the write that
      // was throwing. Its own failure is logged and swallowed: a promotion
      // problem must not cost us the transcript as well as the files.
      try {
        await promoteDevToLive(buildId);
      } catch (err) {
        await emitLog(
          buildId,
          'error',
          `Could not promote dev → live after iteration #${iterationNumber}: ${
            err instanceof Error ? err.message : String(err)
          }. The work is still in the workspace at dev/ and the next iteration will keep it.`,
          iteration.id,
        );
      }

      await db
        .update(jkaiIterations)
        .set({
          status: iterationStatus,
          goals: result.goals,
          plan: result.plan,
          actions: result.actions,
          messages: result.messages,
          evaluation: result.evaluation,
          nextSteps: result.nextSteps,
          tokensUsed: result.tokensUsed,
          durationMs,
          failure: failure as unknown as Record<string, unknown> | null,
        })
        .where(eq(jkaiIterations.id, iteration.id));

      // Build counters. A BUDGET STOP IS NOT A FAULT: wall_clock_timeout and
      // iteration_token_cap both mean Pi did useful work and ran out of
      // allowance, and both are explicitly continuable below — the work is in
      // dev/ and the next iteration picks it up. Counting them toward
      // consecutive_failures made the second one abort the build, which is how
      // change request #159 died with two capped iterations and a draft PR of
      // rescued work nobody was told about.
      // A transient upstream failure is the provider saying "not now", not the
      // build being wrong — so it must not count towards the consecutive-failure
      // abort, exactly as wall-clock and token-cap stops already do not.
      const transient = isTransientProviderFailure(failure);
      const counts =
        failure &&
        failure.kind !== 'wall_clock_timeout' &&
        failure.kind !== 'iteration_token_cap' &&
        !transient;
      const newConsecutiveFailures = counts ? build.consecutiveFailures + 1 : failure ? build.consecutiveFailures : 0;
      await db
        .update(jkaiBuilds)
        .set({
          // A transient upstream failure does not spend an iteration. The
          // provider never answered, so there is no work to have used one up,
          // and this counter feeds exactly one thing: the `maxIterations` check
          // in budget.ts. (Iteration NUMBERING comes from the last iteration
          // row, not from here, so nothing collides.)
          //
          // Change request #223 lost 3 of its 25 slots to Codex
          // `server_is_overloaded` — and because budget.ts files a build that
          // exhausts maxIterations as `completed`, a build killed by someone
          // else's load would have been recorded as having finished.
          iterationsCompleted: transient ? build.iterationsCompleted : build.iterationsCompleted + 1,
          tokensUsed: build.tokensUsed + result.tokensUsed,
          // Wall-clock accrues whatever the iteration actually burned, pass or
          // fail. It used to accrue only on success, so a build whose every
          // iteration failed reported 0 active minutes and maxTotalMinutes
          // could never bind — contradicting the comment in budget.ts that says
          // a failed iteration costs as much as a successful one.
          activeMinutesUsed: build.activeMinutesUsed + durationMs / 60000,
          consecutiveFailures: newConsecutiveFailures,
          updatedAt: new Date(),
        })
        .where(eq(jkaiBuilds.id, buildId));

      // --- Abort paths ---
      //
      // 1. empty_output + already a retry → abort (we gave it one chance).
      // 2. empty_output + first time     → schedule retry with corrective nudge.
      // 3. wall_clock_timeout            → schedule next iteration (partial work
      //    is preserved in dev/ since live is empty; Pi hit the clock, not a
      //    real failure). max_iterations/maxTotalMinutes budget will still cap.
      // 4. Any other failure kind        → abort immediately.
      // 5. consecutive_failures >= 2     → safety net abort.
      if (failure) {
        const canContinue =
          (failure.kind === 'empty_output' && !isEmptyOutputRetry) ||
          failure.kind === 'wall_clock_timeout' ||
          // Same shape as the wall clock: a budget stop, not a fault. The work
          // is in dev/ and the next iteration picks it up.
          failure.kind === 'iteration_token_cap' ||
          // 6. A transient upstream failure — the provider is overloaded, rate
          //    limiting, or briefly 5xx-ing. Work is preserved in dev/ and the
          //    condition resolves itself; retry after a backoff instead of
          //    throwing the build away.
          transient;
        const shouldAbort = !canContinue || newConsecutiveFailures >= 2;

        if (shouldAbort) {
          await this.abortBuild(buildId, failure);
          return;
        }

        if (transient) {
          // Separate counter from newConsecutiveFailures, which transient
          // failures deliberately do not increment: without its own ceiling a
          // provider that is genuinely down would retry until the budget caps
          // ran out, which is a slow and confusing way to fail.
          this.consecutiveTransient = (this.consecutiveTransient ?? 0) + 1;
          if (this.consecutiveTransient >= MAX_CONSECUTIVE_TRANSIENT) {
            await emitLog(
              buildId,
              'error',
              `The model provider has failed ${this.consecutiveTransient} times in a row (last: ${failure.message}). Giving up — this is an upstream outage, not a problem with the build. The work so far is preserved; resume once the provider recovers.`,
            );
            await this.abortBuild(buildId, failure);
            return;
          }
          const waitMs = transientBackoffMs(this.consecutiveTransient);
          await emitLog(
            buildId,
            'system',
            `Iteration #${iterationNumber} hit a transient provider failure (${failure.message?.slice(0, 120)}). This is the upstream saying "not now", not a fault in the build — retrying in ${Math.round(waitMs / 1000)}s. Attempt ${this.consecutiveTransient} of ${MAX_CONSECUTIVE_TRANSIENT}.`,
          );
          this.scheduleNext(buildId, waitMs);
          return;
        }
        // Any non-transient continue resets the streak.
        this.consecutiveTransient = 0;

        const continueMsg = failure.kind === 'wall_clock_timeout'
          ? `Iteration #${iterationNumber} hit the wall-clock cap while still working — partial work preserved in dev/. Continuing with iteration #${iterationNumber + 1}.`
          : failure.kind === 'iteration_token_cap'
            ? `Iteration #${iterationNumber} hit its token ceiling — partial work preserved in dev/. Continuing with iteration #${iterationNumber + 1}.`
            : `Iteration #${iterationNumber} produced no tool calls — retrying once with a corrective nudge.`;

        await emitLog(
          buildId,
          'system',
          continueMsg,
          iteration.id,
        );
        this.scheduleNext(buildId, 1000);
        return;
      }

      // A clean iteration proves the provider is answering, so the transient
      // streak is over.
      //
      // The only other reset is inside the failure block above, BELOW the
      // transient branch's own `return` — so it was unreachable from a
      // transient failure and never ran on success either. That made
      // `consecutiveTransient` a build-lifetime tally wearing the word
      // "consecutive": on change request #223 four Codex overloads spread
      // across eight iterations escalated the backoff 30s → 60s → 120s → 240s
      // (210 seconds of pure sleep already spent), and two more anywhere in the
      // remaining seventeen iterations would have aborted a working build as an
      // "upstream outage".
      this.consecutiveTransient = 0;

      // Run design-system linter (when enabled). If it finds issues, mark the
      // iteration failed so promotion is skipped and the next iteration's user
      // prompt receives the findings as required fixes.
      //
      // Scoping: the design system targets the SvelteKit personal site —
      // `nm-*` classes, the warm-brutalist palette, no-Tailwind rule. Builds
      // for unrelated projects (a graphing calculator, a python flask app,
      // a static landing page) shouldn't be held to those rules. Skip the
      // linter when the workspace contains no .svelte file.
      if ((build as any).enforceDesignSystem) {
        try {
          const { listDevFiles, readDevFile } = await import('./sandbox');
          const { lintDesignSystem } = await import('./design-lint');
          const targetExts = ['.css', '.svelte', '.html', '.tsx', '.jsx', '.vue'];
          const all = await listDevFiles(buildId);
          const hasSvelte = all.some((f) => f.path.endsWith('.svelte'));
          if (!hasSvelte) {
            await emitLog(
              buildId,
              'system',
              'Design-system linter skipped — no .svelte files in workspace (rules are warm-brutalist Svelte-specific).',
              iteration.id,
            );
          } else {
          const files: Record<string, string> = {};
          for (const f of all) {
            if (!targetExts.some((e) => f.path.endsWith(e))) continue;
            if (f.size > 200_000) continue;
            files[f.path] = await readDevFile(buildId, f.path);
          }
          const { findings } = lintDesignSystem(files);
          if (findings.length > 0) {
            const summary = findings
              .slice(0, 30)
              .map((f) => `${f.path}:${f.line} [${f.rule}] ${f.message}`)
              .join('\n');
            await emitLog(
              buildId,
              'lint',
              `Design-system violations:\n${summary}`,
              iteration.id,
            );
            await db
              .update(jkaiIterations)
              .set({
                status: 'failed',
                failure: {
                  kind: 'design_lint',
                  message: `${findings.length} design-system violations`,
                  findingsCount: findings.length,
                  attempts: 1,
                } as unknown as Record<string, unknown>,
              })
              .where(eq(jkaiIterations.id, iteration.id));
            await emitLog(
              buildId,
              'system',
              `Iteration #${iterationNumber} rejected by design-system linter (${findings.length} findings) — feedback included in next iteration.`,
              iteration.id,
            );

            // Linter-loop guard: if the last 3 iterations all failed design_lint
            // and the findings count never decreased, the model isn't converging
            // (either it doesn't understand the rule or the rule is wrong).
            // Abort instead of burning hours of compute.
            const lastThree = await db
              .select()
              .from(jkaiIterations)
              .where(eq(jkaiIterations.buildId, buildId))
              .orderBy(desc(jkaiIterations.number))
              .limit(3);
            const allDesignLint =
              lastThree.length >= 3 &&
              lastThree.every((i) => (i.failure as any)?.kind === 'design_lint');
            if (allDesignLint) {
              const counts = lastThree.map((i) => (i.failure as any)?.findingsCount ?? 0);
              const noDecrease = counts[0] >= counts[1] && counts[1] >= counts[2];
              if (noDecrease) {
                await this.abortBuild(buildId, {
                  kind: 'design_lint_loop',
                  message: `Design-system linter has rejected 3 consecutive iterations with no decrease in findings (${counts
                    .slice()
                    .reverse()
                    .join(' → ')}). The model isn't converging — review the prompt or the linter rule.`,
                  attempts: 1,
                });
                return;
              }
            }

            // Even on lint failure, surface the preview link so the user
            // can see the still-broken-but-iterating prototype. The agent
            // already has the lint findings in next-iteration context;
            // hiding the running app from the user adds no signal.
            await manageServeConfig(buildId);
            this.scheduleNext(buildId, 1000);
            return;
          }
          } // close: else { ... lint findings block ... }
        } catch (err: any) {
          await emitLog(
            buildId,
            'system',
            `Design lint skipped due to error: ${err.message}`,
            iteration.id,
          );
        }
      }

      // Run test suite. Test/eval branch-point: git-target builds run the
      // configured gate command (e.g. `npm run gate`) as their test — a
      // non-zero exit is a failed iteration whose output feeds the next
      // iteration's context (same shape/contract as runTests, so all the
      // downstream post-processing is unchanged).
      let testResult: { passed: boolean; output: string; testCount: number; failCount: number; diagnostics: string };
      if (build.gitTargetConfig) {
        await emitStage(buildId, { stage: 'running_tests', iteration: iterationNumber }, iteration.id);
        const dev = `/home/jkai/workspace/${buildId}/dev`;
        const runGate = async (cmd: string) => {
          await emitLog(buildId, 'system', `Running gate: ${cmd} ...`, iteration.id);
          // NO_COLOR/FORCE_COLOR: vitest colours its output even through a
          // pipe, and the escapes cost budget in a 2,000-character diagnostic
          // window while making the stored log unreadable. `extractDiagnostics`
          // strips them defensively too — this just stops them being written.
          const g = await execInSandbox(
            `cd ${dev} && NO_COLOR=1 FORCE_COLOR=0 ${cmd} 2>&1`,
            1_200_000,
          );
          return { out: (g.stdout + '\n' + g.stderr).trim(), passed: g.exitCode === 0 };
        };

        // Re-proving a tree nobody touched is the single largest piece of dead
        // time in a stuck build. On change request #223 the gate ran after
        // iterations 1, 4, 5 and 7; iterations 4 and 5 wrote nothing at all, so
        // half the runs re-derived a verdict that could not have changed —
        // ~16 minutes at the gate's old cost.
        //
        // The fingerprint is the working tree against HEAD, with untracked
        // files pulled in by `add -A -N`, so it moves whenever anything the
        // gate could read moves. It fails SAFE: no fingerprint, run the gate.
        const fingerprint = await this.workspaceFingerprint(dev);
        const cached = this.lastGate;
        let gate: { out: string; passed: boolean };

        if (fingerprint && cached && cached.buildId === buildId && cached.fingerprint === fingerprint) {
          gate = { out: cached.out, passed: cached.passed };
          await emitLog(
            buildId,
            'system',
            `Gate skipped — the workspace is unchanged since the last run, which ${
              cached.passed ? 'passed' : 'failed'
            }. Reusing that verdict rather than re-proving it.`,
            iteration.id,
          );
        } else {
          gate = await this.runGateChain(runGate, build.gitTargetConfig);
          if (fingerprint) this.lastGate = { buildId, fingerprint, out: gate.out, passed: gate.passed };
        }

        testResult = {
          passed: gate.passed,
          // The TAIL of a failed run. A downstream fallback reads
          // `output.slice(-1000)` when diagnostics come back empty, and taking
          // the head here meant that "tail" was the tail of the first 5,000
          // characters — still inside the passing banners.
          output: gate.passed ? gate.out.slice(0, 5000) : gate.out.slice(-5000),
          testCount: 1,
          failCount: gate.passed ? 0 : 1,
          // From the FULL output, not the truncated copy: a gate prints its
          // passing steps first, so the useful part is always near the end.
          diagnostics: gate.passed ? '' : extractDiagnostics(gate.out),
        };
      } else {
        await emitLog(buildId, 'system', 'Running tests...', iteration.id);
        await emitStage(buildId, { stage: 'running_tests', iteration: iterationNumber }, iteration.id);
        testResult = await runTests(buildId, `/home/jkai/workspace/${buildId}/dev`);
      }
      const testSummary = formatTestSummary(testResult, durationMs);
      // Show the human what the AGENT was shown, not the head of the transcript.
      // The stored log for every failed gate on change request #223 was 1,996
      // characters of green banners — `check-public-routes: OK`,
      // `svelte-check found 0 errors` — because it was the first 2,000
      // characters of a log whose failure was 14,000 characters further down.
      // Anyone opening the build page saw a gate that looked fine and a build
      // that had stopped, and had to query the database to find out why.
      await emitLog(
        buildId,
        testResult.passed ? 'system' : 'error',
        `${testSummary}\n${testResult.passed ? testResult.output.slice(0, 2000) : testResult.diagnostics || testResult.output.slice(-2000)}`,
        iteration.id,
      );

      // Idle-iteration breaker. An agent that believes it is finished but
      // cannot prove it will re-verify forever — build #131 spent iterations
      // 7, 8 and 9 each concluding "no changes were needed" and re-running a
      // ten-minute gate. Count consecutive iterations that wrote nothing, and
      // stop when they reach the cap: repeating a verification that already
      // failed is not progress, and the human needs to see it.
      const budgetCfg = (build.budgetConfig ?? {}) as BudgetConfig;
      const idleCap = budgetCfg.maxIdleIterations ?? 0;
      if (idleCap > 0) {
        // Deliberately below the abort paths, so an iteration the provider
        // never answered is NEITHER idle nor progress. Moving this up to make
        // the breaker trip sooner was tried and reverted: a Codex overload is
        // not an agent that thinks it has finished, and three of them in a row
        // would abort a healthy build with the words "changed no files", which
        // is both wrong and the hardest kind of wrong to debug. Provider
        // outages are MAX_CONSECUTIVE_TRANSIENT's job.
        const wroteSomething = (result.actions ?? []).some(
          (a) => a.lang === 'write' || a.lang === 'edit',
        );
        this.consecutiveIdleIterations = wroteSomething ? 0 : this.consecutiveIdleIterations + 1;
        if (this.consecutiveIdleIterations >= idleCap) {
          // Say WHAT the gate is objecting to. "no_progress" reads as the
          // agent's failure, and on change request #216 it was not: the work
          // was finished and two one-line type errors were outstanding, neither
          // of which the agent had ever been shown. A reader who sees the
          // diagnostic here can fix it in a minute instead of re-running the
          // build to find out.
          const blocker = testResult.diagnostics
            ? `\n\nThe gate is failing on:\n${testResult.diagnostics.slice(0, 1200)}`
            : '';
          await emitLog(
            buildId,
            'error',
            `${this.consecutiveIdleIterations} iterations in a row changed no files — stopping rather than re-verifying indefinitely. ` +
              `The agent believes the work is done; the gate disagrees, or it is stuck. Read the last evaluation and decide.${blocker}`,
          );
          await this.abortBuild(buildId, {
            kind: 'no_progress',
            message: testResult.diagnostics
              ? `${this.consecutiveIdleIterations} consecutive iterations changed no files while the gate was still failing: ${testResult.diagnostics.split('\n').find((l) => l.trim())?.slice(0, 200) ?? ''}`
              : `${this.consecutiveIdleIterations} consecutive iterations changed no files.`,
            attempts: 1,
          });
          return;
        }
      }

      // Snapshot this iteration's dev state
      await snapshotIteration(buildId, iterationNumber);

      // Append workspace state and test results to evaluation for next iteration's context
      const currentFiles = await listWorkspaceFiles(buildId);
      if (result.evaluation) {
        const extras = [
          currentFiles ? `\n\nWorkspace state after this iteration:\n${currentFiles}` : '',
          testResult.testCount > 0
            ? `\n\nTest results: ${testResult.testCount - testResult.failCount}/${testResult.testCount} passed${
                testResult.failCount > 0
                  ? // The DIAGNOSTICS, not the head of the log. Handing over
                    // `output.slice(0, 1000)` meant the agent read a gate's
                    // passing preamble and concluded all was well — see
                    // extractDiagnostics for how that cost change request #216
                    // its whole run.
                    `\nThe gate FAILED. Fix these before doing anything else — a focused ` +
                    `test run does not typecheck, so passing vitest is not passing the gate:\n` +
                    `${testResult.diagnostics || testResult.output.slice(-1000)}`
                  : ''
              }`
            : '',
        ].join('');
        result.evaluation = result.evaluation + extras;
        await db
          .update(jkaiIterations)
          .set({ evaluation: result.evaluation })
          .where(eq(jkaiIterations.id, iteration.id));
      }

      // Preview/promote branch-point. Normal builds promote dev→live and
      // start a static preview server. Git-target builds have no static
      // preview (the dev/ tree is a cloned git repo on a branch) and must NOT
      // promote to live/ — they publish via a GitHub PR at completion instead.
      // Set by the studio gate below when every planned chapter is built and
      // passing; read by the completion branch further down.
      let studioComplete = false;
      if (!build.gitTargetConfig) {
        // Always surface a preview, even when tests failed — the user
        // explicitly wants link visibility from iteration #1, and seeing
        // a broken running prototype is more useful than seeing nothing.
        // Failure context still flows back to the agent via the iteration
        // evaluation log appended above.
        if (!testResult.passed) {
          await emitLog(buildId, 'system', 'Tests failed — promoting anyway so the live preview reflects the latest iteration. Failure context is included for the next iteration.', iteration.id);
        }
        await manageServeConfig(buildId);

        // Studio gate. Runs after promotion so it drives the same build the
        // user is looking at. Findings feed the next iteration via the
        // evaluation text; they never abort a build on their own — the
        // budget cap and the idle-iteration breaker above already terminate
        // a build that cannot converge, and a build-ending abort on
        // unfixable gate findings is exactly the design_lint_loop failure
        // mode (see lintDesignSystem's DESIGN_MOUNT_RE comment): a build was
        // once aborted after three iterations of a finding it could not fix
        // while its app was complete and serving 200.
        //
        // iterationNumber > 1: iteration 1 is the skeleton, where every
        // chapter is a reachable placeholder by design. Running the gate on
        // it would fail chapters the agent has been explicitly told not to
        // flesh out yet, feeding it findings it is forbidden to act on.
        if (build.origin === 'studio' && iterationNumber > 1) {
          // Re-read serveConfig rather than using the `build` snapshot taken at
          // the top of runIteration: manageServeConfig above may have just
          // reassigned this build's port on a collision and written the new one
          // to the row. The stale port would point the gate at another build's
          // server (or nothing), and every chapter would come back unreachable.
          const [servedBuild] = await db
            .select({ serveConfig: jkaiBuilds.serveConfig })
            .from(jkaiBuilds)
            .where(eq(jkaiBuilds.id, buildId));
          const port = (servedBuild?.serveConfig as { port?: number } | null)?.port;
          const { runStudioGate, describeGate, describeGateSkip } = await import('./studio-gate');
          const skip = describeGateSkip(build.chapterPlan.length, port);
          if (skip) {
            // The gate is this build's only guardrail, and skipping it used to
            // be completely silent — not even the "skipped" line the ran:false
            // contract produces. Both missing conditions leave every chapter
            // unchecked, so both are errors.
            await emitLog(buildId, 'error', `${skip} (iteration #${iterationNumber})`, iteration.id);
          } else {
            // What the build actually owes: everything it has finished, plus
            // the next one. Derived from the promoted tree rather than the
            // iteration counter, so an iteration that delivers two chapters
            // moves the deadline two, and one that delivers none moves it
            // none. The old `iterationNumber - 1` moved it every time
            // regardless, which made the score get worse for shipping.
            const built = await countBuiltChapters(buildId);
            const chaptersDue = Math.min(built + 1, build.chapterPlan.length);
            const outcome = await runStudioGate({
              baseUrl: `http://127.0.0.1:${port}`,
              chaptersDue,
              chapters: build.chapterPlan.map((c) => ({ ...c, path: `/chapter-${c.n}/` })),
              sourceUrls: (build.researchBrief?.facts ?? []).map((f) => f.sourceUrl),
              kitFiles: STUDIO_KIT_CHECK_FILES,
            });
            const summary = describeGate(outcome);
            await emitLog(
              buildId,
              outcome.ran && !outcome.passed ? 'error' : 'system',
              summary,
              iteration.id,
            );
            if (outcome.ran && !outcome.passed && result.evaluation) {
              result.evaluation = `${result.evaluation}\n\n## Studio gate\n${summary}`;
              await db
                .update(jkaiIterations)
                .set({ evaluation: result.evaluation })
                .where(eq(jkaiIterations.id, iteration.id));
            }

            // A green gate with nothing left pending IS done for a studio
            // build, and until now nothing said so. detectCompletion looks for
            // "100% complete" in the evaluation, but the studio prompt asks for
            // "chapters-done / chapters-planned", so "8/8 chapters complete"
            // never matched and a finished build could only end by hitting a
            // cap. Build f86342f9 finished all 8 chapters around iteration 12,
            // then spent 13, 14 and 15 reporting "8/8 complete, nothing to do",
            // tripped the idle breaker, and was recorded as FAILED with
            // no_progress — a working explainer filed as a failure, plus five
            // wasted iterations.
            //
            // `notYetDue` empty means every planned chapter exists and is out
            // of placeholder state; `passed` means each one cleared all four
            // contract checks. Together that is the whole definition of done.
            if (
              outcome.ran &&
              outcome.passed &&
              (outcome.notYetDue?.length ?? 0) === 0 &&
              build.chapterPlan.length > 0
            ) {
              studioComplete = true;
            }
          }
        }
      }

      // Log iteration summary
      const summary = [
        `━━━ Iteration #${iterationNumber} complete ━━━`,
        `Duration: ${(durationMs / 1000).toFixed(0)}s | Tokens: ${result.tokensUsed} | Actions: ${result.actions.length}`,
        testResult.testCount > 0 ? `Tests: ${testResult.testCount - testResult.failCount}/${testResult.testCount} passed` : 'No tests',
        result.evaluation ? `Evaluation: ${result.evaluation.slice(0, 200)}` : 'No evaluation produced (max turns reached)',
        result.nextSteps ? `Next: ${result.nextSteps.slice(0, 200)}` : '',
      ].filter(Boolean).join('\n');
      await emitLog(buildId, 'system', summary, iteration.id);

      // Completion/publish branch-point (git-target). The gate is the
      // authoritative completion signal: when it passes, the work is
      // mergeable → publish via a GitHub PR and mark the build completed
      // with the PR URL recorded (in publishedSlug). DO NOT auto-merge —
      // the human merges on GitHub. When the gate fails, keep iterating:
      // the gate output is already appended to the evaluation above and
      // flows into the next iteration (same as the design-lint loop). The
      // budget cap (max iterations / minutes) is enforced by checkBudget at
      // the top of runIteration, so a never-passing gate still terminates.
      if (build.gitTargetConfig) {
        if (testResult.passed) {
          await emitLog(buildId, 'system', 'Gate passed — publishing via GitHub PR (no auto-merge; human review required).', iteration.id);
          let prUrl: string | null = null;
          try {
            const summary = (build.title || result.goals || build.prompt || 'autonomous changes').slice(0, 120);
            const prBody = [
              `Autonomous change proposed by the Forge.`,
              ``,
              `**Prompt:** ${build.prompt.slice(0, 1000)}`,
              ``,
              `**Gate:** \`${build.gitTargetConfig.gateCommand}\`${
                build.gitTargetConfig.finalGateCommand ? ` and \`${build.gitTargetConfig.finalGateCommand}\`` : ''
              } passed.`,
              ``,
              result.evaluation ? `**Summary:**\n${result.evaluation.slice(0, 1500)}` : '',
            ].filter(Boolean).join('\n');
            const published = await publishViaGit(buildId, build.gitTargetConfig as GitTargetConfig, {
              // Build's own title column (`Forge: <prompt slice>`) — clean PR
              // title + commit subject, not the agent's verbose evaluation.
              title: build.title || 'Forge: automated change',
              summary,
              body: prBody,
            });
            prUrl = published?.prUrl ?? published?.branchRef ?? null;
          } catch (err: any) {
            // Publish failed (push/PR error). Don't silently complete — surface
            // it and keep the build available for retry via the normal failure
            // path. The branch may already be pushed; the human can inspect.
            await this.abortBuild(buildId, {
              kind: 'nonzero_exit',
              message: `Gate passed but git publish failed: ${err.message}`,
              attempts: 1,
            });
            return;
          }
          await db
            .update(jkaiBuilds)
            .set({ status: 'completed', publishedSlug: prUrl, updatedAt: new Date() })
            .where(eq(jkaiBuilds.id, buildId));
          await emitLog(buildId, 'system', prUrl ? `Build complete — PR: ${prUrl}` : 'Build complete — no changes to publish.', iteration.id);
          await emitStage(buildId, { stage: 'completed', message: prUrl ?? undefined } as any);
          try {
            await notifyAllSubscribers({
              title: 'Forge PR ready',
              body: prUrl ? prUrl : (build.title ?? 'Forge build finished'),
              url: `/jkai/builds/${buildId}`,
            });
          } catch (e) {
            console.warn('[jkai-pwa] push failed', e);
          }
          this.activeBuildId = null;
          await this.dequeueNext();
          return;
        }
        // Gate failed — keep iterating (subject to budget cap). Fall through
        // to the per-iteration approval gate / scheduleNext below.
      } else if (studioComplete) {
        // Studio's own completion signal — see where studioComplete is set.
        // Deliberately NOT routed through replanBuild: that re-plans with the
        // app-shaped prompt ("## Iteration Plan", "CLIENT-SIDE FIRST"), which
        // would hand every later iteration a plan that is no longer a chapter
        // plan. A studio build whose gate is green is finished, not due a
        // fresh plan.
        await db
          .update(jkaiBuilds)
          .set({ status: 'completed', updatedAt: new Date() })
          .where(eq(jkaiBuilds.id, buildId));
        const previewUrl = (build.serveConfig as { port?: number } | null)?.port
          ? `/api/jkai/proxy/${buildId}/`
          : null;
        await emitLog(
          buildId,
          'system',
          `Studio build complete — all ${build.chapterPlan.length} chapters built and passing the gate. Publish it from the builds page to give it a /projects/<slug>/ URL.`,
        );
        await emitStage(buildId, { stage: 'completed', previewUrl });
        try {
          await notifyAllSubscribers({
            title: 'Studio build complete',
            body: build.title ?? 'jkai studio build finished',
            url: `/jkai/builds/${buildId}`,
          });
        } catch (e) {
          console.warn('[jkai-pwa] push failed', e);
        }
        this.activeBuildId = null;
        await this.dequeueNext();
        return;
      } else if (detectCompletion(result.evaluation)) {
        await emitLog(buildId, 'system', 'Completion detected — entering re-planning phase.');
        const shouldContinue = await replanBuild(buildId);
        if (!shouldContinue) {
          await db
            .update(jkaiBuilds)
            .set({ status: 'completed', updatedAt: new Date() })
            .where(eq(jkaiBuilds.id, buildId));
          // Route through the SvelteKit proxy (/api/jkai/proxy/<id>/...) — the
          // sandbox container doesn't publish its agent-picked ports to the
          // host, so http://homeserv:<port> is unreachable. The proxy
          // resolves the container bridge IP and forwards.
          const previewUrl = (build.serveConfig as { port?: number } | null)?.port
            ? `/api/jkai/proxy/${buildId}/`
            : null;
          await emitStage(buildId, { stage: 'completed', previewUrl });
          try {
            await notifyAllSubscribers({
              title: 'Build complete',
              body: build.title ?? 'jkai build finished',
              url: `/jkai/builds/${buildId}`,
            });
          } catch (e) {
            console.warn('[jkai-pwa] push failed', e);
          }
          this.activeBuildId = null;
          await this.dequeueNext();
          return;
        }
      }

      // Per-iteration approval gate (Phase 2): when the build opted in, pause
      // here and wait for the user to approve or reject before scheduling the
      // next iteration.
      if ((build as any).requireIterationApproval) {
        await db
          .update(jkaiBuilds)
          .set({ status: 'awaiting_iter_approval', updatedAt: new Date() })
          .where(eq(jkaiBuilds.id, buildId));
        await emitLog(
          buildId,
          'system',
          `Iteration #${iterationNumber} complete — awaiting approval before iter #${iterationNumber + 1}.`,
          iteration.id,
        );
        await emitStage(buildId, { stage: 'awaiting_iter_approval', iteration: iterationNumber }, iteration.id);
        this.activeBuildId = null;
        await this.dequeueNext();
        return;
      }

      this.scheduleNext(buildId, 1000);
    } catch (err: any) {
      // `err.message` alone is what made the 85dac418 investigation take a
      // day: for a Drizzle failure it is the query plus every bound parameter
      // — 400KB per occurrence — and the actual reason lives on `err.cause`,
      // which never reached the log. describeDbError reads the cause and drops
      // the dump; for a non-database error it falls through to the message.
      await emitLog(buildId, 'error', `Iteration error: ${describeDbError(err)}`);
      console.error(`[orchestrator] iteration error for ${buildId}:`, err);
      this.scheduleNext(buildId, 30000);
    } finally {
      clearInterval(liveness);
    }
  }

  /**
   * Stamp `jkai_builds.heartbeat_at` every LIVENESS_PING_MS until cleared.
   * Fires once immediately so a short iteration still leaves a mark.
   */
  private startLivenessTicker(buildId: string): ReturnType<typeof setInterval> {
    const ping = () => {
      void db
        .update(jkaiBuilds)
        .set({ heartbeatAt: new Date() })
        .where(eq(jkaiBuilds.id, buildId))
        .catch((err) => console.error(`[orchestrator] liveness ping failed for ${buildId}:`, err));
    };
    ping();
    return setInterval(ping, LIVENESS_PING_MS);
  }

  /**
   * Push a failed git-target build's branch and open a draft PR for it.
   *
   * Silent no-op when there is nothing to rescue (not a git build, or the agent
   * never changed a file). Never throws into the abort path — a failure to
   * rescue must not stop the build being marked failed.
   */
  private async rescueFailedGitBuild(buildId: string, failure: FailureEnvelope): Promise<void> {
    const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, buildId));
    if (!build?.gitTargetConfig) return;

    const cfg = build.gitTargetConfig as GitTargetConfig;
    const dev = `/home/jkai/workspace/${buildId}/dev`;
    const dirty = await execInSandbox(`cd ${dev} && git status --porcelain 2>&1`, 60000);
    if (dirty.exitCode !== 0 || !dirty.stdout.trim()) return;

    await emitLog(
      buildId,
      'system',
      'Build failed with uncommitted work — pushing the branch and opening a draft PR so it is not lost.',
    );

    const body = [
      `This build **failed** (\`${failure.kind}\`) and this pull request is a rescue of the work it had already done. It is a DRAFT: the gate did not pass.`,
      '',
      `> ${(failure.message ?? '').slice(0, 500)}`,
      '',
      'Review the diff before doing anything with it. To continue the work, resume the build rather than starting a new one — the workspace and branch are still on the VPS.',
    ].join('\n');

    const res = await publishViaGit(buildId, { ...cfg, openPr: true }, {
      draft: true,
      title: `[rescued] ${build.title ?? `Build ${buildId.slice(0, 8)}`}`,
      body,
      summary: `rescued from failed build ${buildId.slice(0, 8)}`,
    });
    if (res?.prUrl) {
      await emitLog(buildId, 'system', `Draft PR opened with the rescued work → ${res.prUrl}`);
    }
  }

  /** Consecutive iterations that changed no files — see the idle breaker. */
  /**
   * The last gate verdict and the tree that produced it, so an iteration that
   * changed nothing can reuse it instead of re-running the gate. Holds the
   * FINAL verdict — after `finalGateCommand`, when that ran — because that is
   * what the caller acts on.
   */
  private lastGate: { buildId: string; fingerprint: string; out: string; passed: boolean } | null = null;

  /**
   * Hash of the working tree against HEAD, or null when it cannot be computed.
   *
   * `add -A -N` records untracked files as intent-to-add so `git diff HEAD`
   * includes them — without it, a whole new file would leave the fingerprint
   * unmoved and its gate run would be skipped. Node modules and `.env` are
   * gitignored and so excluded, which is what we want: they do not change
   * within a build.
   *
   * Returning null on anything unexpected is deliberate. The caller runs the
   * gate when there is no fingerprint, so the failure mode of this function is
   * "no saving", never "wrong verdict".
   */
  private async workspaceFingerprint(dev: string): Promise<string | null> {
    try {
      const res = await execInSandbox(
        `cd ${dev} && git add -A -N >/dev/null 2>&1; git diff HEAD 2>/dev/null | sha1sum | cut -d' ' -f1`,
        30_000,
      );
      const hash = res.stdout.trim();
      return /^[0-9a-f]{40}$/.test(hash) ? hash : null;
    } catch {
      return null;
    }
  }

  /**
   * The per-iteration gate, then the expensive one only if it passed.
   *
   * Keeping both behind one call is what lets the result be cached as a single
   * verdict: the caller cannot then reuse a "passed" that never included the
   * build. See `finalGateCommand` in git-targets.ts for the split.
   */
  private async runGateChain(
    runGate: (cmd: string) => Promise<{ out: string; passed: boolean }>,
    cfg: { gateCommand: string; finalGateCommand?: string },
  ): Promise<{ out: string; passed: boolean }> {
    const gate = await runGate(cfg.gateCommand);
    if (gate.passed && cfg.finalGateCommand) return runGate(cfg.finalGateCommand);
    return gate;
  }

  /** Which build `consecutiveIdleIterations` / `consecutiveTransient` describe. */
  private countersBuildId: string | null = null;
  private consecutiveIdleIterations = 0;
  /** Consecutive transient provider failures; see ./transient-failure. */
  private consecutiveTransient = 0;

  private async abortBuild(buildId: string, failure: FailureEnvelope): Promise<void> {
    await db
      .update(jkaiBuilds)
      .set({
        status: 'failed',
        failure: failure as unknown as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(eq(jkaiBuilds.id, buildId));

    await emitLog(
      buildId,
      'error',
      `Build aborted: ${failure.kind} — ${failure.message}`,
    );
    await emitStage(buildId, { stage: 'failed', failureKind: failure.kind, message: failure.message });

    // Rescue the work. A git-target build that dies still has a branch full of
    // real edits sitting in its workspace, and until now that was simply lost —
    // three builds' worth had to be recovered by hand on 2026-08-08. Push it and
    // open a DRAFT pull request instead, so a failed build produces something
    // reviewable rather than nothing. Draft, because the gate has not passed:
    // it is a rescue, not a delivery.
    await this.rescueFailedGitBuild(buildId, failure).catch((err) => {
      console.warn('[jkai] rescue PR failed', err);
    });

    try {
      await notifyAllSubscribers({
        title: 'Build failed',
        body: (failure.message ?? '').slice(0, 140) || 'jkai build failed',
        url: `/jkai/builds/${buildId}`,
      });
    } catch (e) {
      console.warn('[jkai-pwa] push failed', e);
    }

    this.activeBuildId = null;
    if (this.loopTimer) clearTimeout(this.loopTimer);
    this.loopTimer = null;
    await this.dequeueNext();
  }
}

export const orchestrator = new Orchestrator();
