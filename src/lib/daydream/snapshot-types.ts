// src/lib/daydream/snapshot-types.ts
//
// The shape of a candidate thought: what a producer (the think loop, the
// appetite bridge) hands `persistCandidates`. Deliberately free of `$lib/db`.
// The detector snapshot this file was named for was retired in P4 of the
// 2026-09-25 simplification; only the candidate half remains.

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

