import { db } from '$lib/db';
import { jkaiBuilds, jkaiIterations, jkaiLogs } from '$lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { checkBudget } from './budget';
import { buildSystemPrompt, buildIterationContext } from './prompt';
import {
  ensureSandboxRunning,
  ensureWorkspace,
  execInSandbox,
  listWorkspaceFiles,
  readServeJson,
  startProjectServer,
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

async function emitLog(
  buildId: string,
  type: string,
  content: string,
  iterationId: string | null = null,
): Promise<void> {
  const [log] = await db
    .insert(jkaiLogs)
    .values({ buildId, iterationId, type, content })
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

      const iterationNumber = (prevIteration?.number || 0) + 1;

      const [iteration] = await db
        .insert(jkaiIterations)
        .values({
          buildId,
          number: iterationNumber,
          status: 'running',
        })
        .returning();

      await emitLog(buildId, 'system', `Starting iteration #${iterationNumber}`, iteration.id);

      const startTime = Date.now();

      const result = await this.executeIteration(build, iteration, prevIteration);

      const durationMs = Date.now() - startTime;

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

      await db
        .update(jkaiBuilds)
        .set({
          iterationsCompleted: build.iterationsCompleted + 1,
          tokensUsed: build.tokensUsed + result.tokensUsed,
          activeMinutesUsed: build.activeMinutesUsed + durationMs / 60000,
          updatedAt: new Date(),
        })
        .where(eq(jkaiBuilds.id, buildId));

      await this.checkServeConfig(buildId);

      await emitLog(buildId, 'system', `Iteration #${iterationNumber} completed (${(durationMs / 1000).toFixed(0)}s)`, iteration.id);

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

    for (let turn = 0; turn < maxTurns; turn++) {
      if (this.stopped) break;

      const response = await client.chat.completions.create({
        model,
        messages,
        temperature: 0.7,
        max_tokens: 4096,
      });

      const assistantContent = response.choices[0]?.message?.content || '';
      totalTokens += response.usage?.total_tokens || 0;

      messages.push({ role: 'assistant', content: assistantContent });

      await db
        .update(jkaiIterations)
        .set({ messages: messages.filter((m) => m.role !== 'system') })
        .where(eq(jkaiIterations.id, iteration.id));

      if (turn === 0) {
        goals = assistantContent.split('\n').slice(0, 5).join('\n');
        const codeStart = assistantContent.indexOf('```');
        plan = codeStart > 0 ? assistantContent.slice(0, codeStart).trim() : assistantContent;
      }

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

      const codeBlock = extractCodeBlock(assistantContent);
      if (codeBlock) {
        const textBefore = assistantContent.split('```')[0].trim();
        if (textBefore) {
          await emitLog(build.id, 'text', textBefore, iteration.id);
        }

        await emitLog(build.id, 'code', `\`\`\`${codeBlock.lang}\n${codeBlock.code}\n\`\`\``, iteration.id);

        // Execute — wrap code appropriately for its language
        const workdir = `/home/jkai/workspace/${build.id}`;
        let execCmd: string;
        if (['python'].includes(codeBlock.lang)) {
          execCmd = `cd ${workdir} && python3 -c ${JSON.stringify(codeBlock.code)}`;
        } else if (['javascript', 'typescript', 'node'].includes(codeBlock.lang)) {
          execCmd = `cd ${workdir} && node -e ${JSON.stringify(codeBlock.code)}`;
        } else {
          execCmd = `cd ${workdir} && ${codeBlock.code}`;
        }
        const execResult = await execInSandbox(
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

        messages.push({
          role: 'user',
          content: `Command output (exit code ${execResult.exitCode}):\n${execResult.stdout}\n${execResult.stderr ? `stderr: ${execResult.stderr}` : ''}`,
        });
      } else {
        await emitLog(build.id, 'text', assistantContent, iteration.id);

        messages.push({
          role: 'user',
          content: 'Continue with your next step.',
        });
      }
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
    if (
      currentConfig?.port === config.port &&
      currentConfig?.startCommand === config.startCommand
    ) {
      return;
    }

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
  }
}

export const orchestrator = new Orchestrator();
