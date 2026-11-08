// src/lib/daydream/lessons.ts
//
// What daydream has learned from being wrong. PURE.
//
// A lesson is born two ways, and both land on the thought row as a `refuted`
// review with the lesson in `review_narrative`:
//
//   • the double-check argues against its own note and finds it wrong
//     (`red-team.ts`) — the lesson is the checker's own sentence;
//   • the owner says "this is wrong, because …" (`owner-verdict.ts`) — the
//     lesson is his sentence, verbatim.
//
// Each also becomes a `ruling` memory, which is the durable record. But a
// memory competes with everything else in the store; a lesson about how to
// read his data has to BIND. So the newest lessons ride in the think prompt as
// a constraint block — the move that worked for his corrections (`profile.ts`)
// — and in the double-check's own prompt, so the checker learns too.

/** The reviewer the owner writes as, in `review_model`. */
export const OWNER_REVIEWER = 'owner';

export interface Lesson {
  title: string;
  lesson: string;
  /** Who caught it. */
  by: 'owner' | 'check';
}

/** How many lessons ride in a prompt, and how far back. A lesson about how to
 *  read the bank does not expire because a season passed. */
export const LESSONS_IN_PROMPT = 10;
export const LESSON_WINDOW_DAYS = 180;

/** Newest first in, at most one per lesson text out. */
export function dedupeLessons(lessons: Lesson[], limit = LESSONS_IN_PROMPT): Lesson[] {
  const seen = new Set<string>();
  const out: Lesson[] = [];
  for (const l of lessons) {
    const text = l.lesson.replace(/\s+/g, ' ').trim();
    if (text.length < 5) continue;
    const key = text.toLowerCase().slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...l, lesson: text.slice(0, 300), title: l.title.replace(/\s+/g, ' ').trim().slice(0, 120) });
    if (out.length >= limit) break;
  }
  return out;
}

/** The prompt block. Empty when there is nothing to say. */
export function lessonLines(lessons: Lesson[]): string[] {
  if (!lessons.length) return [];
  return [
    'WHERE YOU HAVE BEEN WRONG BEFORE. Each was checked and found false. Before raising anything, ask whether one of these applies; if it does, the note is probably the same mistake. Do not raise any of these claims again unless the ledger itself has changed:',
    ...lessons.map((l) => `  • You said "${l.title}". ${l.by === 'owner' ? 'John' : 'A double-check'} found it wrong: ${l.lesson}`),
  ];
}
