// How much a piece of evidence still counts, given its age.
//
// Gmail changed the shape of the graph. Until now every source was something
// deliberately put in — a note written, a file uploaded, a deep dive
// commissioned — so age carried little signal: a document from March is not
// less true in August. A rolling 12-week mailbox is different. Most of it is
// ordinary correspondence whose relevance really does fall off, and without
// decay the graph would be dominated by whoever emailed most 11 weeks ago.
//
// Decay is EXPONENTIAL with a half-life rather than a cliff at the window edge,
// because a cliff makes the graph lurch every night as threads age out. It is
// also FLOORED: an old edge should fade, not disappear. Something observed once
// in May is weaker evidence than something observed yesterday, but it is not
// zero evidence, and a floor of zero would silently delete history from every
// derived measure (centrality, communities, path finding) rather than
// de-emphasising it.
//
// Pure and DB-free so both halves can use it: ingest applies it when writing an
// edge's weight, and the network route reports it per node/edge so the
// renderers can fade stale material without a second query.

/** Default half-life. Six weeks — half the rolling window, so material at the
 *  edge of the window still carries ~25% of its original weight. */
export const DEFAULT_HALF_LIFE_DAYS = 42;

/** Never decay below this. See the note above on why the floor is not zero. */
export const RECENCY_FLOOR = 0.15;

/** The rolling Gmail window, in days. 12 weeks, as specified. */
export const ROLLING_WINDOW_DAYS = 84;

export const MS_PER_DAY = 86_400_000;

/**
 * Recency weight in `[RECENCY_FLOOR, 1]` for something `ageDays` old.
 *
 * Age is clamped at zero so a message whose `internalDate` is slightly in the
 * future — clock skew on the sending server, which does happen — cannot score
 * above 1 and out-rank everything genuinely current.
 */
export function recencyWeight(ageDays: number, halfLifeDays = DEFAULT_HALF_LIFE_DAYS): number {
  if (!Number.isFinite(ageDays)) return RECENCY_FLOOR;
  const age = Math.max(0, ageDays);
  const halfLife = halfLifeDays > 0 ? halfLifeDays : DEFAULT_HALF_LIFE_DAYS;
  const decayed = Math.pow(0.5, age / halfLife);
  return Math.max(RECENCY_FLOOR, Math.min(1, decayed));
}

/** Age in days between two epoch-ms instants. Negative spans read as zero. */
export function ageInDays(timestampMs: number, nowMs: number = Date.now()): number {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(0, (nowMs - timestampMs) / MS_PER_DAY);
}

/** Recency weight straight from an epoch-ms timestamp. */
export function recencyOf(
  timestampMs: number | null | undefined,
  nowMs: number = Date.now(),
  halfLifeDays = DEFAULT_HALF_LIFE_DAYS,
): number {
  if (timestampMs == null) return RECENCY_FLOOR;
  return recencyWeight(ageInDays(timestampMs, nowMs), halfLifeDays);
}

/**
 * Apply staleness to an edge weight.
 *
 * Deliberately a PARTIAL discount, not a multiplication. `weightFor` already
 * encodes how well corroborated an edge is, and multiplying that by a recency
 * of 0.15 would make a ten-times-corroborated old relationship weaker than a
 * single fresh mention — which is the wrong answer. `pull` is how much of the
 * weight is exposed to age; the rest is earned by corroboration and stays.
 */
export function decayWeight(weight: number, recency: number, pull = 0.5): number {
  const w = Number.isFinite(weight) ? Math.max(0, Math.min(1, weight)) : 0;
  const r = Number.isFinite(recency) ? Math.max(0, Math.min(1, recency)) : RECENCY_FLOOR;
  const p = Math.max(0, Math.min(1, pull));
  return Math.max(0, Math.min(1, w * (1 - p + p * r)));
}

/**
 * How much of relevance is exposed to age.
 *
 * Same 0.5 as `decayWeight`'s default, and for the same reason: half the score
 * is earned by how well established the entity is and cannot be taken away by
 * the calendar. An entity confirmed by twenty sources in June outranks a
 * single-mention guess from this morning, which is the answer a person would
 * give.
 */
export const RELEVANCE_PULL = 0.5;

export interface RelevanceInput {
  /** 0..1. `intel_entities.confidence_score` — NOT the three-value text column. */
  confidence: number | null | undefined;
  /** When this entity was last observed, epoch ms. `GraphNode.evidenceAt`. */
  evidenceAt: number | null | undefined;
}

export interface Relevance {
  /** 0..1 — how much this entity should count right now. */
  score: number;
  /** 0..1 — the confidence term, echoed so the card can show its working. */
  confidence: number;
  /** RECENCY_FLOOR..1 — the time term. */
  freshness: number;
  /** Days since the entity was last observed; null when nothing dated it. */
  ageDays: number | null;
}

/**
 * Relevance — confidence discounted by age.
 *
 * Deliberately NOT `confidence * freshness`. That is the obvious formula and it
 * is wrong here for the reason `decayWeight` gives above: multiplying a
 * well-corroborated old entity by a floor-level recency drops it below a fresh
 * guess, and the whole point of tracking confidence is that it should survive
 * the passage of time. `RELEVANCE_PULL` is how much of the score age is allowed
 * to touch.
 *
 * Confidence comes from `intel_entities.confidence_score`, which is populated
 * for every entity and is already what the lenses, briefs and watchlist read.
 * There is no text-to-number mapping for `intel_entities.confidence` anywhere in
 * the codebase and inventing one here would create a second, disagreeing
 * definition of the same word — pass `UNASSESSED_SCORE` for an unscored entity
 * instead.
 */
export function entityRelevance(
  input: RelevanceInput,
  nowMs: number = Date.now(),
  pull: number = RELEVANCE_PULL,
): Relevance {
  const confidence = Number.isFinite(input.confidence as number)
    ? Math.max(0, Math.min(1, input.confidence as number))
    : 0;
  const dated = input.evidenceAt != null && Number.isFinite(input.evidenceAt) && input.evidenceAt > 0;
  const ageDays = dated ? ageInDays(input.evidenceAt as number, nowMs) : null;
  // An entity nothing has dated is treated as maximally stale rather than
  // maximally fresh. The opposite default would let every undated row sit at the
  // top of anything sorted by relevance.
  const freshness = dated ? recencyWeight(ageDays as number) : RECENCY_FLOOR;
  return {
    score: decayWeight(confidence, freshness, pull),
    confidence,
    freshness,
    ageDays,
  };
}

/** True when a timestamp falls inside the rolling window. */
export function withinRollingWindow(
  timestampMs: number | null | undefined,
  nowMs: number = Date.now(),
  windowDays = ROLLING_WINDOW_DAYS,
): boolean {
  if (timestampMs == null) return false;
  return ageInDays(timestampMs, nowMs) <= windowDays;
}
