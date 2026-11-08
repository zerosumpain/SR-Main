// src/lib/daydream/think/subjects.ts
//
// What a note is ABOUT, so the loop remembers findings rather than sentences.
// PURE — no db, no model.
//
// ── Why ─────────────────────────────────────────────────────────────────────
//
// Over the first 22 days of the think loop (to 2026-10-16) the same finding
// came back reworded again and again: the £79 Apple charge ×3, GitHub +20% ×2,
// Sky +£1.69 ×2, the Postcode Lottery double payment ×2, the front door
// "blind" ×2, "extra sleep isn't predicting next-day recovery" ×4 in two days,
// and about fifty plans for the same few weeks. Two guards existed and neither
// could see it: the exact dedupe key is the title's slug, and `liveEchoOf`
// compares claims among LIVE rows — and 53% of notes expire unanswered, after
// which they are no longer live and the next cycle says it all again.
//
// So each note gets a subject key, checked by code, and the rule is simple:
//
//   • no earlier note on the subject in the window → a new note;
//   • an earlier one, and the new note says WHAT CHANGED with a figure the
//     earlier note did not have (and its own cards do) → a revision: the new
//     note stands, older unanswered notes on the subject are archived under it;
//   • an earlier one and nothing new → folded: no new note, the earlier one
//     records "seen again" and the day.
//
// Where the key comes from, by how much code can know:
//
//   plan:current             every health_plan note — one living week plan.
//   correlate:<a>~<b>        a correlate note's cited correlate() card.
//   topic:<interest>         a research cycle's note — the interest CODE gave it.
//   <type>:<name>            otherwise the model's own `subject`, kept only when
//                            the name appears in a card the note cites.

import { slugOf } from './audit';
import type { Card } from './tools';

/** The evidence kind that carries a note's subject key. Listed in
 *  `refutations.ts` as a kind that identifies no claim on its own: two notes on
 *  one subject can say different things, and that is this module's call. */
export const SUBJECT_EVIDENCE_KIND = 'think-subject';

/** The subject types the model may name. Closed, so keys stay comparable. */
export const MODEL_SUBJECT_TYPES = ['merchant', 'device', 'sender', 'event', 'thing'] as const;
export type ModelSubjectType = (typeof MODEL_SUBJECT_TYPES)[number];

export const PLAN_SUBJECT = 'plan:current';

/** How far back an earlier note on the subject counts. A month: a bill's next
 *  rise is a new figure anyway, and a repeat after a month is a reminder. */
export const SUBJECT_WINDOW_DAYS = 30;
/** A plan is revised at most this often, however much it says changed. Each
 *  morning's recovery is a new number, so "a new figure" alone would let the
 *  plan be rewritten daily — the thing this replaces. */
export const PLAN_MIN_HOURS = 48;
/** With no plan this recent, a new one needs no reason. */
export const PLAN_FRESH_DAYS = 7;

const NAME_MIN = 3;

/** `merchant:Sky` → `merchant:sky`. Null when either half is unusable. */
export function modelSubjectKey(raw: unknown): { key: string; type: ModelSubjectType; name: string } | null {
  if (typeof raw !== 'string') return null;
  const m = /^\s*([a-z]+)\s*:\s*(.+?)\s*$/i.exec(raw);
  if (!m) return null;
  const type = m[1].toLowerCase();
  if (!(MODEL_SUBJECT_TYPES as readonly string[]).includes(type)) return null;
  const name = m[2].replace(/\s+/g, ' ').trim();
  const slug = slugOf(name);
  if (name.length < NAME_MIN || slug.length < NAME_MIN) return null;
  return { key: `${type}:${slug}`, type: type as ModelSubjectType, name };
}

/** Lowercase letters and digits only, so "SKY DIGITAL" holds "Sky". */
function squash(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Does a cited card name it? A subject the evidence never mentions is the
 *  model's label, not his data, and keys nothing. */
export function namedInCards(name: string, cards: readonly Pick<Card, 'text'>[]): boolean {
  const want = squash(name);
  if (want.length < NAME_MIN) return false;
  return cards.some((c) => squash(c.text).includes(want));
}

/** The canonical key for a tested pair: order-free, as a same-day test is. */
export function correlateSubject(a: string, b: string): string {
  return `correlate:${[a, b].sort().join('~')}`;
}

export function topicSubject(interest: string): string {
  return `topic:${slugOf(interest)}`;
}

export interface SubjectInput {
  outcome: string;
  /** The model's `subject` field, verbatim. */
  modelSubject: unknown;
  /** The cards the note cites. */
  cited: readonly Pick<Card, 'tool' | 'args' | 'text'>[];
  /** Set by code on a research cycle: the one interest it was given. */
  researchTopic?: string | null;
  /** Set by code on the monthly correlation summary cycle. */
  summaryKey?: string | null;
}

/** The key a note is filed under, or null for a note with no checkable subject
 *  (it then behaves as before: only the title-level guards apply). */
export function subjectFor(input: SubjectInput): string | null {
  if (input.summaryKey) return input.summaryKey;
  if (input.researchTopic) return topicSubject(input.researchTopic);
  if (input.outcome === 'health_plan') return PLAN_SUBJECT;
  if (input.outcome === 'correlate') {
    const card = input.cited.find((c) => c.tool === 'correlate' && typeof c.args.a === 'string' && typeof c.args.b === 'string');
    if (card) return correlateSubject(String(card.args.a), String(card.args.b));
  }
  const m = modelSubjectKey(input.modelSubject);
  if (m && namedInCards(m.name, input.cited)) return m.key;
  return null;
}

// ── What changed ────────────────────────────────────────────────────────────

/**
 * The figures in a text: amounts, percentages, counts, dates — any token with a
 * digit in it, normalised so "£1.69," and "£1.69" match. Words are not
 * figures; "it rose again" carries no news.
 */
export function figuresIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(/[£$€]?\d[\d.,:/-]*%?/g)) {
    const f = m[0].replace(/[.,:/-]+$/, '').replace(/,/g, '');
    if (f) out.add(f);
  }
  return out;
}

/**
 * The figures that make a revision real: in the "changed" clause, absent from
 * the earlier note, present in the new note's own cards. The last condition is
 * the citation audit's rule applied to the claim of novelty — a changed figure
 * the evidence does not hold is invented.
 */
export function newFigures(changed: string | null, earlierText: string, citedText: string): string[] {
  if (!changed) return [];
  const before = figuresIn(earlierText);
  const cards = figuresIn(citedText);
  return [...figuresIn(changed)].filter((f) => !before.has(f) && cards.has(f));
}

// ── The decision ────────────────────────────────────────────────────────────

export interface EarlierNote {
  id: string;
  title: string;
  /** Title + narrative: what the owner was told. */
  text: string;
  createdAt: Date;
  /** He did something with it — rated, ruled, noted, acted on, checked. His
   *  record; never archived by a newer note. */
  answered: boolean;
  /** Still a card he could act on (not archived, not dismissed). */
  open: boolean;
}

export type SubjectDecision =
  | { action: 'new' }
  | { action: 'revise'; figures: string[]; supersede: string[] }
  | { action: 'fold'; into: string; why: string };

export function decideOnSubject(opts: {
  key: string;
  changed: string | null;
  citedText: string;
  /** Notes on the same key, any order. */
  earlier: readonly EarlierNote[];
  now: Date;
}): SubjectDecision {
  const floor = opts.now.getTime() - SUBJECT_WINDOW_DAYS * 86_400_000;
  const prior = opts.earlier
    .filter((e) => e.createdAt.getTime() >= floor && e.createdAt.getTime() <= opts.now.getTime())
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  if (prior.length === 0) return { action: 'new' };
  const newest = prior[0];
  const supersede = prior.filter((e) => !e.answered && e.open).map((e) => e.id);

  if (opts.key === PLAN_SUBJECT) {
    const ageH = (opts.now.getTime() - newest.createdAt.getTime()) / 3_600_000;
    if (ageH >= PLAN_FRESH_DAYS * 24) return { action: 'revise', figures: [], supersede };
    if (ageH < PLAN_MIN_HOURS) return { action: 'fold', into: newest.id, why: `plan revised ${Math.round(ageH)}h ago` };
  }
  // Revisions are measured against everything already said on the subject,
  // not just the newest note, so a figure cannot come back as "new".
  const figures = newFigures(opts.changed, prior.map((p) => p.text).join('\n'), opts.citedText);
  if (figures.length) return { action: 'revise', figures, supersede };
  return { action: 'fold', into: newest.id, why: opts.changed ? 'changed clause has no new figure from its cards' : 'nothing changed' };
}

// ── "Seen again" on the earlier note ────────────────────────────────────────

/** The `proposed_actions` entry a fold writes. Carries `done`, like
 *  `replaces`, so the think loop's re-proposal keeps it (`thought-store.ts`). */
export const SEEN_AGAIN_KIND = 'seen_again';
const SEEN_KEEP = 12;

export function readSeenAgain(actions: unknown): string[] {
  if (!Array.isArray(actions)) return [];
  const entry = (actions as Array<{ kind?: unknown; payload?: unknown }>).find((a) => a?.kind === SEEN_AGAIN_KIND);
  if (!entry || typeof entry.payload !== 'string') return [];
  try {
    const v = JSON.parse(entry.payload) as unknown;
    return Array.isArray(v) ? v.filter((d): d is string => typeof d === 'string') : [];
  } catch {
    return [];
  }
}

/** The actions array with one more sighting on `day` (YYYY-MM-DD). */
export function withSeenAgain(actions: unknown, day: string, now: Date): Array<Record<string, unknown>> {
  const list = Array.isArray(actions) ? (actions as Array<Record<string, unknown>>) : [];
  const days = [...readSeenAgain(list), day].slice(-SEEN_KEEP);
  return [
    ...list.filter((a) => a?.kind !== SEEN_AGAIN_KIND),
    {
      kind: SEEN_AGAIN_KIND,
      label: `Found again ${days.length} time${days.length === 1 ? '' : 's'}`,
      payload: JSON.stringify(days),
      done: { at: now.toISOString() },
    },
  ];
}

/** The subject key on a stored note's evidence, or null. */
export function subjectOf(evidence: unknown): string | null {
  if (!Array.isArray(evidence)) return null;
  for (const e of evidence as Array<{ kind?: unknown; id?: unknown }>) {
    if (e?.kind === SUBJECT_EVIDENCE_KIND && typeof e.id === 'string') return e.id;
  }
  return null;
}

/** "merchant:sky" → "Sky", for the ALREADY SAID block and the card. */
export function subjectLabel(key: string): string {
  if (key === PLAN_SUBJECT) return 'the week plan';
  const [type, ...rest] = key.split(':');
  const name = rest.join(':').replace(/~/g, ' and ').replace(/-/g, ' ');
  return type === 'correlate' ? `the test of ${name}` : name;
}
