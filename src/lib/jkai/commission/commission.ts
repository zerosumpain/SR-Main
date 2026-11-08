/**
 * The rules for commissioning a build, apart from the database. PURE.
 *
 * `commissionBuild` (commission.server.ts) is the one entry point into
 * /jkai/develop from chat; this file is everything it decides without I/O, so
 * the refusals, the quote card and "is this still live" are tested directly
 * and read the same in the tool, the state provider and the quote.
 *
 * Overhaul plan 2026-10-28, point 5 and slice 6b. Not doing, on purpose:
 * production releases from chat, any target but SR-Main (decision 7), or
 * commissioning from WhatsApp, heartbeat, the bridge, Siri, Watch or a phone
 * without proof of presence.
 */
import type { CommissionSource, DeliveryState, ReleasePolicy } from '$lib/constants/development';
import type { ToolPrincipal } from '$lib/tools/invoke-contract';
import { criterionResult } from '../development';

/** Mirrors the prototype ceiling (`PROTOTYPE_QUOTA_CEILING`): above it, no new build. */
export const COMMISSION_QUOTA_CEILING = { fiveHourPct: 80, weeklyPct: 90 } as const;

/** Commissioned deliveries still spending at once, the nightly lane aside. */
export const MAX_LIVE_COMMISSIONS = 2;

/** Where a chat commission may stop. 'production' stays on the web form. */
export const CHAT_RELEASE_POLICIES = ['preview_only', 'pull_request'] as const satisfies readonly ReleasePolicy[];

/** The repositories the builder may target from chat (decision 7: SR-Main only). */
export const COMMISSION_TARGETS = ['sr-main'] as const;
export type CommissionTarget = (typeof COMMISSION_TARGETS)[number];

/** An operationKey a caller may supply: short, printable, no spaces. */
export const OPERATION_KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,200}$/;

const STOP_WORDS: Record<ReleasePolicy, string> = {
  preview_only: 'Preview only',
  pull_request: 'Draft pull request',
  production: 'Ship to production',
};

/**
 * Why this commission may not go ahead, or null. Checked before anything is
 * read or written.
 */
export function commissionRefusal(input: {
  source: CommissionSource;
  principal: ToolPrincipal | undefined;
  releasePolicy: ReleasePolicy;
  target: string;
}): string | null {
  const { source, principal, releasePolicy, target } = input;
  if (source !== 'selfimprove') {
    if (!principal || principal.principalId !== 'owner' || !principal.attended) {
      const via = principal?.via;
      const where = via === 'whatsapp' ? 'WhatsApp' : via === 'heartbeat' ? 'a background check-in' : via === 'bridge' ? 'a build' : via === 'device' ? 'the phone' : 'an unattended call';
      return `Not from ${where}: commission a build from /jkai in a browser, where you can confirm it.`;
    }
    // Belt and braces with `principalRefusal`: a chat commission is a browser
    // session, never a paired phone (no proof of presence yet).
    if (source === 'chat' && principal.via !== 'session') {
      return 'Not from the phone yet: commission a build from /jkai in a browser, where you can confirm it.';
    }
  }
  if (releasePolicy === 'production' && source !== 'web') {
    return 'Shipping straight to production is only on the New feature form at /jkai/develop. From chat a build stops at a preview or a draft pull request.';
  }
  if (!(COMMISSION_TARGETS as readonly string[]).includes(target)) {
    return `${target} isn't buildable here yet; the builder targets SR-Main only for now.`;
  }
  return null;
}

/** The plain refusal when the ChatGPT window is too full, or null. */
export function quotaRefusal(mark: { fiveHourPct: number; weeklyPct: number } | null): string | null {
  if (!mark) return null;
  if (mark.fiveHourPct >= COMMISSION_QUOTA_CEILING.fiveHourPct) {
    return `The ChatGPT window is ${Math.round(mark.fiveHourPct)}% used, so I won't start a build now. Try after it resets.`;
  }
  if (mark.weeklyPct >= COMMISSION_QUOTA_CEILING.weeklyPct) {
    return `The ChatGPT week is ${Math.round(mark.weeklyPct)}% used, so I won't start a build now. Try after it resets.`;
  }
  return null;
}

/** The live-commission cap, said plainly, or null. */
export function liveCapRefusal(live: number): string | null {
  return live >= MAX_LIVE_COMMISSIONS
    ? `${live} commissioned builds are already running, which is the most at once. Finish or stop one at /jkai/develop first.`
    : null;
}

/**
 * Whether a delivery has settled for the purposes of watching it: a pull
 * request is open, it shipped, it is parked on the owner, its autopilot gave
 * up, or he stopped it. The 'delivery' state provider stops its watcher here,
 * and the live-commission cap counts everything that has not.
 */
export function deliveryTerminal(state: Pick<DeliveryState, 'stage' | 'release' | 'autopilot'>, buildOutcome: string | null | undefined): boolean {
  return (
    state.stage === 'pr_open' ||
    state.stage === 'deployed' ||
    Boolean(state.release?.awaitingOwner) ||
    Boolean(state.autopilot?.stopReason) ||
    buildOutcome === 'stopped_by_user'
  );
}

/** "ChatGPT 34% of the 5-hour window, 12% of the week". */
export function quotaLine(mark: { fiveHourPct: number; weeklyPct: number } | null): string {
  if (!mark) return 'ChatGPT quota could not be read just now';
  return `ChatGPT ${Math.round(mark.fiveHourPct)}% of the 5-hour window, ${Math.round(mark.weeklyPct)}% of the week`;
}

/** "up to 25 rounds, 2 hours, $2" from the delivery budget. */
export function budgetLine(budget: { maxIterations: number; maxTotalMinutes: number; maxCostUsd: number }): string {
  const hours = budget.maxTotalMinutes / 60;
  const time = Number.isInteger(hours) ? `${hours} hour${hours === 1 ? '' : 's'}` : `${budget.maxTotalMinutes} minutes`;
  return `up to ${budget.maxIterations} rounds, ${time}, $${budget.maxCostUsd}`;
}

export interface CommissionQuoteFacts {
  outcome?: string;
  criteria?: readonly string[];
  /** Absent reads as on, which is what `develop_commission` defaults to. */
  autopilot?: boolean;
  releasePolicy: ReleasePolicy;
  budget: { maxIterations: number; maxTotalMinutes: number; maxCostUsd: number };
  mark: { fiveHourPct: number; weeklyPct: number } | null;
  live: number;
}

/** Where the full brief is read once it is commissioned, and every delivery before. */
export const COMMISSION_BRIEF_HREF = '/jkai/develop';

/**
 * A digest of the WHOLE brief, so a card never stands for less than it says:
 * the first line alone is 160 characters of a brief that can run to 20,000.
 * Its length, how much is beyond the headline, the criteria count, autopilot,
 * and a short fingerprint of the exact text.
 */
export function briefDigest(f: Pick<CommissionQuoteFacts, 'outcome' | 'criteria' | 'autopilot'>): string {
  const outcome = (f.outcome ?? '').trim();
  const criteria = (f.criteria ?? []).filter((c) => c.trim());
  const firstLine = outcome.split('\n')[0];
  const more = outcome.length - Math.min(firstLine.length, 160);
  const parts = [
    `${outcome.length.toLocaleString('en-GB')} characters${more > 0 ? ` (${more.toLocaleString('en-GB')} beyond the headline)` : ''}`,
    `${criteria.length} acceptance ${criteria.length === 1 ? 'criterion' : 'criteria'}`,
    f.autopilot === false ? 'autopilot off: the brief waits for you' : 'autopilot on: grooms and builds unattended',
  ];
  if (outcome) parts.push(`brief ${fingerprint(`${outcome}\n${criteria.join('\n')}`)}`);
  return parts.join(' · ');
}

/** 8 hex characters of FNV-1a: a fingerprint to compare, not a security hash. PURE, no node:crypto. */
function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * The confirmation card, phrased as a decision (what, a digest of the whole
 * brief and where to read it, where it stops, what it may spend, the quota
 * now), plus the refusal when there is one so the card is never shown for
 * something that would then be refused.
 */
export function quoteCard(f: CommissionQuoteFacts): { lines: string[]; card: string; refusal: string | null } {
  const what = (f.outcome ?? '').trim().split('\n')[0].slice(0, 160);
  const lines = [
    what ? `Commission a build on SR-Main: ${what}` : 'Commission a build on SR-Main',
    `Brief: ${briefDigest(f)} — read in full at ${COMMISSION_BRIEF_HREF}`,
    `Stops at: ${STOP_WORDS[f.releasePolicy]}`,
    `Spend: ${budgetLine(f.budget)}`,
    `Quota now: ${quotaLine(f.mark)}`,
  ];
  const refusal = quotaRefusal(f.mark) ?? liveCapRefusal(f.live);
  return { lines, card: lines.join('\n'), refusal };
}

/**
 * Whether a commissioned delivery counts toward `MAX_LIVE_COMMISSIONS`: its
 * autopilot is ON and has not stopped, and it has not settled. A brief left
 * with autopilot off waits for the owner and spends nothing, and one whose
 * autopilot gave up is not running, so neither holds a slot.
 */
export function countsAsLiveCommission(state: Pick<DeliveryState, 'stage' | 'release' | 'autopilot'>, buildOutcome: string | null | undefined): boolean {
  return state.autopilot?.enabled === true && !state.autopilot.stopReason && !deliveryTerminal(state, buildOutcome);
}

/** One word for a delivery's stage, as the thread reads it. */
export function stageWord(stage: DeliveryState['stage']): string {
  switch (stage) {
    case 'brief': return 'Brief';
    case 'queued': return 'Queued';
    case 'building': return 'Building';
    case 'needs_input': return 'Needs you';
    case 'review': return 'Review';
    case 'integrating': return 'Integrating';
    case 'accepted': return 'Accepted';
    case 'pr_open': return 'Pull request open';
    case 'deployed': return 'Shipped';
    default: return String(stage);
  }
}

export interface DeliveryFacts {
  stage: DeliveryState['stage'];
  stageWord: string;
  criteria: { met: number; total: number };
  previewUrl: string | null;
  prUrl: string | null;
  awaitingOwner: string | null;
  stopReason: string | null;
  terminal: boolean;
}

/**
 * What the thread, the status tool and the push say about a delivery. The
 * criteria count is the one acceptance reads (`criterionResult` on the current
 * candidate), so "3 of 5 met" never disagrees with the workspace page.
 */
export function deliveryFacts(state: DeliveryState, buildOutcome: string | null | undefined): DeliveryFacts {
  const met = state.criteria.filter((c) => criterionResult(c, state.candidate).verdict === 'passed').length;
  return {
    stage: state.stage,
    stageWord: stageWord(state.stage),
    criteria: { met, total: state.criteria.length },
    previewUrl: state.preview?.status === 'ready' ? state.preview.url : null,
    prUrl: state.release?.prUrl ?? null,
    awaitingOwner: state.release?.awaitingOwner ?? null,
    stopReason: state.autopilot?.stopReason ?? (buildOutcome === 'stopped_by_user' ? 'Stopped by you.' : null),
    terminal: deliveryTerminal(state, buildOutcome),
  };
}

/**
 * The one line a watcher posts. It changes only when the stage, the criteria
 * count, the preview, the pull request or a wait on the owner changes — never
 * on cost or time, which tick — so the heartbeat's "post only when new" rule
 * makes it a note per stage change.
 */
export function deliveryLine(f: DeliveryFacts): string {
  const parts = [f.stageWord];
  if (f.criteria.total) parts.push(`${f.criteria.met} of ${f.criteria.total} criteria met`);
  if (f.previewUrl) parts.push(`preview ${f.previewUrl}`);
  if (f.prUrl) parts.push(`pull request ${f.prUrl}`);
  if (f.awaitingOwner) parts.push(`waiting on you: ${f.awaitingOwner.slice(0, 120)}`);
  else if (f.stopReason) parts.push(`stopped: ${f.stopReason.slice(0, 120)}`);
  return parts.join(' · ');
}
