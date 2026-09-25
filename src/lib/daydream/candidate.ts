// src/lib/daydream/candidate.ts
//
// The shape a thought has before it is persisted — what `think/audit.ts`
// builds from a validated note and `thought-store.persistCandidates` writes.
//
// Was `snapshot-types.ts`, which also carried the retired engine's snapshot,
// detector and trail shapes; those went with it in P4a (2026-09-25).

export interface EvidenceRef {
  /** 'memory' | 'memory-theme' | 'email' | 'research' | 'calendar' | 'health' | 'card' | … */
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
  /** The identity that survives recomputation. The writer owns this because
   *  the right key genuinely differs by kind. */
  dedupeKey: string;
  proposedActions: ProposedAction[];
}
