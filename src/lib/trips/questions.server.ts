// src/lib/trips/questions.server.ts
//
// v8: quick questions — generated from the brief's gaps, near-ties, clashes,
// research and reactions; each answer dry-run (./dryrun) so a question exists
// only when its answers solve to different plans; stored, ranked, answered.
//
// CONTRACT STUB (2026-10-21): signatures the conversation turn calls. The
// research/questions work replaces the bodies.

import type { Question, QuestionDraft } from './decisions';
import type { TripRecord } from './store.server';

/** Check the planner's (or a rule's) drafts: dry-run each answer, drop the ones that change nothing, store the rest. */
export async function checkQuestionDrafts(_trip: TripRecord, _drafts: QuestionDraft[], _opts: { authorEmail?: string | null } = {}): Promise<Question[]> {
  return [];
}

/**
 * Re-run the rule-based generators after the plan changed (a turn, an
 * accepted proposal, an answer, research finishing): add questions that now
 * matter, expire ones whose answers no longer differ. Never throws.
 */
export async function refreshQuestions(_trip: TripRecord, _opts: { reason?: string } = {}): Promise<Question[]> {
  return [];
}
