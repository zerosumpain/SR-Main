import { db } from '$lib/db';
import { jkaiBuilds, jkaiIterations } from '$lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { checkBudget } from './budget';
import {
  ensureSandboxRunning,
  ensureWorkspace,
  listWorkspaceFiles,
  readServeJson,
  startProjectServer,
  killProjectServer,
  readProjectServerLogTail,
  promoteDevToLive,
  seedDevFromLive,
  snapshotIteration,
  allocatePort,
  writeFileInSandbox,
} from './sandbox';
import { validateServeConfig, autodetectServeConfig } from './serve';
import { failOrphanedIterations } from './orchestrator-helpers';
import { executeIteration } from './executor';
import { runTests } from './test-runner';
import { emitLog, onBuildLog } from './log-emitter';
import { planBuild, replanBuild } from './planner';
import type { FailureEnvelope } from './types';
import { emitStage } from './stage-events';

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

class Orchestrator {
  private activeBuildId: string | null = null;
  private loopTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  // Mutable deadline for the currently-executing iteration's Pi process.
  // The UI can push this back via extendDeadline() to grant more time.
  private currentDeadline: { current: number } | null = null;

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
    if (this.activeBuildId) {
      throw new Error(`Build ${this.activeBuildId} is already active`);
    }

    this.activeBuildId = buildId;
    this.stopped = false;

    await db
      .update(jkaiBuilds)
      .set({ status: 'running', updatedAt: new Date() })
      .where(eq(jkaiBuilds.id, buildId));

    await emitLog(buildId, 'system', 'Build started');
    await emitStage(buildId, { stage: 'planning' });

    // Run setup and planning asynchronously so the API returns immediately
    this.initAndPlan(buildId).catch(async (err) => {
      await emitLog(buildId, 'error', `Build init failed: ${err.message}`);
      await emitStage(buildId, { stage: 'failed', failureKind: 'init_error', message: err.message });
    });
  }

  async pauseBuild(buildId: string): Promise<void> {
    this.stopped = true;
    if (this.loopTimer) clearTimeout(this.loopTimer);
    this.loopTimer = null;
    this.activeBuildId = null;

    // Mark any running iterations as failed (they were interrupted)
    await failOrphanedIterations(buildId);

    await db
      .update(jkaiBuilds)
      .set({ status: 'paused', updatedAt: new Date() })
      .where(eq(jkaiBuilds.id, buildId));

    await emitLog(buildId, 'system', 'Build paused');
    await emitStage(buildId, { stage: 'paused' });
  }

  /**
   * Pure restart from the last good iteration. Use after a service restart
   * killed the in-flight pi process and `recoverOnStartup` marked the build
   * `failed` — no new instructions, no re-planning, just clear the failure
   * flag and schedule the next iteration. The dev/ workspace still has
   * whatever pi wrote before it was killed.
   */
  async restartBuild(buildId: string): Promise<void> {
    if (this.activeBuildId && this.activeBuildId !== buildId) {
      throw new Error(`another build is active: ${this.activeBuildId}`);
    }
    await failOrphanedIterations(buildId);
    await db
      .update(jkaiBuilds)
      .set({
        status: 'running',
        failure: null,
        consecutiveFailures: 0,
        updatedAt: new Date(),
      })
      .where(eq(jkaiBuilds.id, buildId));
    await emitLog(buildId, 'system', 'Build restarted — picking up from last good iteration.');
    this.activeBuildId = buildId;
    this.stopped = false;
    this.scheduleNext(buildId);
  }

  async resumeBuild(buildId: string): Promise<void> {
    if (this.activeBuildId) {
      throw new Error(`Build ${this.activeBuildId} is already active`);
    }

    // Clean up any orphaned running iterations before resuming
    await failOrphanedIterations(buildId);

    this.activeBuildId = buildId;
    this.stopped = false;

    await db
      .update(jkaiBuilds)
      .set({ status: 'running', updatedAt: new Date() })
      .where(eq(jkaiBuilds.id, buildId));

    await emitLog(buildId, 'system', 'Build resumed');
    await emitStage(buildId, { stage: 'iterating' });
    this.scheduleNext(buildId);
  }

  async stopBuild(buildId: string): Promise<void> {
    this.stopped = true;
    if (this.loopTimer) clearTimeout(this.loopTimer);
    this.loopTimer = null;
    this.activeBuildId = null;

    // Mark any running iterations as failed
    await failOrphanedIterations(buildId);

    await db
      .update(jkaiBuilds)
      .set({ status: 'completed', updatedAt: new Date() })
      .where(eq(jkaiBuilds.id, buildId));

    await emitLog(buildId, 'system', 'Build stopped by user');
    await emitStage(buildId, { stage: 'completed', message: 'Stopped by user' });
  }

  async continueBuild(
    buildId: string,
    improvementPrompt: string,
    modelOverride?: { provider?: string; modelId?: string },
  ): Promise<void> {
    if (this.activeBuildId) {
      throw new Error(`Build ${this.activeBuildId} is already active`);
    }

    const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, buildId));
    if (!build) throw new Error('Build not found');

    // Clean up any orphaned running iterations
    await failOrphanedIterations(buildId);

    this.activeBuildId = buildId;
    this.stopped = false;

    // Append the improvement prompt to the original build prompt
    const combinedPrompt = `${build.prompt}\n\n--- Continuation ---\nThe project above has been built. The user now wants the following improvements:\n${improvementPrompt}`;

    const updates: Record<string, unknown> = {
      status: 'running',
      prompt: combinedPrompt,
      updatedAt: new Date(),
      failure: null,
      consecutiveFailures: 0,
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
  }

  private async initAndPlan(buildId: string): Promise<void> {
    await ensureSandboxRunning();
    await ensureWorkspace(buildId);

    const [buildRecord] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, buildId));
    if (buildRecord && !this.stopped) {
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
    if (this.activeBuildId && this.activeBuildId !== buildId) {
      throw new Error(`another build is active: ${this.activeBuildId}`);
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
    if (this.activeBuildId && this.activeBuildId !== buildId) {
      throw new Error(`another build is active: ${this.activeBuildId}`);
    }
    await failOrphanedIterations(buildId);
    await db
      .update(jkaiBuilds)
      .set({
        status: 'running',
        planStatus: 'skipped',
        failure: null,
        consecutiveFailures: 0,
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
    if (this.activeBuildId && this.activeBuildId !== buildId) {
      throw new Error(`another build is active: ${this.activeBuildId}`);
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
    await db
      .update(jkaiBuilds)
      .set({
        status: 'running',
        planStatus: 'pending',
        failure: null,
        consecutiveFailures: 0,
        iterationsCompleted: 0,
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
    if (this.activeBuildId && this.activeBuildId !== buildId) {
      throw new Error(`another build is active: ${this.activeBuildId}`);
    }
    const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, buildId));
    if (!build) throw new Error('build not found');
    if (build.status !== 'awaiting_iter_approval') return;
    await db
      .update(jkaiBuilds)
      .set({ status: 'running', updatedAt: new Date() })
      .where(eq(jkaiBuilds.id, buildId));
    await emitLog(buildId, 'system', 'Iteration approved — continuing.');
    this.activeBuildId = buildId;
    this.stopped = false;
    this.scheduleNext(buildId);
  }

  async rejectIteration(buildId: string, notes: string): Promise<void> {
    if (this.activeBuildId && this.activeBuildId !== buildId) {
      throw new Error(`another build is active: ${this.activeBuildId}`);
    }
    const [build] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, buildId));
    if (!build) throw new Error('build not found');
    if (build.status !== 'awaiting_iter_approval') return;
    const trimmed = (notes ?? '').trim();
    const combinedPrompt = trimmed
      ? `${build.prompt}\n\n--- Iteration rejected ---\n${trimmed}`
      : build.prompt;
    await db
      .update(jkaiBuilds)
      .set({ status: 'running', prompt: combinedPrompt, updatedAt: new Date() })
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

    try {
      // Re-fetch build to get latest counters
      const [build] = await db
        .select()
        .from(jkaiBuilds)
        .where(eq(jkaiBuilds.id, buildId));

      if (!build || build.status !== 'running') return;

      const budget = await checkBudget(build);
      if (!budget.canProceed) {
        if (budget.shouldComplete) {
          await db
            .update(jkaiBuilds)
            .set({ status: 'completed', updatedAt: new Date() })
            .where(eq(jkaiBuilds.id, buildId));
          await emitLog(buildId, 'system', `Build completed: ${budget.reason}`);
          this.activeBuildId = null;
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

      // Build counters: failed iterations don't consume active-minutes budget
      // (per design: only successful work counts). Token spend still counts.
      // wall_clock_timeout doesn't bump consecutive_failures because Pi did
      // useful work and just ran out of time — the next iteration will pick
      // up the partial work in dev/ (live/ is empty so seedDevFromLive is a
      // no-op, preserving whatever files iter N wrote).
      const counts = failure && failure.kind !== 'wall_clock_timeout';
      const newConsecutiveFailures = counts ? build.consecutiveFailures + 1 : failure ? build.consecutiveFailures : 0;
      await db
        .update(jkaiBuilds)
        .set({
          iterationsCompleted: build.iterationsCompleted + 1,
          tokensUsed: build.tokensUsed + result.tokensUsed,
          activeMinutesUsed: failure
            ? build.activeMinutesUsed
            : build.activeMinutesUsed + durationMs / 60000,
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
          failure.kind === 'wall_clock_timeout';
        const shouldAbort = !canContinue || newConsecutiveFailures >= 2;

        if (shouldAbort) {
          await this.abortBuild(buildId, failure);
          return;
        }

        const continueMsg = failure.kind === 'wall_clock_timeout'
          ? `Iteration #${iterationNumber} hit the wall-clock cap while still working — partial work preserved in dev/. Continuing with iteration #${iterationNumber + 1}.`
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

      // Run design-system linter (when enabled). If it finds issues, mark the
      // iteration failed so promotion is skipped and the next iteration's user
      // prompt receives the findings as required fixes.
      if ((build as any).enforceDesignSystem) {
        try {
          const { listDevFiles, readDevFile } = await import('./sandbox');
          const { lintDesignSystem } = await import('./design-lint');
          const targetExts = ['.css', '.svelte', '.html', '.tsx', '.jsx', '.vue'];
          const all = await listDevFiles(buildId);
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

            this.scheduleNext(buildId, 1000);
            return;
          }
        } catch (err: any) {
          await emitLog(
            buildId,
            'system',
            `Design lint skipped due to error: ${err.message}`,
            iteration.id,
          );
        }
      }

      // Run test suite
      await emitLog(buildId, 'system', 'Running tests...', iteration.id);
      await emitStage(buildId, { stage: 'running_tests', iteration: iterationNumber }, iteration.id);
      const testResult = await runTests(buildId, `/home/jkai/workspace/${buildId}/dev`);
      const testEmoji = testResult.passed ? 'PASS' : 'FAIL';
      const testSummary = `${testEmoji} Tests: ${testResult.testCount - testResult.failCount}/${testResult.testCount} passed${testResult.failCount > 0 ? ` (${testResult.failCount} failed)` : ''}`;
      await emitLog(buildId, testResult.passed ? 'system' : 'error', `${testSummary}\n${testResult.output.slice(0, 2000)}`, iteration.id);

      // Snapshot this iteration's dev state
      await snapshotIteration(buildId, iterationNumber);

      // Append workspace state and test results to evaluation for next iteration's context
      const currentFiles = await listWorkspaceFiles(buildId);
      if (result.evaluation) {
        const extras = [
          currentFiles ? `\n\nWorkspace state after this iteration:\n${currentFiles}` : '',
          testResult.testCount > 0
            ? `\n\nTest results: ${testResult.testCount - testResult.failCount}/${testResult.testCount} passed${testResult.failCount > 0 ? `\nFailing tests:\n${testResult.output.slice(0, 1000)}` : ''}`
            : '',
        ].join('');
        result.evaluation = result.evaluation + extras;
        await db
          .update(jkaiIterations)
          .set({ evaluation: result.evaluation })
          .where(eq(jkaiIterations.id, iteration.id));
      }

      // Only promote to live if tests pass (or no tests exist)
      if (testResult.passed) {
        await this.checkServeConfig(buildId);
      } else {
        await emitLog(buildId, 'system', 'Skipping promotion to live — tests failed. Next iteration will receive failure context.', iteration.id);
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

      // Check if the iteration signals project completion
      if (detectCompletion(result.evaluation)) {
        await emitLog(buildId, 'system', 'Completion detected — entering re-planning phase.');
        const shouldContinue = await replanBuild(buildId);
        if (!shouldContinue) {
          await db
            .update(jkaiBuilds)
            .set({ status: 'completed', updatedAt: new Date() })
            .where(eq(jkaiBuilds.id, buildId));
          const previewUrl = (build.serveConfig as { port?: number } | null)?.port
            ? `http://homeserv:${(build.serveConfig as { port: number }).port}`
            : null;
          await emitStage(buildId, { stage: 'completed', previewUrl });
          this.activeBuildId = null;
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
        return;
      }

      this.scheduleNext(buildId, 1000);
    } catch (err: any) {
      await emitLog(buildId, 'error', `Iteration error: ${err.message}`);
      this.scheduleNext(buildId, 30000);
    }
  }

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

    this.activeBuildId = null;
    if (this.loopTimer) clearTimeout(this.loopTimer);
    this.loopTimer = null;
  }

  private async checkServeConfig(buildId: string): Promise<void> {
    // Resolve a serve config from one of three sources, in order of trust:
    //   1. dev/serve.json — agent-declared (highest authority)
    //   2. dev/serve.json that fails validation — log loud + bail
    //   3. autodetect from package.json scripts.dev/start — gives us a
    //      preview link on iteration #1 even before the agent has formally
    //      declared one. Marked with `[autodetected]` in description so the
    //      agent knows to override it.
    let config: ReturnType<typeof validateServeConfig> = null;
    let source: 'serve.json' | 'autodetect' | 'none' = 'none';
    const raw = await readServeJson(buildId);
    if (raw) {
      config = validateServeConfig(raw);
      if (!config) {
        await emitLog(buildId, 'error',
          'Found dev/serve.json but it failed validation. Required fields: ' +
          'port (1024-65535 number), startCommand (non-empty string), healthCheck (path starting with /).',
        );
        await emitStage(buildId, { stage: 'iterating', previewUrl: null });
        return;
      }
      source = 'serve.json';
    } else {
      config = await autodetectServeConfig(buildId);
      if (config) {
        source = 'autodetect';
        await emitLog(buildId, 'system',
          `Preview: no dev/serve.json yet — autodetected from package.json. ` +
          `Trying \`${config.startCommand}\` on port ${config.port}. ` +
          `Write dev/serve.json to override.`,
        );
      }
    }

    if (!config) {
      await emitLog(buildId, 'system',
        'Preview: not started — no dev/serve.json and no recognised package.json scripts. ' +
        'Write dev/serve.json with { port, startCommand, healthCheck } to enable the live preview.',
      );
      await emitStage(buildId, { stage: 'iterating', previewUrl: null });
      return;
    }

    const [build] = await db
      .select()
      .from(jkaiBuilds)
      .where(eq(jkaiBuilds.id, buildId));

    // Enforce per-build port allocation. If the agent picked a port that
    // collides with another build's stored serveConfig, reassign it.
    const currentConfig = build?.serveConfig as any;
    const keepExisting = currentConfig?.port === config.port;
    if (!keepExisting) {
      const allBuilds = await db.select().from(jkaiBuilds);
      const takenPorts = new Set(
        allBuilds
          .filter((b) => b.id !== buildId && b.serveConfig)
          .map((b) => (b.serveConfig as any)?.port)
          .filter(Boolean),
      );
      if (takenPorts.has(config.port)) {
        const assigned = await allocatePort(buildId);
        await emitLog(
          buildId,
          'system',
          `Port ${config.port} already assigned to another build — reassigning to ${assigned}`,
        );
        const rewritten = config.startCommand.replace(new RegExp(`\\b${config.port}\\b`, 'g'), String(assigned));
        config.port = assigned;
        config.startCommand = rewritten;
        // Only persist the rewrite when the agent had declared serve.json
        // — for autodetected configs we don't want to plant a file the
        // agent didn't ask for; the orchestrator will re-derive next turn.
        if (source === 'serve.json') {
          const payload = JSON.stringify(config, null, 2);
          await writeFileInSandbox(`/home/jkai/workspace/${buildId}/dev/serve.json`, payload);
          await writeFileInSandbox(`/home/jkai/workspace/${buildId}/live/serve.json`, payload).catch(() => {});
        }
      }
    }
    const configChanged = currentConfig?.port !== config.port || currentConfig?.startCommand !== config.startCommand;

    await emitLog(buildId, 'system', 'Promoting dev → live');
    await emitStage(buildId, { stage: 'promoting' });
    await promoteDevToLive(buildId);

    const previewUrl = `http://homeserv:${config.port}`;
    const action = configChanged ? 'Starting' : 'Restarting';
    if (configChanged) {
      await emitLog(buildId, 'system', `Starting project server on port ${config.port}: ${config.startCommand}`);
    } else if (currentConfig) {
      await killProjectServer(buildId);
    } else {
      // Should not happen — config matches stored but no stored row. Restart anyway.
      await killProjectServer(buildId);
    }

    const healthy = await startProjectServer(
      buildId,
      config.startCommand,
      config.port,
      config.healthCheck,
    );

    if (healthy) {
      // Persist serveConfig so subsequent iterations skip the costly cold-start.
      // For autodetected runs we still persist so the next iteration's
      // configChanged branch works (won't re-autodetect every turn).
      await db
        .update(jkaiBuilds)
        .set({ serveConfig: config, updatedAt: new Date() })
        .where(eq(jkaiBuilds.id, buildId));
      await emitLog(buildId, 'system',
        `Preview: live at ${previewUrl}${source === 'autodetect' ? ' (autodetected — override by writing dev/serve.json)' : ''}`,
      );
      await emitStage(buildId, { stage: 'iterating', previewUrl });
    } else {
      const tail = (await readProjectServerLogTail(buildId, 30)).trim();
      const tailMessage = tail
        ? `Preview: ${action.toLowerCase()} failed health check on port ${config.port}. Last server log lines:\n${tail}`
        : `Preview: ${action.toLowerCase()} failed health check on port ${config.port} and no server log was produced. ` +
          `The start command may not have launched at all — check that '${config.startCommand}' runs in the workspace dir.`;
      await emitLog(buildId, 'error', tailMessage);
      await emitStage(buildId, { stage: 'iterating', previewUrl: null });
    }
  }

}

export const orchestrator = new Orchestrator();
