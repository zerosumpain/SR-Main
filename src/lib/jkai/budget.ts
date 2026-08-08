import { db } from '$lib/db';
import { jkaiIterations } from '$lib/db/schema';
import { eq, and, gte } from 'drizzle-orm';
import type { BudgetConfig, BudgetCheckResult } from './types';
import type { JkaiBuild } from '$lib/db/schema';

export async function checkBudget(build: JkaiBuild): Promise<BudgetCheckResult> {
  const config = build.budgetConfig as BudgetConfig;

  if (config.maxIterations && build.iterationsCompleted >= config.maxIterations) {
    return { canProceed: false, shouldComplete: true, reason: `Reached max iterations (${config.maxIterations})` };
  }

  if (config.maxTotalMinutes && build.activeMinutesUsed >= config.maxTotalMinutes) {
    return { canProceed: false, shouldComplete: true, reason: `Reached total time cap (${config.maxTotalMinutes}m)` };
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
      const sleepMs = oldestInWindow
        ? oldestInWindow + 60 * 60 * 1000 - Date.now()
        : 60 * 1000;
      return {
        canProceed: false,
        sleepMs: Math.min(Math.max(sleepMs, 1000), 5 * 60 * 1000), // Cap at 5 minutes, re-check after
        reason: `Active minutes limit reached (${minutesInWindow.toFixed(1)}/${config.activeMinutesPerHour}m). Cooling down.`,
      };
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
      const sleepMs = oldestInWindow
        ? oldestInWindow + 60 * 60 * 1000 - Date.now()
        : 60 * 1000;
      return {
        canProceed: false,
        sleepMs: Math.min(Math.max(sleepMs, 1000), 5 * 60 * 1000), // Cap at 5 minutes, re-check after
        reason: `Token limit reached (${tokensInWindow}/${config.maxTokensPerHour}). Cooling down.`,
      };
    }
  }

  return { canProceed: true };
}
