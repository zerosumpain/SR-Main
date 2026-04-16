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
  promoteDevToLive,
  seedDevFromLive,
  snapshotIteration,
} from './sandbox';
import { validateServeConfig } from './serve';
import { failOrphanedIterations } from './orchestrator-helpers';
import { executeIteration } from './executor';
import { runTests } from './test-runner';
import { emitLog, onBuildLog } from './log-emitter';
import { planBuild, replanBuild } from './planner';

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

    // Run setup and planning asynchronously so the API returns immediately
    this.initAndPlan(buildId).catch(async (err) => {
      await emitLog(buildId, 'error', `Build init failed: ${err.message}`);
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
  }

  async continueBuild(buildId: string, improvementPrompt: string): Promise<void> {
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

    await db
      .update(jkaiBuilds)
      .set({ status: 'running', prompt: combinedPrompt, updatedAt: new Date() })
      .where(eq(jkaiBuilds.id, buildId));

    await emitLog(buildId, 'system', `Build continuing with new objectives: ${improvementPrompt.slice(0, 200)}`);

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
    const [runningBuild] = await db
      .select()
      .from(jkaiBuilds)
      .where(eq(jkaiBuilds.status, 'running'))
      .limit(1);

    if (!runningBuild) return;

    await failOrphanedIterations(runningBuild.id);

    await emitLog(runningBuild.id, 'system', 'Recovered after restart — resuming build');
    this.activeBuildId = runningBuild.id;
    this.stopped = false;
    this.scheduleNext(runningBuild.id);
  }

  private async initAndPlan(buildId: string): Promise<void> {
    await ensureSandboxRunning();
    await ensureWorkspace(buildId);

    const [buildRecord] = await db.select().from(jkaiBuilds).where(eq(jkaiBuilds.id, buildId));
    if (buildRecord && !this.stopped) {
      await planBuild(buildId, buildRecord.prompt);
    }

    if (!this.stopped) {
      this.scheduleNext(buildId);
    }
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

      const [iteration] = await db
        .insert(jkaiIterations)
        .values({
          buildId,
          number: iterationNumber,
          status: 'running',
        })
        .returning();

      await emitLog(buildId, 'system', `━━━ Iteration #${iterationNumber} started ━━━`, iteration.id);

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

      const result = await executeIteration(build, iteration, prevIteration, projectPlan, iterationNumber, () => this.stopped);

      const durationMs = Date.now() - startTime;

      // Always update the iteration record, even if no evaluation was produced
      await db
        .update(jkaiIterations)
        .set({
          status: 'completed',
          goals: result.goals,
          plan: result.plan,
          actions: result.actions,
          messages: result.messages,
          evaluation: result.evaluation,
          nextSteps: result.nextSteps,
          tokensUsed: result.tokensUsed,
          durationMs,
        })
        .where(eq(jkaiIterations.id, iteration.id));

      // Update build counters
      await db
        .update(jkaiBuilds)
        .set({
          iterationsCompleted: build.iterationsCompleted + 1,
          tokensUsed: build.tokensUsed + result.tokensUsed,
          activeMinutesUsed: build.activeMinutesUsed + durationMs / 60000,
          updatedAt: new Date(),
        })
        .where(eq(jkaiBuilds.id, buildId));

      // Run test suite
      await emitLog(buildId, 'system', 'Running tests...', iteration.id);
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
          this.activeBuildId = null;
          return;
        }
      }

      this.scheduleNext(buildId, 1000);
    } catch (err: any) {
      await emitLog(buildId, 'error', `Iteration error: ${err.message}`);
      this.scheduleNext(buildId, 30000);
    }
  }

  private async checkServeConfig(buildId: string): Promise<void> {
    const raw = await readServeJson(buildId);
    if (!raw) return;

    const config = validateServeConfig(raw);
    if (!config) {
      await emitLog(buildId, 'system', 'Found serve.json but it failed validation');
      return;
    }

    const [build] = await db
      .select()
      .from(jkaiBuilds)
      .where(eq(jkaiBuilds.id, buildId));

    const currentConfig = build?.serveConfig as any;
    const configChanged = currentConfig?.port !== config.port || currentConfig?.startCommand !== config.startCommand;

    // Always promote dev to live after a successful iteration
    await emitLog(buildId, 'system', 'Promoting dev → live');
    await promoteDevToLive(buildId);

    if (configChanged) {
      await emitLog(buildId, 'system', `Starting project server on port ${config.port}: ${config.startCommand}`);

      const healthy = await startProjectServer(
        buildId,
        config.startCommand,
        config.port,
        config.healthCheck,
      );

      if (healthy) {
        await db
          .update(jkaiBuilds)
          .set({ serveConfig: config, updatedAt: new Date() })
          .where(eq(jkaiBuilds.id, buildId));
        await emitLog(buildId, 'system', `Project server healthy at port ${config.port}`);
      } else {
        await emitLog(buildId, 'error', `Project server failed health check on port ${config.port}`);
      }
    } else if (currentConfig) {
      // Config unchanged but still promote and restart to pick up code changes
      await killProjectServer();
      const healthy = await startProjectServer(
        buildId,
        config.startCommand,
        config.port,
        config.healthCheck,
      );
      if (healthy) {
        await emitLog(buildId, 'system', `Project server restarted from live`);
      }
    }
  }

}

export const orchestrator = new Orchestrator();
