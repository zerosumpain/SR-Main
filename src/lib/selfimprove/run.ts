// src/lib/selfimprove/run.ts
//
// The nightly pipeline + its guards. `runImprovementNow` is the single entry
// point (called by the cron in engine.ts and by the admin "Run now" button). It
// NEVER throws into its caller — every phase is independently try/caught, the
// run is marked `partial` on a phase failure, `budget_exceeded` on a hard cap,
// `aborted_user_active` if the user shows up mid-run (cron only), and `failed`
// only on a top-level surprise.

import { withActivity } from '$lib/context/activity';
import { upsertRecord } from '$lib/datastore';
import {
  BUDGET_CAPS,
  COLLECTIONS,
  SETTINGS_AUTOBUILD_KEY,
  SYSTEM_ACTOR,
  asData,
  emptyPhases,
  errMsg,
  type BuildLanes,
  type ImprovementRunData,
  type PhaseName,
  type RunAction,
} from './types';
import { ensureSystemCollections } from './seed-apis';
import { gatherSignals, learnInsights, type GatheredSignals } from './analyze';
import { discoverApis } from './discover';
import { repairTools } from './repair';
import { proposeFeatures } from './propose';
import { optimiseCalls } from './optimise';
import { finalizeAndNotify } from './report';
import type { QuestionInsights } from './types';
import { hasOpenNewDataWork, listBacklog } from './backlog';
import { getSetting } from '$lib/server/models/settings';

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
      const { getLLMClient } = await import('$lib/llm/client');
      const { priceFor, computeCost } = await import('$lib/llm/pricing');

      // Still pinned off the chat default — this pipeline writes code that
      // ships unattended, so the model that authors it should not move because
      // the chat default moved. What changed is that the pin is now a SETTING
      // (`jkai.selfimprove.model`, falling back to SELFIMPROVE_MODEL) instead of
      // a constant, so it can be seen and changed from the model picker rather
      // than only by editing this file.
      const { resolveSelfimproveModel } = await import('$lib/server/models/workload-settings');
      const { client, model } = await getLLMClient(await resolveSelfimproveModel());
      // max_tokens >= 3000 so GLM reasoning tokens don't truncate the answer
      // (feedback_glm_reasoning_tokens). No response_format — we parse loosely.
      const resp = await withActivity('selfimprove', () =>
        client.chat.completions.create({
          model,
          messages,
          max_tokens: Math.max(opts?.maxTokens ?? 3000, 3000),
          temperature: opts?.temperature ?? 0.3,
        }),
      );

      budget.llmCalls++;
      const usage = resp.usage;
      if (usage) {
        const tin = usage.prompt_tokens ?? 0;
        const tout = usage.completion_tokens ?? 0;
        budget.tokensIn += tin;
        budget.tokensOut += tout;
        // The provider's own `usage.cost` first, the catalogue price second —
        // the same order the ledger uses. The catalogue has no row for the
        // flash model this runs on, so before this every night's cost was a
        // fabricated zero on the pulse and the run record (seen 2026-09-03).
        const reported = (usage as { cost?: unknown }).cost;
        const pricing = priceFor('openrouter', resp.model || model);
        if (typeof reported === 'number' && Number.isFinite(reported)) budget.costUsd += reported;
        else if (pricing) budget.costUsd += computeCost(pricing, tin, tout);
      }
      const content = resp.choices?.[0]?.message?.content ?? '';
      const { parseJsonLoose } = await import('./types');
      return { content, json: parseJsonLoose(content) };
    },
  };
  return budget;
}

// ---------------------------------------------------------------------------
// Run lock + status
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
  opts?: {
    trigger?: 'manual' | 'cron';
    /**
     * The two builders this module may not import (see `BuildLanes`). Absent
     * means the propose phase falls back to the blind draft PR it has always
     * had, which is what a dev host or a test should get.
     */
    lanes?: BuildLanes;
    /**
     * The idle gate, consulted only on a cron run (at the start and between
     * phases). Injected rather than imported: it lives in `$lib/heartbeat/idle`,
     * and the heartbeat imports this module, so importing it back would close a
     * module cycle. A cron run with no gate fails CLOSED — it reads as "user
     * active" and skips, the same answer the gate gives when it cannot tell.
     */
    isUserActive?: () => Promise<boolean>;
  },
): Promise<{ runId: string; data: ImprovementRunData }> {
  const trigger = opts?.trigger ?? 'manual';
  const isUserActive = opts?.isUserActive ?? (async () => true);
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
      return { runId, data };
    }

    let stop: 'budget' | 'time' | 'user' | null = null;
    const state: { signals?: GatheredSignals; insights?: QuestionInsights } = {};

    // Is the engine allowed to spend on a lane without a tap? Explicit `true`
    // only — an unattended path that opens a £2 build must never enable
    // itself. Read once, before any phase, so a mid-run setting change cannot
    // make one phase behave differently from the next.
    const autobuild = (await getSetting<boolean>(SETTINGS_AUTOBUILD_KEY).catch(() => false)) === true;

    /**
     * Is there open work in a lane that brings new data in?
     *
     * Read here rather than inside `optimise` so the demotion is visible at
     * the level that decides the night's priorities. Call-efficiency stopped
     * being this engine's prime outcome on 2026-09-04: it still MEASURES every
     * night and still judges any experiment already running — abandoning a
     * live trial unjudged would leave an unproven overlay in the prompt
     * forever, which is the one thing `TRIAL` exists to prevent — but it may
     * not START a new one while a source or a watch is waiting to be built.
     */
    let newDataWaiting = false;
    try {
      newDataWaiting = hasOpenNewDataWork(await listBacklog());
    } catch (err) {
      console.error('[selfimprove] new-data check failed:', errMsg(err));
    }

    // The toolsmith that authored runtime tools unattended was retired by D3
    // (spec 2026-09-25): an idea for a tool is a backlog item like any other
    // and reaches the repo builder once the owner accepts its brief. `build`
    // stays in the record, skipped, so `improvement_runs` keeps one shape
    // across the change — a missing `PhaseName` would leave a hole every
    // dashboard would have to special-case.
    data.phases.build = { status: 'skipped', detail: 'retired — tool ideas reach the build lane through the backlog' };

    const phases: Array<[Exclude<PhaseName, 'report' | 'build'>, () => Promise<RunAction[]>]> = [
      [
        'gather',
        async () => {
          state.signals = await gatherSignals();
          try {
            const { autoGroomBacklog } = await import('$lib/workflows/backlog-grooming.server');
            const { epics } = await autoGroomBacklog();
            return [{ kind: 'themes_found' as const, detail: `${epics.length} epics automatically reconciled with their deliverables` }];
          } catch (err) {
            console.error('[selfimprove] epic reconciliation failed:', errMsg(err));
          }
          return [];
        },
      ],
      [
        'learn',
        async () => {
          const r = await learnInsights(
            state.signals ?? {
              messages: [],
              toolAudit: null,
              customTools: [],
              currentInsights: null,
              capabilityInventory: null,
            },
            budget,
          );
          state.insights = r.insights;
          return r.actions;
        },
      ],
      [
        'discover',
        async () => {
          const portfolioNeeds = (state.insights?.opportunities ?? [])
            .filter((o) => o.kind === 'data_source' || o.kind === 'online_service')
            .map(
              (o) =>
                `${o.title}: ${o.need} Consumer: ${o.consumer}. Value: ${o.value}` +
                (o.integrationHint ? ` Suggested integration: ${o.integrationHint}` : ''),
            );
          // The appetite and fault ledgers used to prepend their needs here;
          // both were retired by D3 (2026-09-26), so the search is the
          // learn phase's own portfolio opportunities.
          return discoverApis(state.insights, budget, portfolioNeeds);
        },
      ],
      // Repair keeps the runtime tools that already exist working (chat still
      // loads them). A source that has broken is still a source that stopped
      // bringing data in, so repair keeps its slot.
      ['repair', async () => repairTools(budget, runId)],
      // Propose now runs BEFORE optimise, which is the reordering that demotes
      // efficiency. It is also no longer the expensive phase it was: it hands
      // an ask to the autonomous builder instead of authoring whole files
      // blind, so it usually costs no LLM call here at all.
      ['propose', async () => proposeFeatures(budget, runId, { lanes: opts?.lanes, autobuild })],
      // Optimise last. It measures every night and judges any live trial
      // whatever else happened; `mayStartNewTrial` is what stops a fresh
      // experiment being started while new-data work waits.
      ['optimise', async () => optimiseCalls(budget, runId, { mayStartNewTrial: !newDataWaiting })],
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

    return { runId, data };
  } catch (err) {
    // Top-level surprise — capture as `failed`, never rethrow into the scheduler.
    console.error('[selfimprove] run failed:', errMsg(err));
    data.status = 'failed';
    data.finishedAt = new Date().toISOString();
    data.report = `Run failed: ${errMsg(err)}`;
    syncBudget(data, budget);
    await safePersist(runId, data);
    return { runId, data };
  } finally {
    releaseRunLock();
  }
}
