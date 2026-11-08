// src/lib/daydream/think/interests.ts
//
// Which ONE interest a research cycle looks into. PURE.
//
// ── Why code picks it ───────────────────────────────────────────────────────
//
// Research cycles wrote 71 notes in the loop's first 22 days: 2 rated useful,
// 17 not useful — 63% of every "not for me" he gave. About fifteen were on one
// subject, the Ember-1 audit, and the Barns Ness walk was pitched three times.
// The cause was in the list the cycle was handed, measured on prod 2026-10-16:
//
//   • the notebook's newest twelve entries, which were eleven auto-written
//     "News brief — <date>" notes (folder News, tag brief) and Ember-1, so
//     Ember-1 was the only interest of his on the list most days;
//   • research sessions from the last 60 days, which included the ones daydream
//     itself started from its own notes ("Dig deeper"), titled with the note —
//     each one a new "interest" in the subject it had just written about.
//
// So the list is cleaned (no machine-written notebook entries, no sessions a
// daydream note started, nothing too short or too empty to mean anything,
// asks about the same thing merged into the newest), and code picks one interest per cycle: the one looked at longest
// ago, never one looked at in the last week, and longer than that when he
// turned the last two down. When nothing is due the cycle does not run.

import { slugOf } from './audit';
import { sameTopic } from './topics';
import { topicSubject } from './subjects';

/** An interest is not looked at again within this many days… */
export const INTEREST_COOLDOWN_DAYS = 7;
/** …or this many, when his last two verdicts on it were "no". */
export const INTEREST_COOLDOWN_DECLINED_DAYS = 21;
/** Fewer letters than this is a test entry ("dfdf"), not an interest. */
export const INTEREST_MIN_LETTERS = 5;

/** The prefix `digDeeper` (`act/follow.server.ts`) writes as a session's first
 *  goal — how a session daydream started is told from one he did. */
export const DAYDREAM_SESSION_GOAL = 'Check what this daydream note says';

export interface NotebookEntry {
  title: string;
  folder: string;
  tags: readonly string[];
}

export interface SessionEntry {
  topic: string;
  goals: unknown;
}

/** A notebook entry the site wrote for itself (the daily news brief). */
export function isMachineNote(n: NotebookEntry): boolean {
  return n.folder === 'News' && n.tags.includes('brief');
}

/** A research session started from a daydream note's "Dig deeper". */
export function isDaydreamSession(s: SessionEntry): boolean {
  return Array.isArray(s.goals) && typeof s.goals[0] === 'string' && s.goals[0].startsWith(DAYDREAM_SESSION_GOAL);
}

function letters(s: string): number {
  return (s.match(/[A-Za-z]/g) ?? []).length;
}

/**
 * Words that say nothing about WHICH interest — the filler of a typed or
 * spoken ask. What is left is what an interest is about: two asks sharing one
 * of those words are one interest. Measured on prod 2026-10-16, where "things
 * to do to be safe in rome", "something about rome", "Rome Holiday" and "Trip
 * ideas and deals for our break in rome" were four entries for one trip, and
 * none had two capitalised names in common for `sameTopic` to see.
 */
const FILLER = new Set(
  (
    'about above after again also and any are around based been before best book booked break city could current deal deals ' +
    'details does doing family find first from going good have help holiday holidays how idea ideas into just keep know like ' +
    'look make more need notes note offer offers only other our over paper plan plans some something start starting stay ' +
    'still such take taking talking than that the their them then there these they thing things this those through test trip ' +
    'trips value want what when where which while with would your safe ideas over social sources specifically above below ' +
    'firsthand reports report owners search reddit'
  ).split(/\s+/),
);

/** What an ask is about: its words of four letters or more, less filler. */
export function contentWords(title: string): Set<string> {
  const out = new Set<string>();
  for (const w of title.toLowerCase().split(/[^a-z0-9]+/)) if (w.length >= 4 && !FILLER.has(w)) out.add(w);
  return out;
}

/** Two asks about the same thing: a content word in common, or two names. */
export function sameInterest(a: string, b: string): boolean {
  if (sameTopic(a, b)) return true;
  const x = contentWords(a);
  for (const w of contentWords(b)) if (x.has(w)) return true;
  return false;
}

export interface Interest {
  /** His words, trimmed. */
  title: string;
  from: 'notebook' | 'research';
  /** `topic:<slug>` — what a note on it is filed under (`subjects.ts`). */
  key: string;
}

/** The cleaned list, in the order given (newest first), near-duplicates merged
 *  into the first. */
export function cleanInterests(notebook: readonly NotebookEntry[], sessions: readonly SessionEntry[]): Interest[] {
  const raw: Interest[] = [
    ...notebook
      .filter((n) => !isMachineNote(n))
      .map((n) => ({ title: n.title.trim().slice(0, 100), from: 'notebook' as const, key: '' })),
    ...sessions
      .filter((s) => !isDaydreamSession(s))
      .map((s) => ({ title: s.topic.trim().slice(0, 100), from: 'research' as const, key: '' })),
  ];
  const out: Interest[] = [];
  for (const i of raw) {
    if (letters(i.title) < INTEREST_MIN_LETTERS || slugOf(i.title).length < 3) continue;
    // Nothing but filler ("just a test"): not about anything.
    if (contentWords(i.title).size === 0 && !/\d/.test(i.title)) continue;
    if (out.some((o) => slugOf(o.title) === slugOf(i.title) || sameInterest(o.title, i.title))) continue;
    out.push({ ...i, key: topicSubject(i.title) });
  }
  return out;
}

export interface Coverage {
  /** Newest note filed under the key. */
  lastAt: Date;
  /** Verdicts on its notes, newest first: true = a "no" (not useful, or a
   *  "no" reason), false = useful. Unrated notes are left out. */
  verdicts: readonly boolean[];
}

/** The days an interest rests after its last note. */
export function cooldownDays(c: Coverage | undefined): number {
  if (!c) return 0;
  const [a, b] = c.verdicts;
  return a === true && b === true ? INTEREST_COOLDOWN_DECLINED_DAYS : INTEREST_COOLDOWN_DAYS;
}

/**
 * The interest this cycle looks into, or null when none is due.
 *
 * Never-looked-at first (in list order), then the one looked at longest ago.
 */
export function pickInterest(interests: readonly Interest[], coverage: ReadonlyMap<string, Coverage>, now: Date): Interest | null {
  let best: Interest | null = null;
  let bestAt = Infinity;
  for (const i of interests) {
    const c = coverage.get(i.key);
    if (!c) return i;
    const rest = cooldownDays(c) * 86_400_000;
    if (now.getTime() - c.lastAt.getTime() < rest) continue;
    if (c.lastAt.getTime() < bestAt) {
      best = i;
      bestAt = c.lastAt.getTime();
    }
  }
  return best;
}
