// Finding conflated entities without being told where to look.
//
// `splitEntity` repairs a conflation; this decides what to repair. It exists
// because the first three were found by hand — a person reading relation lists
// over SSH — which fixes one night's graph and nothing about the next.
//
// PURE. No DB, no LLM, no clock. The model call and the writes live in
// ./conflation.server.ts, so the shortlist rule and the safety gate can be tested
// against real production shapes without either.
//
// ── Why the obvious detector does not work ──────────────────────────────────
//
// The tempting rule is "a relation that is rare for this entity's type" —
// `has_credit_card` on a `location` is exactly the Darlington fault. Measured on
// the live graph, it flags almost everything: the relation vocabulary is written
// by the extractor, not chosen from a controlled list, and **64% of the relations
// used by locations are used by exactly one location** (75% for people, 59% for
// products). Nearly every entity carries something "rare for its type", so the
// rule has no discriminating power at all.
//
// What DOES separate them is degree. A conflation is only harmful because it
// invents adjacency, and it can only invent adjacency by being big: Darlington
// carried 94 edges where the median location carries 1 and p95 is 7. So the
// shortlist is a degree outlier per TYPE — cheap, deterministic, and it cannot
// miss a conflation that matters, because one that is small does no harm.
//
// The judgement that follows ("is this one thing or two?") has no statistical
// shortcut and is left to a model, gated by `validateProposal` below.

/** What the shortlist needs to know about an entity. */
export interface CandidateEntity {
  id: string;
  name: string;
  typeName: string;
  degree: number;
  /** Distinct relation types on its edges, for the fingerprint and the prompt. */
  relations: string[];
}

export interface Candidate extends CandidateEntity {
  /** Degree at which this entity's type stops being ordinary. */
  threshold: number;
  /** Why it was shortlisted, for the run log. */
  reason: string;
  /** The vocabulary this verdict is about — see `hasMoved`. */
  fingerprint: string;
}

/**
 * How far above its type's 95th percentile an entity must sit.
 *
 * Not a global constant, because degree means different things per type: the p95
 * is 7 for a location, 24 for a person and 11 for an organisation, so one number
 * either floods the shortlist with ordinary people or misses conflated places
 * entirely.
 *
 * 2x p95 puts today's shortlist at a few dozen entities out of 4,400, which is
 * the right order: small enough to judge, large enough that the three known
 * conflations (94, 81 and 10 edges) are all inside it.
 */
export const OUTLIER_MULTIPLE = 2;

/**
 * Nothing below this is worth a model call however unusual its type makes it.
 *
 * p95 is 1 for the thinnest types, so `2 x p95` alone would shortlist
 * two-edge entities by the hundred. A conflation with six edges is not doing
 * enough damage to be worth spending on.
 */
export const MIN_CANDIDATE_DEGREE = 8;

/** Degree at or above which an entity of this type is an outlier. */
export function outlierThreshold(p95ForType: number): number {
  return Math.max(MIN_CANDIDATE_DEGREE, Math.ceil(p95ForType * OUTLIER_MULTIPLE));
}

/**
 * Order-independent fingerprint of an entity's relation vocabulary.
 *
 * A verdict is about a SHAPE, not a moment. Re-asking a model about an entity
 * whose relations have not changed since it last said "this is one thing" buys
 * nothing and costs a call every night for the life of the graph — the same
 * reasoning as a cluster's `narrativeFingerprint`. Degree is deliberately not in
 * it: another edge of a kind the entity already had does not change the question.
 */
export function vocabularyFingerprint(relations: readonly string[]): string {
  let hash = 0x811c9dc5;
  for (const rel of [...new Set(relations)].sort()) {
    for (let i = 0; i < rel.length; i++) {
      hash ^= rel.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    hash ^= 0x2c;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * The entities worth asking about.
 *
 * `p95ByType` comes from the graph itself rather than a table of constants, for
 * the reason the ubiquity threshold had to: a fixed number calibrated on one
 * shape of graph stops firing when the graph changes size, and does so silently.
 */
export function shortlistCandidates(
  entities: readonly CandidateEntity[],
  p95ByType: ReadonlyMap<string, number>,
): Candidate[] {
  const out: Candidate[] = [];
  for (const e of entities) {
    const threshold = outlierThreshold(p95ByType.get(e.typeName) ?? 0);
    if (e.degree < threshold) continue;
    // One relation used many times is a busy entity, not a confused one:
    // `Home Assistant` legitimately `controls` two hundred things. A conflation
    // shows up as a WIDE vocabulary, because the second referent brings its own
    // verbs with it.
    if (new Set(e.relations).size < 4) continue;
    out.push({
      ...e,
      threshold,
      reason: `degree ${e.degree} >= ${threshold} for ${e.typeName}, ${new Set(e.relations).size} distinct relations`,
      fingerprint: vocabularyFingerprint(e.relations),
    });
  }
  return out.sort((a, b) => b.degree - a.degree);
}

/** A model's answer about one candidate. */
export interface SplitProposal {
  /** False when the entity is one thing after all — the common case. */
  conflated: boolean;
  /** Relation TYPES that belong to the other referent. */
  relationTypes: string[];
  /** What the other referent is called. */
  targetName: string;
  /** Why, in one line, for the ledger and the run log. */
  reason: string;
}

export type GateVerdict =
  | { action: 'apply'; targetId: string }
  | { action: 'queue'; why: string }
  | { action: 'skip'; why: string };

/**
 * What may be done with a proposal, decided WITHOUT trusting it.
 *
 * The same shape as `verify.ts` in the self-improvement engine: a model's output
 * is text until something deterministic has agreed with it. A split invents
 * structure, which is a stronger claim than a merge — `autoMergeDuplicates` is
 * comparing two things that both already exist — so the bar here is not a
 * confidence score but an existence check.
 *
 * APPLY only when the other referent is ALREADY IN THE GRAPH. Darlington's bank
 * cards belong to a person who is already a node, and moving them is a
 * re-pointing that cannot invent anything. England's football fixtures belong to
 * a team that does not exist, and creating it is a judgement about what the world
 * contains — which is queued for a human, not taken on a model's word at 04:15.
 */
export function validateProposal(
  proposal: SplitProposal,
  candidate: Pick<Candidate, 'id' | 'relations'>,
  resolveTarget: (name: string) => { id: string; typeName: string } | null,
): GateVerdict {
  if (!proposal.conflated) return { action: 'skip', why: 'not conflated' };

  const wanted = [...new Set(proposal.relationTypes.filter((r) => typeof r === 'string' && r.trim()))];
  if (!wanted.length) return { action: 'skip', why: 'no relations named' };

  // Every named relation must actually be on the entity. A model naming a
  // relation the entity does not have is describing something else, and the rest
  // of its answer is not to be trusted either.
  const present = new Set(candidate.relations);
  const unknown = wanted.filter((r) => !present.has(r));
  if (unknown.length) {
    return { action: 'skip', why: `names relations the entity does not have: ${unknown.join(', ')}` };
  }

  // A split that takes everything is a rename, and a rename is not this
  // operation. It is also the shape a confused model produces most often.
  if (wanted.length >= present.size) {
    return { action: 'skip', why: 'would move every relation — that is a rename, not a split' };
  }

  const name = proposal.targetName?.trim();
  if (!name) return { action: 'skip', why: 'no target named' };

  const target = resolveTarget(name);
  if (!target) {
    return { action: 'queue', why: `"${name}" does not exist yet — creating it is a human's call` };
  }
  if (target.id === candidate.id) {
    return { action: 'skip', why: 'target is the entity itself' };
  }
  return { action: 'apply', targetId: target.id };
}

/** A proposal as it was recorded, so a later one can be compared against it. */
export interface RecordedProposal {
  /** Local day (YYYY-MM-DD) the proposal was made. */
  day: string;
  targetName: string;
  relationTypes: string[];
}

/**
 * Does tonight's proposal say the same thing a previous night's did?
 *
 * This is the gate that lets the detector apply anything at all, and it exists
 * because the proposals are NOT STABLE. Three dry runs over the same twelve
 * entities, same prompt, `temperature: 0`, minutes apart:
 *
 *   run 2   IBCA Data Strategy -> IBCA Board (18 edges)   over-broad
 *   run 3   IBCA Data Strategy -> IBCA (4 edges)          correct
 *
 * Requests are throughput-routed across providers, so `temperature: 0` buys
 * nothing and a single judgement is a suggestion about one night rather than a
 * finding. Agreement across nights is the cheapest available filter on that
 * noise: the two IBCA answers above disagree in both target and size, and
 * neither would have been applied.
 *
 * Exact on both halves deliberately. A proposal that keeps the target but grows
 * the relation set is the over-broad failure mode — 4 edges becoming 18 — and
 * treating it as agreement would apply exactly the version that is wrong.
 *
 * A DIFFERENT DAY, not merely a different run. Two sweeps minutes apart share
 * whatever made the model answer as it did; the point is to sample twice.
 */
export function corroborates(
  previous: RecordedProposal | null | undefined,
  current: Omit<RecordedProposal, 'day'>,
  today: string,
): boolean {
  if (!previous) return false;
  if (!previous.day || previous.day === today) return false;
  if (previous.targetName !== current.targetName) return false;
  const before = [...new Set(previous.relationTypes)].sort();
  const now = [...new Set(current.relationTypes)].sort();
  return before.length === now.length && before.every((r, i) => r === now[i]);
}
