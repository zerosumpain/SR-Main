/**
 * Which balance the /jkai header is talking about.
 *
 * Two providers pay for a turn and they are not commensurable: OpenRouter sells
 * credit in dollars, the ChatGPT subscription sells rate-limit windows. Showing
 * the dollar figure while a Codex model is answering is worse than showing
 * nothing — it says "£4.12 left" about money the turn will not spend, while the
 * thing that WILL stop the turn (a weekly window) goes unmentioned.
 *
 * So the header shows one meter, chosen by the model actually driving the
 * active thread. Everything here is pure and client-safe so the strip, the
 * header pill and the tests all decide it the same way.
 */

/** Serialisable view of $lib/server/models/codex-usage's CodexUsage, as it
 *  crosses the load boundary. */
export interface CodexUsageView {
  planType: string | null;
  windows: Array<{ usedPercent: number; windowSeconds: number; resetAt: number | null }>;
  headline: { usedPercent: number; windowSeconds: number; resetAt: number | null } | null;
  limitReached: boolean;
  creditBalanceUsd: number | null;
  fetchedAt: number;
}

/**
 * True when this model bills to a subscription rather than to metered credit.
 *
 * The `codex/` prefix is the only signal — provider is deliberately recoverable
 * from the id alone, because persisted rows, localStorage and node configs all
 * store a bare string in places. $lib/server/models/codex-catalogue's
 * `isCodexModelId` defers to this so the rule has one home that client code can
 * also import; `$lib/server/*` cannot cross to the browser.
 */
export function isSubscriptionModelId(modelId: string | null | undefined): boolean {
  return typeof modelId === 'string' && modelId.startsWith('codex/');
}

const HOUR = 3600;

/** `5H`, `WEEKLY`, `DAILY` — how the window is worth naming in a mono strip. */
export function formatWindowLabel(windowSeconds: number): string {
  if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) return 'LIMIT';
  if (windowSeconds >= 7 * 24 * HOUR) return 'WEEKLY';
  if (windowSeconds >= 24 * HOUR) return 'DAILY';
  // Branch on the raw value, not the rounded one — a 30-minute window rounds up
  // to "1H" and would claim an hour of headroom it does not have.
  if (windowSeconds >= HOUR) return `${Math.round(windowSeconds / HOUR)}H`;
  return `${Math.round(windowSeconds / 60)}M`;
}

/** How long until the window rolls over: `6d`, `4h`, `25m`, or `now`. */
export function formatResetIn(resetAt: number | null, now: number): string | null {
  if (resetAt === null) return null;
  const ms = resetAt - now;
  if (ms <= 0) return 'now';
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export interface CodexMeter {
  /** 0–100, how much of the tightest window is gone. */
  usedPercent: number;
  /** How much is LEFT — the number the strip leads with, to read the same way
   *  round as the OpenRouter balance beside it. */
  remainingPercent: number;
  /** `WEEKLY`, `5H`. */
  windowLabel: string;
  /** `6d`, or null when the reset time wasn't reported. */
  resetIn: string | null;
  /** Calls are being refused right now. */
  limitReached: boolean;
  /** Full hover text: every window, the plan, any top-up credit, and staleness. */
  title: string;
}

/**
 * Every Codex meter worth rendering, headline first.
 *
 * The header shows one window at a time but the account reports several (a 5-
 * hour window and a weekly one, typically), and which one matters depends on
 * what you are asking: the 5h window is what stops the next turn, the weekly is
 * what stops the afternoon. So the strip cycles through this list on click
 * rather than picking one for you — `codexMeter` below is just its first entry.
 *
 * Empty covers three cases that all mean the same thing to the caller: the
 * active model isn't a subscription model, there is no Codex login on this host
 * (so nothing to report), or the account reported no windows at all.
 */
export function codexMeters(
  usage: CodexUsageView | null | undefined,
  modelId: string | null | undefined,
  now: number,
): CodexMeter[] {
  if (!isSubscriptionModelId(modelId)) return [];
  if (!usage || !usage.headline) return [];

  const headline = usage.headline;
  const parts: string[] = [];
  const plan = usage.planType ? `ChatGPT ${usage.planType}` : 'ChatGPT subscription';
  parts.push(
    usage.limitReached
      ? `${plan} — limit reached`
      : `${plan} — ${Math.round(100 - headline.usedPercent)}% of the ${formatWindowLabel(
          headline.windowSeconds,
        ).toLowerCase()} window left`,
  );
  for (const w of usage.windows) {
    const reset = formatResetIn(w.resetAt, now);
    parts.push(
      `${formatWindowLabel(w.windowSeconds)}: ${Math.round(w.usedPercent)}% used${
        reset ? ` · resets in ${reset}` : ''
      }`,
    );
  }
  if (usage.creditBalanceUsd !== null) {
    parts.push(`Top-up credit $${usage.creditBalanceUsd.toFixed(2)}`);
  }
  // Stale readings are carried forward on a failed refresh, so say how old.
  const ageMin = Math.floor((now - usage.fetchedAt) / 60_000);
  if (ageMin >= 2) parts.push(`as of ${ageMin}m ago`);
  const title = `${parts.join(' · ')} · click to switch window`;

  // Dedupe by window LENGTH, not object identity: `headline` and its twin in
  // `windows` are the same window, but they do not survive the load boundary as
  // the same object on every serialisation path.
  const rest = usage.windows
    .filter((w) => w.windowSeconds !== headline.windowSeconds)
    .sort((a, b) => a.windowSeconds - b.windowSeconds);

  return [headline, ...rest].map((w, i) => ({
    usedPercent: w.usedPercent,
    remainingPercent: Math.max(0, Math.min(100, 100 - w.usedPercent)),
    windowLabel: formatWindowLabel(w.windowSeconds),
    resetIn: formatResetIn(w.resetAt, now),
    // The account-level flag belongs to the window that tripped it, which is
    // the headline by definition. A wider window only reads as exhausted when
    // its own figure says so.
    limitReached: i === 0 ? usage.limitReached : usage.limitReached && w.usedPercent >= 99.5,
    title,
  }));
}

/**
 * The Codex meter to render, or null when the header should keep showing the
 * OpenRouter balance. The tightest window — the one nearest its ceiling.
 */
export function codexMeter(
  usage: CodexUsageView | null | undefined,
  modelId: string | null | undefined,
  now: number,
): CodexMeter | null {
  return codexMeters(usage, modelId, now)[0] ?? null;
}
