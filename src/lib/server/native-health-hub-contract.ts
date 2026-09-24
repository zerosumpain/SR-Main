// Copied from SR-Health src/lib/health/hub-contract.ts — the contract, not an import:
// the two apps share no code, and a copy that drifts fails the phone's decode loudly.
/**
 * /health's summary intelligence, digested for the iPhone. The contract between
 * SR-Health (`GET /api/health/hub`, owner-only) and SR-Main's device lane
 * (`GET /api/native/health/hub`), which passes it through unchanged.
 *
 * Display strings are decided HERE, by the code that owns the numbers, so the
 * phone renders and never re-derives: it cannot know that a falling RHR is good
 * and a falling HRV is not, and it should not have to.
 *
 * Every section is independently nullable / empty: one service failing costs
 * its own section, as on the page.
 */
export type HubTone = 'good' | 'watch' | 'bad' | 'none';

export interface HubDigest {
  generatedAt: string;
  syncedAgoSeconds: number;
  /** The whole series is the demo fallback; the phone must say so. */
  isMock: boolean;

  /** A — "The one-line read" (todayLede). */
  lede: string | null;
  /** A — readiness dial with its four weighted factors (0–100 each). */
  readiness: {
    score: number;
    label: string;
    recommendation: string;
    factors: Array<{ key: string; label: string; score: number; weight: number }>;
  } | null;
  /** A — "What the planner would commission". */
  planner: { headline: string; detail: string | null } | null;
  /** A — the six tiles, in page order, footnote as rendered on the page. */
  tiles: Array<{
    key: string;
    label: string;
    display: string;
    unit: string | null;
    foot: string | null;
    tone: HubTone;
    /** Oldest → newest, for a sparkline. Empty when there is none. */
    series: number[];
  }>;

  /** B — the eight instruments, in page order. */
  instruments: Array<{
    key: string;
    label: string;
    /** "28d", "7 nights" … */
    window: string;
    display: string;
    unit: string | null;
    tone: HubTone;
    /** One short line: what the number is ("0.94 · in the sweet spot"). */
    reading: string;
    /** One sentence: why it matters / what it means now. */
    meaning: string;
  }>;

  /** C — four projections. `history` then `cone` share one date axis. */
  forecasts: Array<{
    key: string;
    label: string;
    unit: string | null;
    horizonDays: number;
    now: number | null;
    projected: number | null;
    low: number | null;
    high: number | null;
    /** One line, as the page states the projection. */
    reading: string;
    history: Array<{ date: string; value: number }>;
    cone: Array<{ date: string; value: number; low: number; high: number }>;
  }>;

  /** D — ranked moves, best first. */
  moves: Array<{ rank: number; title: string; buys: string; costs: string; leverage: string }>;

  /** E — every tripwire row, page order. */
  tripwires: Array<{
    key: string;
    state: 'tripped' | 'close' | 'clear' | 'noread';
    signal: string;
    window: string;
    trigger: string;
    now: string;
    meaning: string;
  }>;

  /** F — segment form counts, and the gettable board (owner). */
  segments: {
    improving: number;
    holding: number;
    slipping: number;
    noRead: number;
    gettable: Array<{ name: string; gapPct: number; detail: string | null }>;
  } | null;

  /** G — today's proposed session (owner). Route cards are not carried. */
  plan: {
    sport: string;
    headline: string;
    why: string[];
    evidence: Array<{ label: string; display: string }>;
  } | null;

  /** H — experiments, live first. */
  experiments: Array<{
    status: 'live' | 'queued';
    title: string;
    change: string;
    hold: string;
    measure: string;
    stop: string;
    counter: string | null;
  }>;

  /** I — the verdict. `headline` is an ARRAY OF LINES, as on the page. */
  verdict: { headline: string[]; body: string[]; quote: string | null; reviewOn: string | null } | null;
}
