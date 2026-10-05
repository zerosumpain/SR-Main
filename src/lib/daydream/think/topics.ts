// src/lib/daydream/think/topics.ts
//
// When a new research note is about the same SUBJECT as an older one he has
// not answered yet. PURE.
//
// The Barns Ness geology walk reached the feed three times in four days (2, 3
// and 5 October 2026): Hutton exhibitions, a walk on 1 November, a walk on 16
// October. Each was a different sentence from a different source, so neither
// guard caught it — the exact dedupe key differs, and `liveEchoOf` asks
// whether two notes make the same CLAIM (shared source rows, or titles ≥ 0.6
// alike). They did not; they shared a subject. Three cards asking him to book
// three things is worse than one card with the newest find.
//
// So for the research family only: a new note supersedes older, UNANSWERED
// notes that name the same proper nouns. Answered notes (rated, ruled on,
// acted on, checked) are his record and are never touched. The new card says
// what it replaced, so nothing disappears silently.

/** The kinds this applies to: what a research cycle writes. */
export const TOPIC_KINDS = ['think_suggest', 'think_research'] as const;
/** How far back a subject counts as "the same conversation". */
export const TOPIC_WINDOW_DAYS = 14;

const NOT_NAMES = new Set([
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'john', 'jkai', 'the', 'a', 'an', 'try', 'book', 'use', 'read', 'see', 'visit', 'go', 'add', 'new', 'now',
]);

/** Capitalised words that are not the first word: the names in a title. */
export function namesIn(title: string): Set<string> {
  const out = new Set<string>();
  const words = title.split(/[\s–—\-/,:;()"“”'’]+/).filter(Boolean);
  words.forEach((w, i) => {
    if (i === 0) return;
    const bare = w.replace(/[^A-Za-z0-9]/g, '');
    if (bare.length < 3 || !/^[A-Z]/.test(bare)) return;
    const lower = bare.toLowerCase();
    if (!NOT_NAMES.has(lower)) out.add(lower);
  });
  return out;
}

/** Two titles name the same subject: at least two names in common. */
export function sameTopic(a: string, b: string): boolean {
  const x = namesIn(a);
  const y = namesIn(b);
  let shared = 0;
  for (const n of x) if (y.has(n)) shared++;
  return shared >= 2;
}

export interface TopicCandidate {
  id: string;
  kind: string;
  title: string;
  createdAt: Date;
  /** Anything he did with it: a rating, a ruling, a note, an action, a check. */
  answered: boolean;
}

/** The older notes a new one replaces. Never itself, never an answered one. */
export function supersededBy(
  fresh: { id: string; kind: string; title: string; createdAt: Date },
  older: readonly TopicCandidate[],
): TopicCandidate[] {
  if (!(TOPIC_KINDS as readonly string[]).includes(fresh.kind)) return [];
  const floor = fresh.createdAt.getTime() - TOPIC_WINDOW_DAYS * 86_400_000;
  return older.filter(
    (o) =>
      o.id !== fresh.id &&
      (TOPIC_KINDS as readonly string[]).includes(o.kind) &&
      !o.answered &&
      o.createdAt.getTime() >= floor &&
      o.createdAt.getTime() <= fresh.createdAt.getTime() &&
      sameTopic(fresh.title, o.title),
  );
}

/** The `proposed_actions` entry that records what a note replaced. Carries
 *  `done` so the think loop's re-proposal keeps it (`thought-store.ts`). */
export const REPLACES_KIND = 'replaces';

export function replacesEntry(replaced: ReadonlyArray<{ id: string; title: string }>, now: Date) {
  return {
    kind: REPLACES_KIND,
    label: `Replaces ${replaced.length} earlier note${replaced.length === 1 ? '' : 's'} on the same subject`,
    payload: JSON.stringify(replaced.map((r) => ({ id: r.id, title: r.title }))),
    done: { at: now.toISOString() },
  };
}

export function readReplaces(actions: unknown): Array<{ id: string; title: string }> {
  if (!Array.isArray(actions)) return [];
  const entry = (actions as Array<{ kind?: unknown; payload?: unknown }>).find((a) => a?.kind === REPLACES_KIND);
  if (!entry || typeof entry.payload !== 'string') return [];
  try {
    const v = JSON.parse(entry.payload) as unknown;
    return Array.isArray(v) ? v.filter((r): r is { id: string; title: string } => typeof r?.id === 'string' && typeof r?.title === 'string') : [];
  } catch {
    return [];
  }
}
