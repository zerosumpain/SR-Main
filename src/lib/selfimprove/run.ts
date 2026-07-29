// src/lib/selfimprove/run.ts
//
// The nightly pipeline + its guards. `runImprovementNow` is the single entry
// point (called by the cron in engine.ts and by the admin "Run now" button). It
// NEVER throws into its caller — every phase is independently try/caught, the
// run is marked `partial` on a phase failure, `budget_exceeded` on a hard cap,
// `aborted_user_active` if the user shows up mid-run (cron only), and `failed`
// only on a top-level surprise.

import { db } from '$lib/db';
import { orchestratorChats } from '$lib/db/schema';
import { and, eq, gte } from 'drizzle-orm';
import { upsertRecord } from '$lib/datastore';
import {
  BUDGET_CAPS,
  COLLECTIONS,
  IDLE_WINDOW_MS,
  SELFIMPROVE_MODEL,
  SYSTEM_ACTOR,
  asData,
  emptyPhases,
  errMsg,
  type ImprovementRunData,
  type PhaseName,
  type RunAction,
} from './types';
import { ensureSystemCollections } from './seed-apis';
import { gatherSignals, learnInsights, type GatheredSignals } from './analyze';
import { discoverApis } from './discover';
import { buildTool } from './toolsmith';
import { repairTools } from './repair';
import { proposeFeatures } from './propose';
import { optimiseCalls } from './optimise';
import { finalizeAndNotify } from './report';
import type { QuestionInsights } from './types';

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetExceededError';
  }
}

export interface LlmCallOpts {
  maxTokens?: number;
  temperature?: number;
}

export interface Budget {
  llmCalls: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  exceeded: boolean;
  /** One gateway completion, budget-checked BEFORE the call. Throws
   *  BudgetExceededError once a hard cap is reached. Returns raw + parsed JSON. */
  call(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    opts?: LlmCallOpts,
  ): Promise<{ content: string; json: unknown }>;
  /**
   * Wall-clock remaining. The build/repair/propose phases loop internally, so
   * they need to self-limit — the between-phase check alone would let one long
   * loop eat the whole night.
   */
  timeLeftMs(): number;
}

type Caps = { maxLlmCalls: number; maxCostUsd: number; maxWallMs: number };

/** Create a fresh budget counter. Caps are overridable for tests. */
export function createBudget(caps: Partial<Caps> = {}): Budget {
  const maxLlmCalls = caps.maxLlmCalls ?? BUDGET_CAPS.maxLlmCalls;
  const maxCostUsd = caps.maxCostUsd ?? BUDGET_CAPS.maxCostUsd;
  const maxWallMs = caps.maxWallMs ?? BUDGET_CAPS.maxWallMs;
  const startedAt = Date.now();

  const budget: Budget = {
    llmCalls: 0,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    exceeded: false,
    timeLeftMs() {
      return Math.max(0, maxWallMs - (Date.now() - startedAt));
    },
    async call(messages, opts) {
      if (budget.llmCalls >= maxLlmCalls || budget.costUsd >= maxCostUsd) {
        budget.exceeded = true;
        throw new BudgetExceededError(
          `budget exceeded (calls=${budget.llmCalls}/${maxLlmCalls}, cost=$${budget.costUsd.toFixed(3)}/$${maxCostUsd})`,
        );
      }
      // Lazy imports keep the module light for tests that never reach the gateway.
      const { getLLMClient } = await import('$lib/jkai/llm-client');
      const { priceFor, computeCost } = await import('$lib/jkai/llm-pricing');

      // Pinned to SELFIMPROVE_MODEL rather than resolveDefaultModel(): this
      // pipeline writes code that ships unattended, so a change to the chat
      // default must not silently change what authors it.
      const { client, model } = await getLLMClient({
        provider: 'openrouter',
        modelId: SELFIMPROVE_MODEL,
      });
      // max_tokens >= 3000 so GLM reasoning tokens don't truncate the answer
      // (feedback_glm_reasoning_tokens). No response_format — we parse loosely.
      const resp = await client.chat.completions.create({
        model,
        messages,
        max_tokens: Math.max(opts?.maxTokens ?? 3000, 3000),
        temperature: opts?.temperature ?? 0.3,
      });

      budget.llmCalls++;
      const usage = resp.usage;
      if (usage) {
        const tin = usage.prompt_tokens ?? 0;
        const tout = usage.completion_tokens ?? 0;
        budget.tokensIn += tin;
        budget.tokensOut += tout;
        const pricing = priceFor('openrouter', resp.model || model);
        if (pricing) budget.costUsd += computeCost(pricing, tin, tout);
      }
      const content = resp.choices?.[0]?.message?.content ?? '';
      const { parseJsonLoose } = await import('./types');
      return { content, json: parseJsonLoose(content) };
    },
  };
  return budget;
}

// ---------------------------------------------------------------------------
// Run lock + status + idle gate
// ---------------------------------------------------------------------------

let running = false;
let lastRunId: string | undefined;

export function getImprovementStatus(): { running: boolean; lastRunId?: string } {
  return { running, lastRunId };
}

/** Overlap guard: succeeds only if no run is in progress in THIS process. */
export function acquireRunLock(): boolean {
  if (running) return false;
  running = true;
  return true;
}

export function releaseRunLock(): void {
  running = false;
}

/** True if the user chatted (orchestrator_chats role=user) within `withinMs`. */
export async function isUserActive(withinMs: number = IDLE_WINDOW_MS): Promise<boolean> {
  try {
    const since = new Date(Date.now() - withinMs);
    const rows = await db
      .select({ id: orchestratorChats.id })
      .from(orchestratorChats)
      .where(and(eq(orchestratorChats.role, 'user'), gte(orchestratorChats.createdAt, since)))
      .limit(1);
    return rows.length > 0;
  } catch (err) {
    // Fail CLOSED: if we cannot tell whether the user is active, assume they are
    // and skip the run. A DB hiccup must never cause the nightly loop to spend
    // LLM budget while the user is in fact using the site.
    console.error('[selfimprove] idle check failed — treating user as active:', errMsg(err));
    return true;
  }
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

function syncBudget(data: ImprovementRunData, budget: Budget): void {
  data.llmCalls = budget.llmCalls;
  data.tokensIn = budget.tokensIn;
  data.tokensOut = budget.tokensOut;
  data.costUsd = Number(budget.costUsd.toFixed(4));
}

async function safePersist(runId: string, data: ImprovementRunData): Promise<void> {
  try {
    await upsertRecord(COLLECTIONS.improvementRuns, { key: runId, data: asData(data) }, SYSTEM_ACTOR);
  } catch (err) {
    console.error('[selfimprove] run persist failed:', errMsg(err));
  }
}

/**
 * Execute one improvement run end-to-end. Rejects only if a run is already in
 * progress (overlap guard). Everything else is captured on the run record.
 */
export async function runImprovementNow(
  opts?: { trigger?: 'manual' | 'cron' },
): Promise<{ runId: string }> {
  const trigger = opts?.trigger ?? 'manual';
  if (!acquireRunLock()) {
    throw new Error('a self-improvement run is already in progress');
  }

  const runId = crypto.randomUUID();
  lastRunId = runId;
  const startedAt = new Date();
  const budget = createBudget();
  const data: ImprovementRunData = {
    status: 'running',
    trigger,
    startedAt: startedAt.toISOString(),
    phases: emptyPhases(),
    llmCalls: 0,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    actions: [],
    report: '',
  };

  try {
    // Make sure our state collections exist (manual runs may fire before the
    // boot seed on a cold process). Idempotent.
    try {
      await ensureSystemCollections();
    } catch (err) {
      console.error('[selfimprove] ensureSystemCollections failed:', errMsg(err));
    }
    await safePersist(runId, data);

    // Cron initial idle gate — a manual "Run now" deliberately bypasses this.
    if (trigger === 'cron' && (await isUserActive())) {
      data.status = 'aborted_user_active';
      for (const name of Object.keys(data.phases) as PhaseName[]) {
        data.phases[name] = { status: 'skipped', detail: 'user active at start' };
      }
      data.finishedAt = new Date().toISOString();
      data.report = 'Skipped: user was active when the nightly run was due.';
      await safePersist(runId, data);
      return { runId };
    }

    let stop: 'budget' | 'time' | 'user' | null = null;
    const state: { signals?: GatheredSignals; insights?: QuestionInsights } = {};

    const phases: Array<[Exclude<PhaseName, 'report'>, () => Promise<RunAction[]>]> = [
      [
        'gather',
        async () => {
          state.signals = await gatherSignals();
          return [];
        },
      ],
      [
        'learn',
        async () => {
          const r = await learnInsights(state.signals ?? { messages: [], toolAudit: null, customTools: [], currentInsights: null }, budget);
          state.insights = r.insights;
          return r.actions;
        },
      ],
      ['discover', async () => discoverApis(state.insights, budget)],
      ['build', async () => buildTool(state.insights, state.signals, budget, runId)],
      // Repair runs AFTER build so a night that ships nothing new still has a
      // chance to fix something that already exists.
      ['repair', async () => repairTools(budget, runId)],
      // Optimise runs before propose: reducing the calls an answer costs is the
      // prime outcome, and it is far cheaper (1 LLM call) than authoring a
      // feature proposal — it must never be the phase the budget squeezes out.
      ['optimise', async () => optimiseCalls(budget, runId)],
      // Propose runs last: it is the most expensive phase and the least urgent,
      // so it yields its budget to build and repair.
      ['propose', async () => proposeFeatures(budget, runId)],
    ];

    for (const [name, fn] of phases) {
      if (stop) {
        data.phases[name] = { status: 'skipped', detail: `stopped after ${stop} limit` };
        continue;
      }
      // Between-phase gates.
      if (Date.now() - startedAt.getTime() > BUDGET_CAPS.maxWallMs) {
        stop = 'time';
        data.phases[name] = { status: 'skipped', detail: 'wall-clock cap reached' };
        continue;
      }
      if (trigger === 'cron' && (await isUserActive())) {
        stop = 'user';
        data.phases[name] = { status: 'skipped', detail: 'user became active mid-run' };
        continue;
      }

      const t0 = Date.now();
      try {
        const actions = await fn();
        data.actions.push(...actions);
        data.phases[name] = { status: 'ok', ms: Date.now() - t0 };
      } catch (err) {
        if (err instanceof BudgetExceededError) {
          stop = 'budget';
          data.phases[name] = { status: 'failed', detail: 'budget exceeded', ms: Date.now() - t0 };
        } else {
          data.phases[name] = { status: 'failed', detail: errMsg(err).slice(0, 300), ms: Date.now() - t0 };
        }
      }
      syncBudget(data, budget);
      await safePersist(runId, data);
    }

    // Determine overall status.
    syncBudget(data, budget);
    data.finishedAt = new Date().toISOString();
    if (stop === 'user') data.status = 'aborted_user_active';
    else if (stop === 'budget' || budget.exceeded) data.status = 'budget_exceeded';
    else {
      const anyFailed = (
        ['gather', 'learn', 'discover', 'build', 'repair', 'optimise', 'propose'] as PhaseName[]
      ).some((n) => data.phases[n].status === 'failed');
      data.status = anyFailed ? 'partial' : 'complete';
    }

    // Report phase: build text, persist final record, WhatsApp summary.
    data.phases.report = { status: 'ok' };
    try {
      await finalizeAndNotify(runId, data);
    } catch (err) {
      data.phases.report = { status: 'failed', detail: errMsg(err).slice(0, 300) };
      await safePersist(runId, data);
    }

    return { runId };
  } catch (err) {
    // Top-level surprise — capture as `failed`, never rethrow into the scheduler.
    console.error('[selfimprove] run failed:', errMsg(err));
    data.status = 'failed';
    data.finishedAt = new Date().toISOString();
    data.report = `Run failed: ${errMsg(err)}`;
    syncBudget(data, budget);
    await safePersist(runId, data);
    return { runId };
  } finally {
    releaseRunLock();
  }
}
