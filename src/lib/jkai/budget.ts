import { db } from '$lib/db';
import { jkaiIterations } from '$lib/db/schema';
import { eq, and, gte } from 'drizzle-orm';
import type { BudgetConfig, BudgetCheckResult } from './types';
import type { JkaiBuild } from '$lib/db/schema';

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
