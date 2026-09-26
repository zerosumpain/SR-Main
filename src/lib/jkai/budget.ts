import { db } from '$lib/db';
import { jkaiIterations } from '$lib/db/schema';
import { eq, and, gte } from 'drizzle-orm';
import type { BudgetConfig, BudgetCheckResult } from './types';
import type { JkaiBuild } from '$lib/db/schema';
import type { GuardVerdict, SpendGuard } from '$lib/costs/guard';

/**
 * How long until the rolling window has room again, and how to say so.
 *
 * A cooldown re-checks every 5 minutes, so it logs the same line over and over.
 * Without a time in it, the reader cannot tell a two-minute pause from a
 * forty-minute one — during change request #204 that ambiguity was the whole
 * reason the build got killed rather than waited out. The oldest iteration
 * leaving the window is the first moment anything can change, so quote that.
 */
function cooldown(oldestInWindow: number | undefined, reason: string) {
  const resumeAt = oldestInWindow ? oldestInWindow + 60 * 60 * 1000 : Date.now() + 60 * 1000;
  const waitMs = resumeAt - Date.now();
  const at = new Date(resumeAt).toLocaleTimeString('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
  });
  return {
    canProceed: false as const,
    // Cap the nap at 5 minutes and re-check: the window is rolling, so room can
    // appear sooner than the oldest iteration's own expiry.
    sleepMs: Math.min(Math.max(waitMs, 1000), 5 * 60 * 1000),
    reason:
      `${reason} Cooling down for about ${Math.max(1, Math.round(waitMs / 60000))} min — ` +
      `not before ${at}, when the oldest iteration leaves the hour. Nothing is wrong and no work is lost.`,
  };
}

/**
 * The floor every build gets unless its creator says otherwise.
 *
 * This existed twice, copy-pasted, in the manual API and forge — and not at
 * all on the chat build tool, which passed `budgetConfig: {}`. Because every
 * check here is guarded on truthiness, an absent key is not a default, it is
 * "no cap": the no-progress brake only arms when `maxIdleIterations` is set,
 * so the two highest-volume entry points had no brake at all. Build 42244cc0
 * ran to eleven iterations having finished its work at two.
 *
 * Spread this UNDER the caller's own config so an explicit value still wins.
 */
export const DEFAULT_BUILD_BUDGET = {
  maxIterations: 25,
  maxTotalMinutes: 120,
  // Total tokens, not output tokens — one ordinary iteration costs ~1M of
  // them, so 1M here stalled a build after its first. See change-request.ts.
  maxTokensPerHour: 3_000_000,
  activeMinutesPerHour: 45,
  // Three iterations in a row that change nothing is a verification loop,
  // not work.
  maxIdleIterations: 3,
} as const satisfies BudgetConfig;

export async function checkBudget(build: JkaiBuild): Promise<BudgetCheckResult> {
  const config = build.budgetConfig as BudgetConfig;

  if (config.maxIterations && build.iterationsCompleted >= config.maxIterations) {
    return { canProceed: false, shouldComplete: true, reason: `Reached max iterations (${config.maxIterations})` };
  }

  if (config.maxTotalMinutes && build.activeMinutesUsed >= config.maxTotalMinutes) {
    return { canProceed: false, shouldComplete: true, reason: `Reached total time cap (${config.maxTotalMinutes}m)` };
  }

  if (config.maxCostUsd) {
    const spent = Number.parseFloat(String(build.costUsd ?? '0'));
    if (Number.isFinite(spent) && spent >= config.maxCostUsd) {
      return {
        canProceed: false,
        shouldComplete: true,
        reason: `Cost cap reached ($${spent.toFixed(4)} / $${config.maxCostUsd.toFixed(2)}).`,
      };
    }
  }

  const windowStart = new Date(Date.now() - 60 * 60 * 1000);

  // Every iteration in the window, not just the completed ones. A failed
  // iteration costs exactly as much as a successful one — build #126 spent
  // 3.08M tokens across three iterations while this saw only the 490k from the
  // one that completed, so the 1M/hour cap never engaged at all (2026-08-07).
  const recentIterations = await db
    .select()
    .from(jkaiIterations)
    .where(
      and(
        eq(jkaiIterations.buildId, build.id),
        gte(jkaiIterations.createdAt, windowStart),
      ),
    );

  if (config.activeMinutesPerHour) {
    const minutesInWindow = recentIterations.reduce(
      (sum, it) => sum + (it.durationMs || 0) / 60000,
      0,
    );
    if (minutesInWindow >= config.activeMinutesPerHour) {
      const oldestInWindow = recentIterations
        .map((it) => it.createdAt.getTime())
        .sort((a, b) => a - b)[0];
      return cooldown(
        oldestInWindow,
        `Active minutes limit reached (${minutesInWindow.toFixed(1)}/${config.activeMinutesPerHour}m in the last hour).`,
      );
    }
  }

  if (config.maxTokensPerHour) {
    const tokensInWindow = recentIterations.reduce(
      (sum, it) => sum + (it.tokensUsed || 0),
      0,
    );
    if (tokensInWindow >= config.maxTokensPerHour) {
      const oldestInWindow = recentIterations
        .map((it) => it.createdAt.getTime())
        .sort((a, b) => a - b)[0];
      return cooldown(
        oldestInWindow,
        `Token limit reached (${tokensInWindow.toLocaleString('en-GB')} of ` +
          `${config.maxTokensPerHour.toLocaleString('en-GB')} total tokens in the last hour).`,
      );
    }
  }

  return { canProceed: true };
}

/**
 * `checkBudget`'s answer in the shared SpendGuard vocabulary. A pure mapping —
 * the build policy above is unchanged:
 *
 *   canProceed     → allowed
 *   sleepMs        → retryAfterMs   (a rolling-window cooldown, capped at 5 min)
 *   shouldComplete → terminal       (a lifetime cap: stop, don't wait)
 */
export function toGuardVerdict(result: BudgetCheckResult, build?: JkaiBuild): GuardVerdict {
  const verdict: GuardVerdict = {
    allowed: result.canProceed,
    reason: result.reason ?? null,
    remaining: build ? remainingFor(build) : {},
  };
  if (result.sleepMs !== undefined) verdict.retryAfterMs = result.sleepMs;
  if (result.shouldComplete !== undefined) verdict.terminal = result.shouldComplete;
  return verdict;
}

/** Headroom on the lifetime caps that are set. A missing key is uncapped, so it is omitted. */
function remainingFor(build: JkaiBuild): Record<string, number> {
  const config = (build.budgetConfig ?? {}) as BudgetConfig;
  const out: Record<string, number> = {};
  if (config.maxIterations) out.iterations = Math.max(0, config.maxIterations - build.iterationsCompleted);
  if (config.maxTotalMinutes) out.minutes = Math.max(0, config.maxTotalMinutes - build.activeMinutesUsed);
  if (config.maxCostUsd) {
    const spent = Number.parseFloat(String(build.costUsd ?? '0'));
    if (Number.isFinite(spent)) out.costUsd = Math.max(0, config.maxCostUsd - spent);
  }
  return out;
}

/**
 * A build's budget as a SpendGuard. Spend is recorded by the orchestrator as
 * `jkai_iterations` rows and the build's own counters, which `check()` reads
 * back — so `record()` has nothing to add and is a no-op.
 *
 * The orchestrator still calls `checkBudget` directly; this is the adapter for
 * code that wants to read every guard the same way.
 */
export function buildGuard(build: JkaiBuild): SpendGuard<void> {
  return {
    async check() {
      return toGuardVerdict(await checkBudget(build), build);
    },
    record() {},
  };
}
