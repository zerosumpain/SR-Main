/**
 * Scoring for the research frontier — how a finished lead is judged, and how a
 * dead end is recognised.
 *
 * The old engine could only stop the WHOLE run: phase 1 quit on category
 * saturation, phase 2 on facts-per-twenty-sources. Both are global averages, so
 * a branch that was going nowhere never got pruned — it just dragged the mean
 * down while the run kept paying for it. Follow-up queries were a plain FIFO
 * queue with no score at all, so an unproductive line of enquiry spawned
 * children exactly like a productive one.
 *
 * Everything here runs on numbers the engine already computes — facts that
 * survived dedup, entities not already in the session, and cosine similarity
 * against embeddings that exist anyway. No extra LLM call is needed to decide a
 * lead is a dead end, which is what makes it affordable to do per branch.
 */

/** What a lead actually returned, once its work is done. */
export interface LeadOutcome {
  sourcesFound: number;
  /** Facts that survived dedup — genuinely new claims. */
  novelFacts: number;
  /** Facts thrown away as duplicates of what we already had. */
  duplicateFacts: number;
  /** Entities not already present in this session's graph. */
  novelEntities: number;
  /**
   * How many of those new entities attach to what we already know — the main
   * component of the session graph, anchored on the topic and goals.
   */
  connectedEntities: number;
  /** Mean cosine of the new facts against the topic/goal anchor, 0..1. */
  goalAlignment: number;
  /** True when the lead's searches errored, as opposed to returning nothing. */
  searchFailed: boolean;
}

export type LeadStatus = 'productive' | 'exhausted' | 'drifted' | 'failed';

export interface LeadVerdict {
  status: LeadStatus;
  /** Plain-English justification, shown to the user. */
  reason: string;
  score: number;
}

/**
 * Below this cosine against the topic/goal anchor, material is "not about the
 * question". Deliberately low: the aim is to catch a run that has wandered onto
 * a different subject entirely (an unrelated namesake, a homonym), not to
 * police relevance.
 */
export const DRIFT_ALIGNMENT = 0.35;

/**
 * Minimum share of a lead's new entities that must attach to the existing graph
 * for it to count as connected. A free-floating cluster is the signature of
 * drift — the run has found a coherent, well-sourced topic that simply is not
 * the one that was asked about.
 */
export const DRIFT_CONNECTIVITY = 0.2;

/** Cosine similarity, hardened against the shapes real data actually arrives in. */
export function cosine(a: number[], b: number[]): number {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * How much this lead was worth, used to order the frontier.
 *
 * Novelty is the base; alignment scales it. Ten facts about the wrong subject
 * must not outrank three about the right one, which is precisely the trade the
 * old unscored FIFO queue got wrong.
 */
export function scoreYield(o: LeadOutcome): number {
  const novelty = o.novelFacts + o.novelEntities * 0.5;
  if (novelty <= 0) return 0;
  const alignment = Math.max(0, Math.min(1, o.goalAlignment));
  const connectivity = o.novelEntities > 0 ? o.connectedEntities / o.novelEntities : 0;
  // Alignment dominates; connectivity is a smaller corroborating signal.
  return Math.max(0, novelty * (0.25 + 0.6 * alignment + 0.15 * connectivity));
}

/**
 * Judge a finished lead.
 *
 * Order matters. A failed search is classified first and never blamed on the
 * topic — treating a Tavily error as evidence would prune a sound line of
 * enquiry because the network hiccuped. Drift requires BOTH signals: new
 * sub-areas legitimately start unconnected, and a tightly-connected aside can
 * still be on-topic, so either alone produces false positives.
 */
export function classifyOutcome(o: LeadOutcome): LeadVerdict {
  const score = scoreYield(o);

  if (o.searchFailed && o.sourcesFound === 0) {
    return { status: 'failed', reason: 'the search itself failed — not retried', score };
  }

  const connectivity = o.novelEntities > 0 ? o.connectedEntities / o.novelEntities : 1;
  const offQuestion = o.goalAlignment < DRIFT_ALIGNMENT;
  const unconnected = connectivity < DRIFT_CONNECTIVITY;

  if (offQuestion && unconnected && o.novelFacts > 0) {
    return {
      status: 'drifted',
      reason: `${o.novelFacts} facts found, none of them connected to the question — abandoned`,
      score,
    };
  }

  if (o.novelFacts === 0 && o.novelEntities === 0) {
    return {
      status: 'exhausted',
      reason: o.duplicateFacts > 0
        ? `nothing new — all ${o.duplicateFacts} claims were already known`
        : 'nothing new found',
      score,
    };
  }

  return {
    status: 'productive',
    reason: `${o.novelFacts} new facts, ${o.novelEntities} new entities`,
    score,
  };
}
