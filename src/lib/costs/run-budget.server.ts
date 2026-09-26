/**
 * The per-run cash budget for the unattended nightly pipelines.
 *
 * Self-improve and the workflow doctor each carried their own `createBudget`,
 * the second cloned from the first and then drifted: the doctor priced a call
 * against the provider it had actually resolved, while self-improve still
 * hard-coded 'openrouter'; self-improve read the provider's own `usage.cost`
 * first, the doctor never did. One budget now, taking the correct half of each.
 *
 * Counters live in memory for the life of the run. The durable ledger row
 * (`recordDurableLLMCall`) is fire-and-forget, so reading spend back from it
 * mid-run would race the write and under-count — exactly the wrong direction
 * for a cap.
 */
import type { ModelContext } from '$lib/constants/model-context';
import type { GuardVerdict, SpendGuard } from './guard';

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BudgetExceededError';
  }
}

export interface LlmCallOpts {
  maxTokens?: number;
  temperature?: number;
  /**
   * Accepted for structural compatibility (the doctor's classify.ts passes
   * one) and deliberately IGNORED — these pipelines pin their model through a
   * workload setting, and the pin is the point.
   */
  model?: string;
}

export interface RunBudgetCaps {
  maxLlmCalls: number;
  maxCostUsd: number;
  maxWallMs: number;
}

export interface RunSpend {
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

/**
 * What a pipeline phase is handed. Deliberately NOT the SpendGuard methods:
 * phases only call, count and watch the clock, and their test fakes implement
 * exactly this. The run itself holds a `RunBudget`.
 */
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
   * Wall-clock remaining. The phases loop internally, so they need to
   * self-limit — a between-phase check alone would let one long loop eat the
   * whole night. The wall clock never throws; it is advisory to the loops.
   */
  timeLeftMs(): number;
}

/** The run's own handle: the phase-facing Budget plus the SpendGuard view. */
export type RunBudget = Budget & SpendGuard<RunSpend>;

export interface RunBudgetOptions {
  caps: RunBudgetCaps;
  /** Workload id the calls are attributed to on the spend ledger. */
  activity: string;
  /** The pinned model for this pipeline, resolved per call. */
  resolveModel: () => Promise<ModelContext>;
  /** Default sampling temperature when a call does not pass one. */
  temperature: number;
  /**
   * How to read JSON out of the answer. Defaults to a strict `JSON.parse`;
   * self-improve passes its loose parser (fences, prose around the object).
   */
  parse?: (text: string) => unknown;
}

function parseStrict(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function createRunBudget(opts: RunBudgetOptions): RunBudget {
  const { maxLlmCalls, maxCostUsd, maxWallMs } = opts.caps;
  const parse = opts.parse ?? parseStrict;
  const startedAt = Date.now();

  const verdict = (): GuardVerdict => {
    const allowed = budget.llmCalls < maxLlmCalls && budget.costUsd < maxCostUsd;
    return {
      allowed,
      reason: allowed
        ? null
        : `budget exceeded (calls=${budget.llmCalls}/${maxLlmCalls}, cost=$${budget.costUsd.toFixed(3)}/$${maxCostUsd})`,
      remaining: {
        llmCalls: Math.max(0, maxLlmCalls - budget.llmCalls),
        costUsd: Math.max(0, maxCostUsd - budget.costUsd),
        wallMs: budget.timeLeftMs(),
      },
      // A run budget never refills: once spent, the run is over.
      terminal: !allowed,
    };
  };

  const budget: RunBudget = {
    llmCalls: 0,
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    exceeded: false,
    timeLeftMs() {
      return Math.max(0, maxWallMs - (Date.now() - startedAt));
    },
    async check() {
      return verdict();
    },
    record(u) {
      budget.llmCalls++;
      budget.tokensIn += u.tokensIn;
      budget.tokensOut += u.tokensOut;
      budget.costUsd += u.costUsd;
    },
    async call(messages, callOpts) {
      const v = verdict();
      if (!v.allowed) {
        budget.exceeded = true;
        throw new BudgetExceededError(v.reason ?? 'budget exceeded');
      }
      // Lazy imports keep the module light for tests that never reach the gateway.
      const { getLLMClient } = await import('$lib/llm/client');
      const { priceFor, computeCost } = await import('$lib/llm/pricing');
      const { withActivity } = await import('$lib/context/activity');

      const modelCtx = await opts.resolveModel();
      const { client, model } = await getLLMClient(modelCtx);
      // max_tokens >= 3000 so a reasoning model doesn't burn the allowance
      // before it emits the answer (feedback_glm_reasoning_tokens). No
      // response_format — callers parse.
      const resp = await withActivity(opts.activity, () =>
        client.chat.completions.create({
          model,
          messages,
          max_tokens: Math.max(callOpts?.maxTokens ?? 3000, 3000),
          temperature: callOpts?.temperature ?? opts.temperature,
        }),
      );

      const spend: RunSpend = { tokensIn: 0, tokensOut: 0, costUsd: 0 };
      const usage = resp.usage;
      if (usage) {
        spend.tokensIn = usage.prompt_tokens ?? 0;
        spend.tokensOut = usage.completion_tokens ?? 0;
        // The provider's own `usage.cost` first, the catalogue price second —
        // the same order the ledger uses. Priced against the provider we
        // actually resolved: a Codex pick priced off the OpenRouter table would
        // read as a fabricated number, and a flash model missing from the
        // catalogue read as a fabricated zero (seen 2026-09-03).
        const reported = (usage as { cost?: unknown }).cost;
        if (typeof reported === 'number' && Number.isFinite(reported)) {
          spend.costUsd = reported;
        } else {
          const pricing = priceFor(modelCtx.provider, resp.model || model);
          if (pricing) spend.costUsd = computeCost(pricing, spend.tokensIn, spend.tokensOut);
        }
      }
      budget.record(spend);

      const content = resp.choices?.[0]?.message?.content ?? '';
      return { content, json: parse(content) };
    },
  };
  return budget;
}
