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

  /**
   * C (owner) — overnight vitals, the Watch beside the WHOOP strap. Each device
   * is judged only against its own baseline and the two are never averaged;
   * temperature is a deviation from each device's own baseline. Null when
   * neither device has a reading. Added 2026-10-04; older servers omit it.
   */
  vitals?: {
    /** One sentence on how to read the pairs, for under the section title. */
    note: string;
    /**
     * The whole section in a few words, about seventeen characters, for a
     * small surface such as the iPhone's Sleep analytics tile: "Devices agree",
     * "SpO₂ apart".
     * Optional: servers before 2026-10-05 omit it.
     */
    headline?: string;
    /** One pair, Watch then WHOOP — the one apart, else resting HR: "RHR 47 · 46 bpm". */
    brief?: string | null;
    /** 'watch' when any reading is apart. */
    tone?: HubTone;
    rows: Array<{
      key: 'rhr' | 'breathing' | 'spo2' | 'temperature';
      label: string;
      /** Whose reading single-number surfaces take; null where they never substitute. */
      primary: 'apple' | 'whoop' | null;
      apple: VitalReading | null;
      whoop: VitalReading | null;
      /** "Usually level ± 2 bpm over 28 nights" — null until 14 paired nights. */
      agreement: string | null;
      /** Set when last night sits outside the usual gap. */
      disagree: string | null;
      tone: HubTone;
    }>;
  } | null;

  /** C (owner) — the night's sleep, WHOOP beside the Watch. See `SleepDigest`. */
  sleep?: SleepDigest | null;
}

/**
 * The night's sleep for the iPhone's Sleep analytics (owner): WHOOP's last
 * staged night beside the Watch's, and the week of nights from both. Added
 * 2026-10-05; older servers omit it.
 */
export interface SleepDigest {
  lastNight: {
    /** YYYY-MM-DD, the day the night ended on. */
    date: string;
    /** WHOOP asleep (deep + light + REM): "7h12m". */
    asleep: string;
    /** WHOOP sleep performance, 0–100. */
    score: number | null;
    stages: Array<{ key: 'deep' | 'rem' | 'light' | 'awake'; label: string; minutes: number; display: string }>;
    /** "9 disturbances", "5 sleep cycles", "40m the strap could not read". */
    detail: string[];
    /** The Watch's asleep (deep + core + REM) for the same night, when it staged one. */
    watch: string | null;
  } | null;
  /** Up to seven nights, oldest → newest, hours asleep by each device. */
  nights: Array<{ date: string; whoop: number | null; watch: number | null; score: number | null }>;
  /** How to read the two devices' totals together. */
  note: string;
}

/** One device's overnight reading, as `HubDigest.vitals` carries it. */
export interface VitalReading {
  /** "52" — or "+0.31" for temperature, a deviation from the device's own baseline. */
  display: string;
  unit: string | null;
  /** "vs 51 baseline", "vs its own baseline", "first readings". */
  baseline: string;
  /** YYYY-MM-DD when the reading is older than yesterday; null when fresh. */
  asOf: string | null;
  /** Up to 28 nights, oldest → newest, on the same scale as `display`. */
  series: number[];
}
