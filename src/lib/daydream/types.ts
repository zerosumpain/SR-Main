// src/lib/daydream/types.ts
//
// Shared constants and types for daydreaming — the background state in which
// jkai looks at what it already knows and asks whether anything is worth
// saying. Kept free of `$lib/db` so the pure modules (cluster, coverage, mode
// inference) can be unit-tested without a database or a clock.
//
// The numbers here are the feature's judgement, so they live in one file
// rather than scattered as literals: what counts as a place, what counts as
// still, how long the trail is kept, and how much of a window has to be
// observed before a detector is allowed to have an opinion about it.

/** Whose trail. Family members are presence-only by policy; see schema.ts. */
export const DEFAULT_SUBJECT = 'john';

/** One tracked person: a trail subject and the HA entity that carries them. */
export interface SubjectEntity {
  subject: string;
  entity: string;
}

/**
 * Everyone the trail observes. Verified against live HA state 2026-08-27 —
 * all five person entities carry GPS attributes. The schema's original
 * "family members are presence-only by policy" note was retired by the
 * owner's D1 decision (2026-08-27): full trails for everyone. A subject whose
 * entity disappears from HA degrades to per-subject gap rows, which is the
 * honest record of "we looked and could not see them".
 */
export const FAMILY_SUBJECTS: SubjectEntity[] = [
  { subject: 'john', entity: 'person.john' },
  { subject: 'katie', entity: 'person.katie' },
  { subject: 'fintan', entity: 'person.fintan' },
  { subject: 'jemima', entity: 'person.jemima' },
  { subject: 'rory', entity: 'person.rory' },
];

// ── Trail sources ────────────────────────────────────────────────────────────

export const TRAIL_SOURCES = ['push', 'poll', 'gap'] as const;
export type TrailSource = (typeof TRAIL_SOURCES)[number];

// ── Movement mode ────────────────────────────────────────────────────────────

/**
 * Deliberately coarse. GPS speed cannot separate running from cycling — both
 * sit in the same band — so the mode does not pretend to, and `active` covers
 * both. Health data can tell them apart later; a speed threshold never will.
 * Nothing here is ever stated to the owner as fact.
 */
export const MOVEMENT_MODES = ['still', 'walking', 'active', 'vehicle', 'rail', 'unknown'] as const;
export type MovementMode = (typeof MOVEMENT_MODES)[number];

/** Upper bound (km/h, exclusive) for each band. Order matters. */
export const MODE_THRESHOLDS_KMH: ReadonlyArray<{ under: number; mode: MovementMode }> = [
  { under: 1.5, mode: 'still' },
  { under: 6.5, mode: 'walking' },
  { under: 18, mode: 'active' },
  { under: Infinity, mode: 'vehicle' },
];

/**
 * Rail is a REFINEMENT of `vehicle`, not a band of its own: sustained high
 * speed along a near-constant bearing. Without map matching this also catches
 * a motorway, which is precisely why the mode is advisory — a wrong guess here
 * costs a slightly-off suggestion, never a stated fact.
 */
export const RAIL_MIN_KMH = 55;
export const RAIL_MIN_FIXES = 3;
export const RAIL_MAX_BEARING_DELTA_DEG = 12;

/**
 * Two fixes further apart than this say nothing about speed — you could have
 * gone anywhere and come back. Beyond it, speed is null rather than a fiction.
 */
export const MAX_SPEED_WINDOW_MINS = 20;

/**
 * An implied speed above this is a GPS jump, not a journey (a bad fix in a
 * city centre routinely implies four figures). Recorded as null, and the fix
 * itself is still kept — the position may be fine even when the delta is not.
 */
export const ABSURD_SPEED_KMH = 400;

/** A fix less accurate than this is stored but never used to open or close a
 *  visit — a 500 m accuracy circle "arrives" at places you drove past. */
export const MAX_USABLE_ACCURACY_M = 150;

// ── Clustering / places ──────────────────────────────────────────────────────

/** Matches the radius the family-presence stats endpoint has used since it
 *  was written; kept identical so both surfaces agree on what one place is. */
export const CLUSTER_RADIUS_M = 200;

/**
 * How many visits make a place.
 *
 * ONE, by the owner's instruction (2026-08-26): anywhere he has actually spent
 * time is worth knowing about, not only somewhere he returns to. Requiring
 * three visits meant a café he sat in for an hour was invisible until the third
 * time, and the whole point of naming places is that a named place is what
 * turns a coordinate into a fact.
 *
 * The flood this could cause is handled where floods belong — the delivery
 * limits in deliver.ts, which cap interruptions at four a day whatever the
 * detectors find. Creating a place is cheap; interrupting someone is not.
 */
export const MIN_VISITS_FOR_PLACE = 1;

/**
 * How many visits before it is worth ASKING what a place is.
 *
 * Three, by the owner's instruction (2026-08-26; raised from two the same day
 * once the first list was seen). Deliberately separate from
 * MIN_VISITS_FOR_PLACE, because creating a place and asking about one are
 * different questions with different costs.
 *
 * A place should EXIST after one real stay: it can then match an offer, anchor
 * a proximity check, and quietly accumulate visits. None of that costs anyone
 * anything. Asking about it costs a notification and a decision, and somewhere
 * visited once is usually somewhere that does not need a name — a car park on
 * the way to somewhere else, a waiting room, a one-off.
 *
 * Conflating the two is what produced 81 questions from a month of trail.
 */
export const MIN_VISITS_TO_ASK = 3;

/**
 * The dwell that separates being somewhere from passing it.
 *
 * Ten minutes, by the owner's instruction. Below this a "visit" is a traffic
 * light, a queue at a junction, or GPS drift while stationary at a crossing.
 */
export const MIN_DWELL_MINS = 10;

/** Fixes more than this far apart inside one place are two visits, not one. */
export const VISIT_MAX_GAP_MINS = 45;

/** Local timezone for the day/hour histograms. A place's rhythm is a LOCAL
 *  fact — "usually Tuesday afternoon" is meaningless in UTC. */
export const LOCAL_TZ = 'Europe/London';

// ── Coverage ─────────────────────────────────────────────────────────────────

/**
 * How often the poll floor actually runs. THE single source of the number —
 * `daydream-observe` takes its default cadence from here.
 */
export const OBSERVE_CADENCE_SECONDS = 120;

/**
 * The interval coverage divides by, to turn "how many fixes" into "what
 * fraction of this window did we actually see".
 *
 * DERIVED from the cadence rather than written down beside it, because the two
 * drifting apart silently disables the coverage gate — which is what happened
 * between 2026-08-26 and the same evening. This said 10 while the activity ran
 * every 2 minutes, so a fully-observed hour produced 30 fixes against 6
 * expected, coverage computed 5.0, clamped to 1.0, and read "perfect" whatever
 * the sensor had done. It would only have dipped under the 0.6 gate if more
 * than 80% of polls failed.
 *
 * Three detectors gate on that number precisely so a dead sensor cannot read as
 * a change in behaviour. A gate that always passes is worse than no gate: it
 * looks like protection.
 */
export const POLL_INTERVAL_MINS = OBSERVE_CADENCE_SECONDS / 60;

/**
 * A detector reasoning about a window must see at least this fraction of it
 * actually observed. Below it, the honest answer is "I do not know", and
 * silence beats "you have not left the house in three days" when the truth is
 * that homeserv was down.
 */
export const MIN_COVERAGE = 0.6;

// ── Retention ────────────────────────────────────────────────────────────────

/** Raw fixes are pruned at this age. Aggregated places are kept. */
export const TRAIL_RETENTION_DAYS = 90;

// ── Settings keys (app_settings) ─────────────────────────────────────────────

/** Master kill switch. Unset/null is treated as ENABLED, matching the
 *  self-improvement engine's convention. */
export const SETTINGS_ENABLED_KEY = 'daydream.enabled';
/** Per-kind mute list, written by a `never_kind` tap. */
export const SETTINGS_MUTED_KINDS_KEY = 'daydream.muted_kinds';

/** Env var holding the shared secret for the push ingest endpoint. */
export const INGEST_SECRET_ENV = 'DAYDREAM_INGEST_SECRET';

// ── Shapes ───────────────────────────────────────────────────────────────────

/** A position report, from either writer, before it becomes a row. */
export interface IncomingFix {
  lat: number;
  lon: number;
  accuracyM?: number | null;
  /** ISO8601. Defaults to now — but a queued push can be minutes old. */
  at?: string | null;
  batteryPct?: number | null;
  /** Home Assistant's own state string; authoritative for "am I home". */
  haState?: string | null;
  /** Seconds since the underlying HA reading was taken. */
  readingAgeS?: number | null;
}

/** The minimum a previous row has to expose to derive speed and mode. */
export interface PriorFix {
  ts: Date;
  lat: number | null;
  lon: number | null;
}

/** A point going into the clusterer. `idx` travels through so callers can map
 *  members back to their own rows without a second lookup. */
export interface ClusterPoint {
  idx: number;
  lat: number;
  lon: number;
  ts: Date;
}

export interface Cluster {
  lat: number;
  lon: number;
  /** `idx` values of the member points, in insertion order. */
  members: number[];
}

/** A contiguous stay at one place. */
export interface Visit {
  startedAt: Date;
  endedAt: Date;
  dwellMins: number;
  fixCount: number;
}

export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
