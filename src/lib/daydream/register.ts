// src/lib/daydream/register.ts
//
// The solutions register: every step a note set going, newest first. PURE —
// built from what the notes already store, so there is no second record to
// drift from the first.
//
// Owner, 2026-10-29: "When building solutions keep a simple register of
// activities or code snippets tracking improvements." Each entry says what was
// done, from which note, where it lives now, and — for a tracker or a build —
// how it turned out. Bookkeeping entries (`replaces`, `seen_again`) carry
// `done` too and are not solutions; only the kinds below count.

import { ACT_KINDS, readStored } from './act/plan';
import { FOLLOW_KINDS, readFollow } from './act/follow';
import { readSolve, TRACK_WORDS } from './act/solution';

export type RegisterSource = 'solution' | 'do' | 'follow';

export interface RegisterEntry {
  at: string;
  thoughtId: string;
  noteTitle: string;
  source: RegisterSource;
  /** Short kind, in words: "Tracker", "Lights off", "Diary entry", "Build". */
  kind: string;
  /** What was done, as the button said it. */
  what: string;
  state: 'done' | 'undone' | 'stopped' | 'running';
  href: string | null;
  /** Filled in by the loader where there is an outcome to report. */
  result: string | null;
  /** A backlog slug or tracker id, for the loader to look the outcome up by. */
  ref: string | null;
}

const ACT_WORDS: Record<string, string> = {
  calendar_event: 'Diary entry',
  reminder: 'Reminder',
  calendar_move: 'Diary move',
  email_draft: 'Email draft',
  event_hold: 'Day held',
  calendar_batch: 'Plan in the diary',
};

const SOLVE_WORDS: Record<string, string> = {
  track: 'Tracker',
  home: 'Home Assistant',
  open: 'Opened a page',
  build: 'Build',
  watch: 'Watch',
};

const FOLLOW_WORDS: Record<string, string> = {
  research: 'Research run',
  promote: 'On the build list',
  build: 'Build accepted',
  prototype: 'Prototype',
  watch: 'Watch',
  message: 'Message drafted',
  home: 'Home Assistant refresh',
};

export interface RegisterRow {
  id: string;
  title: string;
  proposedActions: unknown;
}

/** Every solution, step and follow-up on these notes, newest first. */
export function registerEntries(rows: readonly RegisterRow[]): RegisterEntry[] {
  const out: RegisterEntry[] = [];
  for (const row of rows) {
    const base = { thoughtId: row.id, noteTitle: row.title };

    const s = readSolve(row.proposedActions);
    const done = s?.stored.done;
    if (s && done) {
      const plan = s.plan;
      out.push({
        ...base,
        at: done.at,
        source: 'solution',
        kind: SOLVE_WORDS[plan.kind] ?? plan.kind,
        what: plan.kind === 'track' ? `${s.stored.label} — “${plan.label}” (${TRACK_WORDS[plan.metric].label})` : s.stored.label,
        state: done.undoneAt ? (plan.kind === 'track' ? 'stopped' : 'undone') : plan.kind === 'track' ? 'running' : 'done',
        href: done.href ?? null,
        result: done.message ?? null,
        ref: done.ref ?? null,
      });
    }

    const act = readStored(row.proposedActions);
    if (act?.stored.done) {
      const d = act.stored.done;
      out.push({
        ...base,
        at: d.at,
        source: 'do',
        kind: ACT_WORDS[act.plan.kind] ?? act.plan.kind,
        what: act.stored.label,
        state: d.undoneAt ? 'undone' : 'done',
        href: d.eventId && d.eventId.startsWith('/') ? d.eventId : null,
        result: d.sentAt ? 'Sent.' : null,
        ref: null,
      });
    }

    const follow = readFollow(row.proposedActions);
    for (const kind of FOLLOW_KINDS) {
      const f = follow[kind];
      if (!f) continue;
      // A build solution writes its own follow entries; the solution row says it.
      if (s?.plan.kind === 'build' && done && (kind === 'promote' || kind === 'build')) continue;
      if (s?.plan.kind === 'watch' && done && kind === 'watch') continue;
      const data = f.data;
      const slug = typeof data.slug === 'string' ? data.slug : null;
      const href =
        kind === 'research' && typeof data.sessionId === 'string' ? `/research/${data.sessionId}`
        : (kind === 'promote' || kind === 'build') && slug ? `/jkai/develop/backlog?item=${encodeURIComponent(slug)}`
        : kind === 'prototype' && typeof data.buildId === 'string' ? `/jkai/builds/${data.buildId}`
        : kind === 'watch' ? '/jkai/daydreams/watches'
        : null;
      out.push({
        ...base,
        at: f.at,
        source: 'follow',
        kind: FOLLOW_WORDS[kind] ?? kind,
        what: kind === 'build' && !data.acceptedAt ? 'Brief drafted' : FOLLOW_WORDS[kind] ?? kind,
        state: kind === 'watch' && data.stoppedAt ? 'stopped' : 'done',
        href,
        result: null,
        ref: slug,
      });
    }
  }
  return out.filter((e) => e.at).sort((a, b) => b.at.localeCompare(a.at));
}

/** The kinds the SQL pre-filter looks for: anything that is not bookkeeping. */
export const REGISTER_KIND_PREFIXES = ['solve:', 'follow:'] as const;
export const REGISTER_ACT_KINDS: readonly string[] = ACT_KINDS;

/** Counts for the room's header. */
export function registerSummary(entries: readonly RegisterEntry[], now: Date): { total: number; last30: number; running: number; byKind: Array<[string, number]> } {
  const floor = now.getTime() - 30 * 86_400_000;
  const by = new Map<string, number>();
  for (const e of entries) by.set(e.kind, (by.get(e.kind) ?? 0) + 1);
  return {
    total: entries.length,
    last30: entries.filter((e) => Date.parse(e.at) >= floor).length,
    running: entries.filter((e) => e.state === 'running').length,
    byKind: [...by.entries()].sort((a, b) => b[1] - a[1]),
  };
}
