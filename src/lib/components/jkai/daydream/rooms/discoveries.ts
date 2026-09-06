// src/lib/components/jkai/daydream/rooms/discoveries.ts
//
// The shapes the Discoveries room passes between its page and its two big
// pieces — the hypothesis board and the leads table.
//
// In a `.ts` module for the reason `hub/types.ts` exists: a Svelte instance
// script is not a module you can import a type out of, so an interface
// declared inside one has to be redeclared everywhere it is used.
//
// Declared here rather than imported from `$lib/daydream/hypotheses/store`,
// `.../hypotheses/detail` and `.../leads/detail`. Those three reach `$lib/db`.
// A pure `import type` from them would be erased, but the moment anyone in a
// component edits one into a value import the BUILD fails rather than the
// type-check — the same trap `feed-client.ts` was created to keep away from
// the browser. The monolith kept its own copies for the same reason.

/** One question on the board: what was asked, and what the data said back. */
export interface BoardRow {
  id: string;
  /** Whose question this is. The board spans the household. */
  subject: string;
  question: string;
  rationale: string;
  metricA: string;
  metricB: string;
  lagDays: number;
  direction: string;
  verdict: string | null;
  summary: string | null;
  r: number | null;
  qValue: number | null;
  pairs: number | null;
  familySize: number | null;
  retestCount: number;
  /** Days until it is asked again. Every verdict here is provisional. */
  retestInDays: number | null;
  feedback: string | null;
  proposedAt: string;
  testedAt: string | null;
}

/** The days behind one verdict — fetched on expand, never with the page. */
export interface HypDetail {
  plan?: import('$lib/daydream/hypotheses/plan').InvestigationPlan | null;
  evidenceAsOf?: string | null;
  history?: Array<{ at: string; phase: string; verdict: string; summary: string; pairs: number }>;

  metricA: string;
  metricB: string;
  lagDays: number;
  /** Days in the window that contributed nothing. Pairwise deletion, not
   *  imputation, is what makes `n` smaller than the window. */
  unusedCount: number;
  days: Array<{ day: string; a: number | null; b: number | null; used: boolean }>;
}

/** One line of enquiry, as the ledger's summary query returns it. */
export interface LeadRow {
  id: string;
  leadKey: string;
  title: string;
  rationale: string;
  metrics: string[];
  status: string;
  score: number;
  roundsRun: number;
  barrenRounds: number;
  hypothesesSpawned: number;
  hypothesesHeld: number;
}

/** The trace behind a line — fetched on expand; a lead can carry 200 steps. */
export interface LeadDetailRow {
  id: string;
  title: string;
  rationale: string;
  status: string;
  metrics: string[];
  score: number;
  scoreComponents: Record<string, number>;
  roundsRun: number;
  barrenRounds: number;
  abandonAfterBarrenRounds: number;
  hypothesesSpawned: number;
  hypothesesHeld: number;
  fromSteer: boolean;
  createdAt: string;
  lastRoundAt: string | null;
  steps: Array<{ round: number; kind: string; note: string; tokens: number; at: string }>;
  questions: Array<{
    id: string;
    question: string;
    verdict: string | null;
    summary: string | null;
    r: number | null;
    qValue: number | null;
    pairs: number | null;
    proposedAt: string;
    testedAt: string | null;
  }>;
  tokens: number;
  /** Rounds ran and wrote no trace — a fault in the loop, not a quiet week. */
  traceMissing: boolean;
}

export type BoardOrder = 'priority' | 'newest' | 'strength';

/** Plain English for a stored verdict. `null` is a state, not a gap: a
 *  question that has not been tested yet is one the board must be readable in. */
export const VERDICT_LABEL: Record<string, string> = {
  supported: 'held up',
  refuted: 'legacy assessment',
  inconclusive: 'not established',
  wrong_direction: 'backwards',
  underpowered: 'not enough data',
};

export function verdictLabel(verdict: string | null): string {
  if (!verdict) return 'not answered yet';
  return VERDICT_LABEL[verdict] ?? verdict;
}

export function cap(sub: string): string {
  return sub.charAt(0).toUpperCase() + sub.slice(1);
}
