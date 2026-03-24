import { db } from '$lib/db';
import { jkaiBuilds, jkaiIterations, jkaiLogs } from '$lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { checkBudget } from './budget';
import { buildSystemPrompt, buildIterationContext } from './prompt';
import {
  ensureSandboxRunning,
  ensureWorkspace,
  execInSandbox,
  execInSandboxChecked,
  listWorkspaceFiles,
  readServeJson,
  startProjectServer,
  killProjectServer,
  promoteDevToLive,
  seedDevFromLive,
  snapshotIteration,
} from './sandbox';
import { validateServeConfig } from './serve';
import type { ActionRecord } from './types';
import type { JkaiBuild, JkaiIteration } from '$lib/db/schema';
import { EventEmitter } from 'events';
import OpenAI from 'openai';
import { loadKeys } from '$lib/deepdive/keys';

// --- Event Emitter for SSE ---

const emitter = new EventEmitter();
emitter.setMaxListeners(50);

export function onBuildLog(
  buildId: string,
  handler: (log: { id: number; type: string; content: string; iterationId: string | null }) => void,
): () => void {
  const key = `log:${buildId}`;
  emitter.on(key, handler);
  return () => emitter.off(key, handler);
}

// Strip null bytes and other control chars that break Postgres text columns
function sanitize(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

async function emitLog(
  buildId: string,
  type: string,
  content: string,
  iterationId: string | null = null,
): Promise<void> {
  const safeContent = sanitize(content);
  const [log] = await db
    .insert(jkaiLogs)
    .values({ buildId, iterationId, type, content: safeContent })
    .returning();
  emitter.emit(`log:${buildId}`, {
    id: log.id,
    type: log.type,
    content: log.content,
    iterationId: log.iterationId,
  });
}

// --- LLM Client ---

function getLLMClient(): { client: OpenAI; model: string } {
  const keys = loadKeys();
  if (!keys.zaiApiKey) throw new Error('Z.AI API key not configured');
  const client = new OpenAI({
    apiKey: keys.zaiApiKey,
    baseURL: keys.zaiBaseUrl || 'https://api.z.ai/api/coding/paas/v4/',
  });
  const model = keys.zaiModel || 'glm-4-plus';
  return { client, model };
}

// --- Code Block Extraction ---

const FENCE_REGEX = /```(bash|python|sh|javascript|typescript|node)\n([\s\S]*?)```/;

function extractCodeBlock(text: string): { lang: string; code: string } | null {
  const match = text.match(FENCE_REGEX);
  if (!match) return null;
  return { lang: match[1], code: match[2].trimEnd() };
}

function hasEvaluation(text: string): boolean {
  return text.includes('## Evaluation');
}

function extractSection(text: string, header: string): string | null {
  const regex = new RegExp(`## ${header}\\n([\\s\\S]*?)(?=\\n## |$)`);
  const match = text.match(regex);
  return match ? match[1].trim() : null;
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

    await ensureSandboxRunning();
    await ensureWorkspace(buildId);

    this.scheduleNext(buildId);
  }

  async pauseBuild(buildId: string): Promise<void> {
    this.stopped = true;
    if (this.loopTimer) clearTimeout(this.loopTimer);
    this.loopTimer = null;
    this.activeBuildId = null;

    // Mark any running iterations as failed (they were interrupted)
    await db
      .update(jkaiIterations)
      .set({ status: 'failed' })
      .where(
        and(
          eq(jkaiIterations.buildId, buildId),
          eq(jkaiIterations.status, 'running'),
        ),
      );

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
    await db
      .update(jkaiIterations)
      .set({ status: 'failed' })
      .where(
        and(
          eq(jkaiIterations.buildId, buildId),
          eq(jkaiIterations.status, 'running'),
        ),
      );

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
    await db
      .update(jkaiIterations)
      .set({ status: 'failed' })
      .where(
        and(
          eq(jkaiIterations.buildId, buildId),
          eq(jkaiIterations.status, 'running'),
        ),
      );

    await db
      .update(jkaiBuilds)
      .set({ status: 'completed', updatedAt: new Date() })
      .where(eq(jkaiBuilds.id, buildId));

    await emitLog(buildId, 'system', 'Build stopped by user');
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

    await db
      .update(jkaiIterations)
      .set({ status: 'failed' })
      .where(
        and(
          eq(jkaiIterations.buildId, runningBuild.id),
          eq(jkaiIterations.status, 'running'),
        ),
      );

    await emitLog(runningBuild.id, 'system', 'Recovered after restart — resuming build');
    this.activeBuildId = runningBuild.id;
    this.stopped = false;
    this.scheduleNext(runningBuild.id);
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

      // Seed dev from live so the LLM starts with the latest working version
      await seedDevFromLive(buildId);

      const startTime = Date.now();

      const result = await this.executeIteration(build, iteration, prevIteration);

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

      // Snapshot this iteration's dev state
      await snapshotIteration(buildId, iterationNumber);

      // Append workspace state to evaluation for next iteration's context
      const currentFiles = await listWorkspaceFiles(buildId);
      if (currentFiles && result.evaluation) {
        const progressNote = `\n\nWorkspace state after this iteration:\n${currentFiles}`;
        result.evaluation = result.evaluation + progressNote;
        // Update the iteration record with enriched evaluation
        await db
          .update(jkaiIterations)
          .set({ evaluation: result.evaluation })
          .where(eq(jkaiIterations.id, iteration.id));
      }

      // Check for serve.json
      await this.checkServeConfig(buildId);

      // Log iteration summary
      const summary = [
        `━━━ Iteration #${iterationNumber} complete ━━━`,
        `Duration: ${(durationMs / 1000).toFixed(0)}s | Tokens: ${result.tokensUsed} | Actions: ${result.actions.length}`,
        result.evaluation ? `Evaluation: ${result.evaluation.slice(0, 200)}` : 'No evaluation produced (max turns reached)',
        result.nextSteps ? `Next: ${result.nextSteps.slice(0, 200)}` : '',
      ].filter(Boolean).join('\n');
      await emitLog(buildId, 'system', summary, iteration.id);

      this.scheduleNext(buildId, 1000);
    } catch (err: any) {
      await emitLog(buildId, 'error', `Iteration error: ${err.message}`);
      this.scheduleNext(buildId, 30000);
    }
  }

  private async executeIteration(
    build: JkaiBuild,
    iteration: JkaiIteration,
    prevIteration: JkaiIteration | null,
  ): Promise<{
    goals: string | null;
    plan: string | null;
    actions: ActionRecord[];
    messages: Array<{ role: string; content: string }>;
    evaluation: string | null;
    nextSteps: string | null;
    tokensUsed: number;
  }> {
    const { client, model } = getLLMClient();
    const systemPrompt = buildSystemPrompt(build.id);
    const fileList = await listWorkspaceFiles(build.id);
    const contextMessages = buildIterationContext(build.prompt, prevIteration, fileList);

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
      ...contextMessages,
    ];

    const actions: ActionRecord[] = [];
    let goals: string | null = null;
    let plan: string | null = null;
    let evaluation: string | null = null;
    let nextSteps: string | null = null;
    let totalTokens = 0;
    const maxTurns = 20;
    const maxTokensPerIteration = 100000; // Hard cap per iteration

    for (let turn = 0; turn < maxTurns; turn++) {
      if (this.stopped) break;

      // Progressive nudging toward evaluation
      if (turn >= 12 && !evaluation) {
        const turnsLeft = maxTurns - turn - 1;
        if (turnsLeft <= 0) {
          messages.push({
            role: 'user',
            content: 'This is your FINAL step. Write your ## Evaluation and ## Next Steps NOW. No code blocks.',
          });
        } else if (turnsLeft <= 3) {
          // Don't add extra message, but the continue prompt below will include the nudge
        }
      }

      const response = await client.chat.completions.create({
        model,
        messages,
        temperature: 0.7,
        max_tokens: 4096,
      });

      const assistantContent = response.choices[0]?.message?.content || '';
      totalTokens += response.usage?.total_tokens || 0;

      // Check per-iteration token cap
      if (totalTokens >= maxTokensPerIteration && !hasEvaluation(assistantContent)) {
        await emitLog(build.id, 'system', `Token cap reached (${totalTokens} tokens). Forcing evaluation.`, iteration.id);
        messages.push({
          role: 'user',
          content: 'You have exceeded the token budget for this iteration. Write your ## Evaluation and ## Next Steps NOW. No more code blocks.',
        });
        // Do one more turn to get the evaluation
        const evalResponse = await client.chat.completions.create({
          model,
          messages,
          temperature: 0.7,
          max_tokens: 2048,
        });
        const evalContent = evalResponse.choices[0]?.message?.content || '';
        totalTokens += evalResponse.usage?.total_tokens || 0;
        evaluation = extractSection(evalContent, 'Evaluation') || `Iteration stopped at token cap (${totalTokens} tokens). ${actions.length} actions executed.`;
        nextSteps = extractSection(evalContent, 'Next Steps') || 'Continue from where this iteration left off.';
        await emitLog(build.id, 'text', evalContent || evaluation, iteration.id);
        break;
      }

      messages.push({ role: 'assistant', content: assistantContent });

      // Persist messages incrementally
      await db
        .update(jkaiIterations)
        .set({
          messages: messages.filter((m) => m.role !== 'system'),
          tokensUsed: totalTokens,
        })
        .where(eq(jkaiIterations.id, iteration.id));

      if (turn === 0) {
        goals = assistantContent.split('\n').slice(0, 5).join('\n');
        const codeStart = assistantContent.indexOf('```');
        plan = codeStart > 0 ? assistantContent.slice(0, codeStart).trim() : assistantContent;
      }

      // Check for evaluation (signals iteration complete)
      if (hasEvaluation(assistantContent)) {
        evaluation = extractSection(assistantContent, 'Evaluation');
        nextSteps = extractSection(assistantContent, 'Next Steps');

        const textBeforeEval = assistantContent.split('## Evaluation')[0].trim();
        if (textBeforeEval) {
          await emitLog(build.id, 'text', textBeforeEval, iteration.id);
        }
        await emitLog(build.id, 'text', `## Evaluation\n${evaluation || ''}`, iteration.id);
        if (nextSteps) {
          await emitLog(build.id, 'text', `## Next Steps\n${nextSteps}`, iteration.id);
        }
        break;
      }

      // Check for code block
      const codeBlock = extractCodeBlock(assistantContent);
      if (codeBlock) {
        const textBefore = assistantContent.split('```')[0].trim();
        if (textBefore) {
          await emitLog(build.id, 'text', textBefore, iteration.id);
        }

        await emitLog(build.id, 'code', `\`\`\`${codeBlock.lang}\n${codeBlock.code}\n\`\`\``, iteration.id);

        // Execute code in the sandbox
        // execInSandbox now properly preserves newlines via base64, so all
        // multi-line scripts work correctly. For python/JS, we write to a
        // temp file and run with the correct interpreter.
        const workdir = `/home/jkai/workspace/${build.id}/dev`;
        let execCmd: string;
        if (['python'].includes(codeBlock.lang)) {
          // Write python code to temp file via bash heredoc (inside container, newlines preserved)
          const escaped = codeBlock.code.replace(/'/g, "'\\''");
          execCmd = `cd ${workdir} && cat > /tmp/jkai-code.py << 'JKAI_PYTHON_EOF'\n${codeBlock.code}\nJKAI_PYTHON_EOF\npython3 /tmp/jkai-code.py`;
        } else if (['javascript', 'typescript', 'node'].includes(codeBlock.lang)) {
          execCmd = `cd ${workdir} && cat > /tmp/jkai-code.js << 'JKAI_JS_EOF'\n${codeBlock.code}\nJKAI_JS_EOF\nnode /tmp/jkai-code.js`;
        } else {
          // Bash — executed directly (newlines preserved by execInSandbox)
          execCmd = `cd ${workdir}\n${codeBlock.code}`;
        }
        const execResult = await execInSandboxChecked(
          execCmd,
          codeBlock.code.includes('install') ? 300000 : 120000,
        );

        const action: ActionRecord = {
          lang: codeBlock.lang,
          code: codeBlock.code,
          stdout: execResult.stdout,
          stderr: execResult.stderr,
          exitCode: execResult.exitCode,
        };
        actions.push(action);

        const outputStr = [
          execResult.stdout ? `stdout:\n${execResult.stdout}` : '',
          execResult.stderr ? `stderr:\n${execResult.stderr}` : '',
          `exit code: ${execResult.exitCode}`,
        ]
          .filter(Boolean)
          .join('\n');
        await emitLog(build.id, 'output', outputStr, iteration.id);

        const turnsRemaining = maxTurns - turn - 1;
        let outputMsg = `Command output (exit code ${execResult.exitCode}):\n${execResult.stdout}\n${execResult.stderr ? `stderr: ${execResult.stderr}` : ''}`;
        if (turnsRemaining <= 5 && turnsRemaining > 2) {
          outputMsg += `\n\n[${turnsRemaining} steps remaining — start wrapping up soon]`;
        } else if (turnsRemaining <= 2 && turnsRemaining > 0) {
          outputMsg += `\n\n[Only ${turnsRemaining} step(s) left — write your ## Evaluation and ## Next Steps next]`;
        }
        messages.push({ role: 'user', content: outputMsg });
      } else {
        // Plain text response (no code, no evaluation)
        await emitLog(build.id, 'text', assistantContent, iteration.id);

        const turnsLeft = maxTurns - turn - 1;
        let continueMsg = 'Continue with your next step. Write exactly ONE code block per response, or if you are done, write your ## Evaluation and ## Next Steps.';
        if (turnsLeft <= 5 && turnsLeft > 2) {
          continueMsg = `You have ${turnsLeft} steps remaining in this iteration. Start planning your evaluation. Continue with code or write your ## Evaluation and ## Next Steps.`;
        } else if (turnsLeft <= 2 && turnsLeft > 0) {
          continueMsg = `Only ${turnsLeft} step(s) left! Write your ## Evaluation and ## Next Steps now, or execute ONE final critical command.`;
        }
        messages.push({ role: 'user', content: continueMsg });
      }
    }

    // If we exhausted maxTurns without an evaluation, synthesize one
    if (!evaluation) {
      evaluation = `Iteration reached maximum turns (${maxTurns}) without completing evaluation. ${actions.length} actions were executed.`;
      nextSteps = 'Continue from where this iteration left off.';
      await emitLog(build.id, 'system', `Auto-evaluation: ${evaluation}`, iteration.id);
    }

    return { goals, plan, actions, messages: messages.filter((m) => m.role !== 'system'), evaluation, nextSteps, tokensUsed: totalTokens };
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
