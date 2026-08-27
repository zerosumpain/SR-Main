// src/lib/daydream/intel-bridge.ts
//
// The knowledge graph already runs thirteen rule-based insight detectors
// nightly — brokers, emerging hubs, surprising links — each producing a
// scored, explained, deduped finding with proposed actions. Until 2026-08-27
// none of that reached daydream: two insight engines in one codebase, one of
// which could notify and one of which could think, and no wire between them.
//
// This is the wire. An intel insight becomes an ordinary daydream candidate:
// it flows through the SAME scoring, threshold, mute, cooldown and delivery
// gates as every location thought, so "interesting about the graph" still has
// to clear "worth interrupting anyone about". The mapping is pure and the
// bridge never invents content — title and explanation are the insight's own
// rule-generated text, and the evidence ref carries them as notes so compose
// can phrase without re-reading live intel rows.

import type { Candidate } from './snapshot-types';

export interface InsightRow {
  id: string;
  kind: string;
  title: string;
  explanation: string;
  score: number;
  components: Record<string, number>;
  entityIds: string[];
  dedupeKey: string;
  proposedActions: Array<{ kind: string; label: string; payload: string }>;
}

/** Insights below this raw score are left to the intel page. The bridge is a
 *  filter, not a pump — the graph produces dozens of findings and daydream's
 *  bar is "worth attention", not "true". */
export const MIN_BRIDGE_SCORE = 0.55;

/** How many insights one run may bridge. Cheap protection against a nightly
 *  analytics change suddenly flooding the thought ledger. */
export const MAX_BRIDGED_PER_RUN = 5;

/**
 * Map one intel insight to a daydream candidate, or null when it does not
 * clear the bridge bar. Kind becomes `intel_<kind>` so mutes, weights and
 * cooldowns work per insight family — muting `intel_broker` forever does not
 * silence `intel_emerging_hub`.
 */
export function insightToCandidate(insight: InsightRow): Candidate | null {
  const raw = Math.max(0, Math.min(1, insight.score));
  if (raw < MIN_BRIDGE_SCORE) return null;
  if (!insight.title.trim() || !insight.explanation.trim()) return null;

  return {
    kind: `intel_${insight.kind}`,
    title: insight.title.slice(0, 200),
    explanation: insight.explanation.slice(0, 1000),
    rawScore: raw,
    components: { ...insight.components, intelScore: raw },
    evidence: [
      {
        kind: 'intel',
        id: insight.id,
        note: `${insight.title} — ${insight.explanation}`.slice(0, 500),
      },
      ...insight.entityIds.slice(0, 5).map((id) => ({ kind: 'intel-entity', id })),
    ],
    // The graph's identity for this finding survives recomputation; reusing it
    // means a re-derived insight updates the standing thought instead of
    // spawning a sibling.
    dedupeKey: `intel:${insight.dedupeKey}`,
    proposedActions: insight.proposedActions.slice(0, 3).map((a) => ({
      kind: a.kind,
      label: a.label,
      payload: a.payload,
    })),
  };
}
