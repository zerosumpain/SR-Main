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
  /**
   * What the geocoder thinks it is called, and where.
   *
   * Carried into the snapshot so a detector can ASK ABOUT A PLACE BY NAME.
   * Without it the only question this feature could form was "what is this
   * place you keep going to?" about a coordinate — unanswerable on a phone,
   * and unanswerable on the ledger too, which is why ten of them sat there
   * saying nothing identifiable.
   *
   * Still not a label: a suggestion identifies the place in a question, and
   * only a tap turns it into a fact.
   */
  suggestedLabel?: string | null;
  suggestedAddress?: string | null;
  kind: string;
  source: string;
  visitCount: number;
  /** Separate LOCAL days anyone stayed here — repetition, as opposed to the
   *  person-visits in `visitCount`. */
  distinctDays: number;
  medianDwellMins: number;
  dayHistogram: number[];
  hourHistogram: number[];
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  status: string;
}

export interface CalendarEvent {
  /** iCalendar UID — the series identity. Carried so a card can offer "ignore
   *  this one" without a second round trip to the calendar. */
  uid: string | null;
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
  contextOnly?: boolean;
  id: string;
  category: string;
  content: string;
}

/** A sourced principle produced by the end-of-day memory pass. */
export interface MemoryThemeRow {
  id: string;
  kind: string;
  title: string;
  statement: string;
  guidance: string;
  confidence: string;
  sourceCount: number;
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
  coverage: { last24h: number; last7d: number; pollIntervalMins?: number };

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
    /** How many occurrences an owner exclusion removed from the list above.
     *  On the snapshot rather than inferred, because a filtered diary and an
     *  empty one look identical and mean opposite things. */
    hiddenCount: number;
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

  /** New raw memories not yet reviewed by tonight's consolidation. */
  memories: MemoryRow[];
  /** Durable roll-ups. These, rather than old episode prose, are the normal memory surface. */
  memoryThemes: MemoryThemeRow[];

  /**
   * Dated facts the email ingest already extracted — renewals, appointments,
   * deliveries — split by which side of now they sit on. Structured rows only;
   * no email body ever rides in a snapshot.
   */
  emailFacts: {
    available: boolean;
    upcoming: EmailFact[];
    recent: EmailFact[];
  };

  /** Verified spend (email receipts + bank rails when armed), newest first. */
  spend: {
    available: boolean;
    recent: SpendFact[];
    totalMinor30d: number;
  };

  /**
   * Where the rest of the household is, coordinate-free. Labels come from the
   * shared place graph; a member with no fresh fix carries nulls rather than
   * being dropped, so "not tracked right now" stays distinguishable from
   * "not at home".
   */
  family: {
    available: boolean;
    members: FamilyMember[];
  };

  sources: SnapshotSource[];
}

export interface EmailFact {
  id: string;
  /** YYYY-MM-DD (the event's own date, not the email's). */
  date: string;
  type: string;
  title: string;
  noteId: string;
}

export interface SpendFact {
  id: string;
  day: string;
  merchant: string;
  amountMinor: number;
  currency: string;
}

export interface FamilyMember {
  subject: string;
  isHome: boolean | null;
  /** Confirmed label of the known place they are at, if any. Never coordinates. */
  placeLabel: string | null;
  distanceHomeKm: number | null;
  /** Minutes since their latest positioned fix; null when they have none. */
  ageMins: number | null;
  lastSeenAt: Date | null;
}

// ── What a detector returns ──────────────────────────────────────────────────

export interface EvidenceRef {
  /** 'trail' | 'place' | 'memory' | 'memory-theme' | 'email' | 'research' | 'calendar' | 'health' */
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
