// src/lib/daydream/think/relevance.ts
//
// Which daydream notes are WAITING ON HIM, and which match what he is asking
// about. PURE: no model call, no query; it reads notes another loader fetched
// (`loadNativeDetail`), so the Inbox, Today and chat cannot disagree.
//
// "Waiting on you" deliberately leaves out plain unrated notes. Since 10-14
// about nine in ten delivered notes go unrated, so "Your call" would always be
// full and a "Needs you" list built from it would be noise (overhaul plan
// 2026-10-28, point 8). It counts the things that really need him:
//
//   commission_needs_ok  a double-check waiting for his OK, or stuck
//   report_back          a check or build came back to a note he has not rated
//   draft_waiting        a follow-up he asked for is drafted and waits on him
//
// "Answers to his asks" joins this list when `daydream_ask` exists; there is
// no ask queue yet, so nothing can be waiting as one.

import { contentWords } from './interests';
import type { NativeNoteDetail } from './notes';

export type WaitingReason = 'commission_needs_ok' | 'report_back' | 'draft_waiting';

export const WAITING_LABEL: Record<WaitingReason, string> = {
  commission_needs_ok: 'Double-check waiting for your OK',
  report_back: 'A report came back',
  draft_waiting: 'A follow-up is drafted',
};

/** Commission states where the next move is his (`explain.ts` noteStage). */
const COMMISSION_NEEDS_YOU = new Set(['awaiting_approval', 'needs_attention']);

export type WaitingInput = Pick<NativeNoteDetail, 'stage' | 'bucket' | 'commissionState'>;

/** Why this note waits on him, or null when it does not. */
export function waitingReason(n: WaitingInput): WaitingReason | null {
  if (n.bucket !== 'decide') return null;
  if (n.commissionState && COMMISSION_NEEDS_YOU.has(n.commissionState)) return 'commission_needs_ok';
  if (n.stage === 'result') return 'report_back';
  // `decide`/`decide` without a commission is a drafted follow-up
  // (`followStage`); a plain unrated note is `spotted`, and is not counted.
  if (n.stage === 'decide') return 'draft_waiting';
  return null;
}

export interface WaitingNote<N> {
  note: N;
  reason: WaitingReason;
}

/** The notes waiting on him, in the order given (the loaders send newest first). */
export function waitingOnYou<N extends WaitingInput>(notes: readonly N[]): WaitingNote<N>[] {
  const out: WaitingNote<N>[] = [];
  for (const note of notes) {
    const reason = waitingReason(note);
    if (reason) out.push({ note, reason });
  }
  return out;
}

/** How far back a note can match a question. */
export const MATCH_WINDOW_DAYS = 7;

export type MatchInput = Pick<NativeNoteDetail, 'title' | 'summary' | 'createdAt'>;

/**
 * Notes about what he asked: content words shared with the title count twice,
 * with the summary once, and a note needs 2 to match — one shared word in the
 * summary alone is how "this week" matches everything. Best first; ties keep
 * the given (newest-first) order. An empty or filler-only query matches none.
 */
export function matchNotes<N extends MatchInput>(query: string, notes: readonly N[], now: Date, limit = 5): N[] {
  const asked = contentWords(query);
  if (asked.size === 0) return [];
  const since = now.getTime() - MATCH_WINDOW_DAYS * 86_400_000;
  const scored: Array<{ note: N; score: number; ix: number }> = [];
  notes.forEach((note, ix) => {
    const at = Date.parse(note.createdAt);
    if (!Number.isFinite(at) || at < since) return;
    const title = contentWords(note.title);
    const summary = contentWords(note.summary ?? '');
    let score = 0;
    for (const w of asked) {
      if (title.has(w)) score += 2;
      else if (summary.has(w)) score += 1;
    }
    if (score >= 2) scored.push({ note, score, ix });
  });
  scored.sort((a, b) => b.score - a.score || a.ix - b.ix);
  return scored.slice(0, limit).map((s) => s.note);
}
