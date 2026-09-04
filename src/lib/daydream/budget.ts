// src/lib/daydream/budget.ts
//
// How much of the Codex subscription daydreaming is allowed to spend, and how
// hard it should be working right now.
//
// Two caps, both set by the owner (2026-08-26):
//
//   • no more than 10% of the WEEKLY allowance in any one day
//   • no more than 50% of the current 5-HOUR window
//
// and a standing instruction to run CLOSE to those limits rather than far
// under them. So this module does two jobs: it refuses work that would breach a
// cap, and it tells the composer how deeply to work when there is headroom
// going spare.
//
// ── The thing to be clear about ──────────────────────────────────────────────
//
// Spare budget buys more THINKING, never more TALKING. Delivery rate limits
// live in deliver.ts and are not affected by any of this. A proactive assistant
// that fires thirty times a day gets muted forever, and "we had quota left" is
// not a reason to interrupt someone. What extra budget actually buys:
// verification passes that drop candidates whose evidence does not check out,
// scoring more candidates so the best one is chosen rather than the first one
// over the line, and phrasing thoughts that will only ever appear on the page.
// All of that raises precision. None of it raises volume.
//
// ── How spend is attributed ──────────────────────────────────────────────────
//
// The subscription has no token meter — it has rate-limit WINDOWS, and
// `getCodexUsage()` reports each as a percentage consumed. So daydreaming's own
// share is measured as the DELTA in that percentage across its own calls,
// recorded on the heartbeat pulse for the run.
//
// That delta is contaminated when the owner is using Codex at the same time:
// their usage lands inside our measurement window and is attributed to us. That
// is deliberate. Over-attribution makes daydreaming back off EARLIER than it
// strictly needs to, which is the safe direction to be wrong in — the opposite
// error would have a background job quietly eating a quota the owner is trying
// to use.

import { and, eq, gte, inArray } from 'drizzle-orm';
import { db } from '$lib/db';
import { heartbeatActions, heartbeatPulses } from '$lib/db/schema';
import { LOCAL_TZ } from './types';

/** Owner's caps. Percentage POINTS of each window, not of what remains. */
export const DAILY_WEEKLY_CAP_PCT = 10;
export const FIVE_HOUR_CAP_PCT = 50;

/** Window lengths as ChatGPT reports them. */
export const FIVE_HOUR_SECONDS = 18_000;
export const WEEKLY_SECONDS = 604_800;

/**
 * Every daydream action that can spend, and therefore whose pulses carry a
 * spend record.
 *
 * A list rather than a single name because the composer is not the only LLM
 * consumer. If the caps only summed the composer's pulses, every other
 * extractor and proposer would spend the same subscription outside them — an
 * enforced-looking cap that enforces half of the spend. EVERY activity that
 * calls a model must be here AND write its quota delta to `details.quota`;
 * daydream-hypothesise and daydream-spend were missing until 2026-08-27 and
 * their spend was invisible to the caps.
 */
export const SPENDING_ACTIONS = [
  'daydream-compose',
  // The appetite scan: one completion a day over the capability pack. Cheap
  // next to the reviewer, and in this list from the day it shipped rather than
  // three weeks later — that omission has already happened twice.
  'daydream-appetite',
  'daydream-offers',
  'daydream-rulesmith',
  'daydream-hypothesise',
  'daydream-spend',
  'daydream-ponder',
  'daydream-weekly',
  // The reviewer is xhigh reasoning with a tool loop, on every thought — the
  // most expensive thing on this list by some distance. Omitting an action here
  // has happened twice before (hypothesise and spend both ran outside the caps
  // until 2026-08-27) and the symptom is silence: the quota drains and nothing
  // reports why.
  'daydream-review',
] as const;

/** @deprecated kept so an older pulse reader still resolves. */
export const COMPOSE_ACTION = 'daydream-compose';

/**
 * Hours the owner is plausibly awake, used to pace the daily allowance.
 *
 * Pacing against the full 24 hours would leave most of the budget unspent by
 * bedtime and then burn it overnight, which is both useless and the opposite of
 * what "close to the limit" is asking for.
 */
export const ACTIVE_HOURS = { start: 7, end: 23 };

export type Depth = 'minimal' | 'standard' | 'deep';

export interface DepthPlan {
  depth: Depth;
  /** How many candidates may be composed this run. */
  maxCandidates: number;
  /** Whether to run a second call that checks the phrasing against the
   *  evidence and drops it if it does not hold up. */
  verify: boolean;
  /** Whether to compose thoughts that will only ever reach the page. */
  composeSilent: boolean;
}

export const DEPTH_PLANS: Record<Depth, DepthPlan> = {
  minimal: { depth: 'minimal', maxCandidates: 1, verify: false, composeSilent: false },
  standard: { depth: 'standard', maxCandidates: 2, verify: true, composeSilent: false },
  deep: { depth: 'deep', maxCandidates: 3, verify: true, composeSilent: true },
};

export interface QuotaSpend {
  weeklyPct: number;
  fiveHourPct: number;
}

export const ZERO_SPEND: QuotaSpend = { weeklyPct: 0, fiveHourPct: 0 };

export interface BudgetStatus {
  /** False when the resolved model is not a Codex one — there is no
   *  subscription window to protect and these caps do not apply. */
  applies: boolean;
  /** Null when the usage endpoint could not be read. */
  reachable: boolean;
  spentTodayWeeklyPct: number;
  spentThisWindowPct: number;
  dailyCapPct: number;
  fiveHourCapPct: number;
  remainingTodayPct: number;
  remainingWindowPct: number;
  /** Where the day's burn SHOULD be by now if it is to finish near the cap. */
  pacedTargetPct: number;
  /** True when a cap is already reached and nothing may run. */
  blocked: boolean;
  blockedReason: string | null;
  plan: DepthPlan;
}

/** Local hour, for pacing against the owner's day rather than UTC's. */
export function localHourOf(now: Date, tz = LOCAL_TZ): number {
  const hh = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    hour12: false,
  }).format(now);
  return Number(hh) % 24;
}

/** The instant the owner's local day began. Never `setUTCHours(0)` — under BST
 *  that is an hour into the previous day. */
export function localDayStart(now: Date, tz = LOCAL_TZ): Date {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const num = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const secs = (num('hour') % 24) * 3600 + num('minute') * 60 + num('second');
  return new Date(now.getTime() - secs * 1000);
}

/**
 * How far through the paced day we are, 0..1.
 *
 * Before the active window opens this is 0, after it closes it is 1, so the
 * whole allowance is notionally available by the end of the evening and none of
 * it is expected to be spent at 4am.
 */
export function dayProgress(now: Date, hours = ACTIVE_HOURS): number {
  const h = localHourOf(now);
  if (h < hours.start) return 0;
  if (h >= hours.end) return 1;
  return (h - hours.start) / (hours.end - hours.start);
}

/**
 * What daydreaming has already spent, summed off its own heartbeat pulses.
 *
 * The pulse ledger is used rather than a table of its own: it is already
 * durable, already indexed on (action, ts), already pruned, and it keeps the
 * spend attached to the run that incurred it, which is what makes it auditable
 * at all.
 */
export async function spentSince(since: Date): Promise<QuotaSpend> {
  const rows = await db
    .select({ details: heartbeatPulses.details })
    .from(heartbeatPulses)
    .innerJoin(heartbeatActions, eq(heartbeatActions.id, heartbeatPulses.actionId))
    .where(and(inArray(heartbeatActions.name, [...SPENDING_ACTIONS]), gte(heartbeatPulses.ts, since)));

  let weeklyPct = 0;
  let fiveHourPct = 0;
  for (const r of rows) {
    const q = (r.details as { quota?: Partial<QuotaSpend> } | null)?.quota;
    if (!q) continue;
    if (typeof q.weeklyPct === 'number' && Number.isFinite(q.weeklyPct)) weeklyPct += q.weeklyPct;
    if (typeof q.fiveHourPct === 'number' && Number.isFinite(q.fiveHourPct)) {
      fiveHourPct += q.fiveHourPct;
    }
  }
  return { weeklyPct, fiveHourPct };
}

/** Pull the two windows out of whatever the usage endpoint reported. */
export function pickWindows(windows: Array<{ usedPercent: number; windowSeconds: number; resetAt: number | null }>) {
  const near = (target: number) =>
    windows.find((w) => Math.abs(w.windowSeconds - target) < target * 0.2) ?? null;
  return { fiveHour: near(FIVE_HOUR_SECONDS), weekly: near(WEEKLY_SECONDS) };
}

/**
 * When did the current 5-hour window start?
 *
 * Derived from the window's own `resetAt` where it reports one; otherwise
 * assumed to have started 5 hours ago, which over-counts our spend (it may
 * sweep in a previous window's) and so errs toward backing off.
 */
export function windowStart(resetAt: number | null, now: Date): Date {
  if (resetAt && Number.isFinite(resetAt) && resetAt > now.getTime()) {
    return new Date(resetAt - FIVE_HOUR_SECONDS * 1000);
  }
  return new Date(now.getTime() - FIVE_HOUR_SECONDS * 1000);
}

/**
 * Choose how hard to work.
 *
 * Behind the paced target → go deeper, because the allowance is there to be
 * used and unspent quota buys nothing. At or past it → minimal. Past a cap →
 * blocked entirely.
 */
export function planDepth(
  remainingTodayPct: number,
  remainingWindowPct: number,
  spentTodayPct: number,
  pacedTargetPct: number,
): DepthPlan {
  // Never start work that could not finish inside what is left.
  if (remainingTodayPct <= 0.15 || remainingWindowPct <= 0.15) return DEPTH_PLANS.minimal;

  const behind = pacedTargetPct - spentTodayPct;
  if (behind > pacedTargetPct * 0.5 && remainingTodayPct > 2) return DEPTH_PLANS.deep;
  if (behind > 0 && remainingTodayPct > 1) return DEPTH_PLANS.standard;
  return DEPTH_PLANS.minimal;
}

/**
 * The whole picture, ready for the composer and for the ledger page.
 *
 * `applies: false` when the daydream workload resolves to a non-Codex model —
 * there is no subscription window to protect, the spend is cash instead, and
 * these particular caps would be measuring nothing.
 */
export async function budgetStatus(opts: {
  now?: Date;
  isCodexModel: boolean;
}): Promise<BudgetStatus> {
  const now = opts.now ?? new Date();
  const base = {
    dailyCapPct: DAILY_WEEKLY_CAP_PCT,
    fiveHourCapPct: FIVE_HOUR_CAP_PCT,
    spentTodayWeeklyPct: 0,
    spentThisWindowPct: 0,
    remainingTodayPct: DAILY_WEEKLY_CAP_PCT,
    remainingWindowPct: FIVE_HOUR_CAP_PCT,
    pacedTargetPct: 0,
  };

  if (!opts.isCodexModel) {
    return {
      ...base,
      applies: false,
      reachable: false,
      blocked: false,
      blockedReason: null,
      plan: DEPTH_PLANS.standard,
    };
  }

  const { getCodexUsage } = await import('$lib/server/models/codex-usage');
  const usage = await getCodexUsage();

  if (!usage) {
    // Cannot see the meter. Work at minimum depth rather than stopping: the
    // caps exist to protect a shared quota, and refusing to run at all because
    // a status endpoint blipped would make an unreachable page into an outage.
    return {
      ...base,
      applies: true,
      reachable: false,
      blocked: false,
      blockedReason: null,
      plan: DEPTH_PLANS.minimal,
    };
  }

  const { fiveHour, weekly } = pickWindows(usage.windows);

  const [today, thisWindow] = await Promise.all([
    spentSince(localDayStart(now)),
    spentSince(windowStart(fiveHour?.resetAt ?? null, now)),
  ]);

  const remainingTodayPct = Math.max(0, DAILY_WEEKLY_CAP_PCT - today.weeklyPct);
  const remainingWindowPct = Math.max(0, FIVE_HOUR_CAP_PCT - thisWindow.fiveHourPct);
  const pacedTargetPct = DAILY_WEEKLY_CAP_PCT * dayProgress(now);

  let blockedReason: string | null = null;
  if (usage.limitReached) {
    blockedReason = 'the subscription window is exhausted';
  } else if (remainingTodayPct <= 0) {
    blockedReason = `daily cap reached (${DAILY_WEEKLY_CAP_PCT}% of the weekly allowance)`;
  } else if (remainingWindowPct <= 0) {
    blockedReason = `5-hour cap reached (${FIVE_HOUR_CAP_PCT}% of this window)`;
  } else if (weekly && weekly.usedPercent >= 98) {
    // Nothing to do with our share — the account itself is nearly out, and a
    // background job should be the first thing to stand down, not the last.
    blockedReason = 'the weekly subscription allowance is nearly gone';
  }

  return {
    applies: true,
    reachable: true,
    spentTodayWeeklyPct: round3(today.weeklyPct),
    spentThisWindowPct: round3(thisWindow.fiveHourPct),
    dailyCapPct: DAILY_WEEKLY_CAP_PCT,
    fiveHourCapPct: FIVE_HOUR_CAP_PCT,
    remainingTodayPct: round3(remainingTodayPct),
    remainingWindowPct: round3(remainingWindowPct),
    pacedTargetPct: round3(pacedTargetPct),
    blocked: blockedReason != null,
    blockedReason,
    plan: blockedReason
      ? DEPTH_PLANS.minimal
      : planDepth(remainingTodayPct, remainingWindowPct, today.weeklyPct, pacedTargetPct),
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Read the two windows now, so a caller can diff them after its work and
 * attribute the difference to itself.
 */
export async function readQuotaMark(): Promise<{ weeklyPct: number; fiveHourPct: number } | null> {
  const { getCodexUsage, clearCodexUsageCache } = await import('$lib/server/models/codex-usage');
  // The module caches for 60s, which is longer than a compose run — without
  // clearing it the "after" read would return the "before" value and every
  // delta would be zero, i.e. an unenforced cap that looked enforced.
  clearCodexUsageCache();
  const usage = await getCodexUsage();
  if (!usage) return null;
  const { fiveHour, weekly } = pickWindows(usage.windows);
  return {
    weeklyPct: weekly?.usedPercent ?? 0,
    fiveHourPct: fiveHour?.usedPercent ?? 0,
  };
}

/**
 * What a run consumed, from a before/after pair.
 *
 * A negative delta means the window rolled over mid-run; that is not a refund,
 * so it clamps to zero. An implausibly large delta is far more likely to be the
 * owner's own concurrent usage than ours, but it is still clamped INTO our
 * ledger rather than discarded — see the note at the top about erring toward
 * backing off.
 */
export function attributeSpend(
  before: { weeklyPct: number; fiveHourPct: number } | null,
  after: { weeklyPct: number; fiveHourPct: number } | null,
): QuotaSpend {
  if (!before || !after) return { ...ZERO_SPEND };
  return {
    weeklyPct: Math.max(0, round3(after.weeklyPct - before.weeklyPct)),
    fiveHourPct: Math.max(0, round3(after.fiveHourPct - before.fiveHourPct)),
  };
}
