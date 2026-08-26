// src/lib/daydream/snapshot-types.ts
//
// The shape of what a detector gets to look at, and the shape of what it may
// return. Deliberately free of `$lib/db` and of any import that touches one, so
// every detector can be exercised against a hand-written snapshot with no
// database, no network and no clock. That property is not a convenience — it is
// the reason the detectors are rules rather than a prompt.

import type { MovementMode } from './types';

// ── What a detector sees ─────────────────────────────────────────────────────

export interface TrailPoint {
  id: number;
  ts: Date;
  source: string;
  lat: number | null;
  lon: number | null;
  mode: MovementMode;
  isHome: boolean | null;
  placeId: string | null;
  accuracyM: number | null;
}

export interface PlaceSummary {
  id: string;
  lat: number;
  lon: number;
  radiusM: number;
  label: string | null;
  kind: string;
  source: string;
  visitCount: number;
  medianDwellMins: number;
  dayHistogram: number[];
  hourHistogram: number[];
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  status: string;
}

export interface CalendarEvent {
  title: string;
  start: Date;
  end: Date | null;
  location: string | null;
}

/** A thing the owner has recently shown interest in, and where that came from. */
export interface InterestTerm {
  term: string;
  /** 'research' | 'intel' | 'email' */
  source: string;
  at: Date;
  /** The row this came from, so a thought can cite it. */
  refId: string;
}

/** Shipped in merge 5. Declared here so the two detectors that need it can be
 *  written now, and report honestly that their input does not exist yet. */
export interface Offer {
  id: string;
  merchant: string;
  summary: string;
  expiresAt: Date | null;
  /** Where it came from, for the evidence trail. */
  emailId: string;
}

export interface MemoryRow {
  id: string;
  category: string;
  content: string;
}

/** One gathered signal and whether it actually produced anything. Same shape
 *  and same purpose as the briefing engine's source rows: a snapshot that
 *  silently lacks a source produces detectors that are silently wrong. */
export interface SnapshotSource {
  key: string;
  status: 'ok' | 'failed' | 'empty' | 'unavailable';
  detail: string;
}

export interface DaydreamSnapshot {
  now: Date;
  /** Local calendar facts, precomputed once — a rhythm is a LOCAL fact, and
   *  recomputing the timezone per detector is how half of them end up in UTC. */
  localDate: string;
  localDay: number; // 0 = Monday
  localHour: number;
  isWeekday: boolean;

  /** The newest positioned fix, or null when the trail has none. */
  current: {
    ts: Date;
    lat: number;
    lon: number;
    mode: MovementMode;
    isHome: boolean | null;
    placeId: string | null;
    accuracyM: number | null;
    ageMins: number;
  } | null;

  /** Recent trail, oldest first. Includes gap rows — a detector that filters
   *  them out has thrown away the evidence that it does not know something. */
  trail: TrailPoint[];
  /** How far back `trail` reaches. */
  trailDays: number;
  /** Whole days of trail on record, however sparse. The support gate most
   *  detectors declare. */
  trailSpanDays: number;

  places: PlaceSummary[];

  /** Precomputed so every detector gates on the same numbers. */
  coverage: { last24h: number; last7d: number };

  health: {
    lastNightSleep: { performance: number; durationMins: number } | null;
    /** The owner's OWN recent average, never a population norm. */
    sleepBaseline: number | null;
    readiness: { score: number; label: string } | null;
    daysSinceWorkout: number | null;
    trainingLoad: { ratio: number; zone: string } | null;
  };

  calendar: {
    events: CalendarEvent[];
    /** True when at least one calendar could not be read. A partial diary must
     *  never be treated as an empty one — that is how "your afternoon is free"
     *  gets said over the top of a meeting. */
    partial: boolean;
    available: boolean;
  };

  interests: InterestTerm[];

  offers: {
    /** False until the merge-5 index exists. Detectors check this rather than
     *  inferring emptiness from an empty list. */
    available: boolean;
    items: Offer[];
  };

  memories: MemoryRow[];

  sources: SnapshotSource[];
}

// ── What a detector returns ──────────────────────────────────────────────────

export interface EvidenceRef {
  /** 'trail' | 'place' | 'memory' | 'email' | 'research' | 'calendar' | 'health' */
  kind: string;
  id: string;
  note?: string;
}

export interface ProposedAction {
  kind: string;
  label: string;
  payload: string;
}

export interface Candidate {
  kind: string;
  title: string;
  /** Deterministic, rule-generated, always present. A thought must be
   *  explainable without ever having called a model. */
  explanation: string;
  /** 0..1 BEFORE the learned weight is applied. */
  rawScore: number;
  /** Every input to `rawScore`, named. Never show an unexplained number. */
  components: Record<string, number>;
  evidence: EvidenceRef[];
  placeId?: string | null;
  /** The identity that survives recomputation. Detectors own this because the
   *  right key genuinely differs by kind: asking twice about the same place is
   *  annoying, while a free-window suggestion should recur on a new day. */
  dedupeKey: string;
  proposedActions: ProposedAction[];
}

/** Whether a detector has enough history to have an opinion at all. */
export interface Readiness {
  ready: boolean;
  have: number;
  need: number;
  unit: string;
  /** Rendered verbatim on the ledger page. */
  reason: string;
}

export interface Detector {
  kind: string;
  description: string;
  /**
   * The minimum-support gate, separate from `detect` so the page can render
   * "needs 28 days of trail, has 3" without running the detector.
   *
   * This is the guard against the failure the whole design is arranged
   * against: a detector that fires on nine days because eight was the
   * threshold and nobody checked will tell you, confidently, that your Tuesday
   * is a routine.
   */
  readiness(snapshot: DaydreamSnapshot): Readiness;
  detect(snapshot: DaydreamSnapshot): Candidate[];
}

/** Convenience for a detector that is ready. */
export function ready(have: number, need: number, unit: string): Readiness {
  return { ready: true, have, need, unit, reason: `${have} ${unit} (needs ${need})` };
}

/** Convenience for one that is not, with the reason a person would want. */
export function notReady(have: number, need: number, unit: string, reason?: string): Readiness {
  return {
    ready: false,
    have,
    need,
    unit,
    reason: reason ?? `needs ${need} ${unit}, has ${have}`,
  };
}
