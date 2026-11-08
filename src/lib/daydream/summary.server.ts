// src/lib/daydream/summary.server.ts
//
// The daydream loop in one read for the surfaces outside its own rooms: Today
// ("Needs you"), the jkai chat tools and, later, the phone. Built from the same
// loader the phone's Daydream page reads (`loadNativeDetail`), so its counts
// are the Inbox's counts; the rules are `think/relevance.ts` (pure, tested).
// Read-only, no model call, no query of its own.

import { loadNativeDetail } from './think/notes.server';
import type { NativeNoteDetail } from './think/notes';
import { WAITING_LABEL, matchNotes, waitingOnYou, type WaitingReason } from './think/relevance';

/** Every note the phone may show is under this — the loader reads 300 rows. */
const READ_LIMIT = 300;

export interface SummaryNote {
  id: string;
  title: string;
  stage: NativeNoteDetail['stage'];
  bucket: NativeNoteDetail['bucket'];
  channel: string | null;
  createdAt: string;
  href: string;
  summary: string;
  commissionId: string | null;
}

export interface WaitingSummaryNote extends SummaryNote {
  reason: WaitingReason;
  /** The reason in words, for a row's sub-line. */
  reasonLabel: string;
}

export interface DaydreamSummary {
  counts: {
    /** Commissions needing his OK, reports back, drafted follow-ups. */
    waitingOnYou: number;
    /** Plain unrated notes — reported, never volunteered as "needs you". */
    unrated: number;
    inMotion: number;
  };
  waiting: WaitingSummaryNote[];
  /** Only when `q` was given: notes about it from the last week. */
  matched: SummaryNote[];
}

function brief(n: NativeNoteDetail): SummaryNote {
  return {
    id: n.id,
    title: n.title,
    stage: n.stage,
    bucket: n.bucket,
    channel: n.channel,
    createdAt: n.createdAt,
    href: n.url,
    summary: n.summary.length > 400 ? `${n.summary.slice(0, 399).trimEnd()}…` : n.summary,
    commissionId: n.commissionId,
  };
}

export async function loadDaydreamSummary(opts: { q?: string | null; limit?: number; now?: Date } = {}): Promise<DaydreamSummary> {
  const now = opts.now ?? new Date();
  const limit = Math.max(1, Math.min(20, opts.limit ?? 5));
  const { notes } = await loadNativeDetail({ limit: READ_LIMIT, now });
  const waiting = waitingOnYou(notes);
  const q = opts.q?.trim();
  return {
    counts: {
      waitingOnYou: waiting.length,
      unrated: notes.filter((n) => n.stage === 'spotted' && !n.feedback).length,
      inMotion: notes.filter((n) => n.bucket === 'motion').length,
    },
    waiting: waiting.slice(0, limit).map(({ note, reason }) => ({ ...brief(note), reason, reasonLabel: WAITING_LABEL[reason] })),
    matched: q ? matchNotes(q, notes, now, limit).map(brief) : [],
  };
}
