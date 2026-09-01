// src/lib/daydream/memories.ts
//
// What the engine actually remembers, and what each memory does.
//
// ── The question this answers ──────────────────────────────────────────────
//
// The owner's words: "I want the memories page cards to be categorised, and for
// them to highlight the key attributes that are being remembered (ie how are
// these being woven into future daydreams?) I'm not sure if it's the specific
// fact that's remembered, or the concept."
//
// The answer is the specific fact, verbatim, and the page should say so rather
// than leave it to be inferred. `pack.ts` does this and nothing more:
//
//     add('past', { kind: 'memory', id: m.id }, `Known (${m.category}): ${m.content}`)
//
// One card per memory, holding the exact sentence that was stored. Nothing
// generalises it, nothing summarises it, and no embedding stands between the
// sentence and the prompt. So a memory is only ever as useful as the sentence
// is — which is why every writer in this codebase composes a whole, quotable
// claim rather than a fragment, and why this module reports the sentence rather
// than a pretty version of it.
//
// ── PURE. The query lives in `memories.server.ts` ─────────────────────────
//
// Split because the daydreams page imports `memoryUse` and `groupByCategory`
// to render the cards, and any module that reaches `$lib/db` drags
// `$env/dynamic/private` into the browser bundle — which is not a lint warning,
// it is a hard build failure ("Cannot import $env/dynamic/private into code
// that runs in the browser"). `svelte-check` passes on it; only `npm run build`
// says so. Same shape as `intel/resolve/conflation.ts` and its `.server`
// sibling.
//
// ── Why the memory table, and not the rulings ──────────────────────────────
//
// `rulings.ts` lists what the REVIEWER settled, read off `daydream_thoughts`.
// That is one writer. `jkai_memories` is the store, and three other things
// write into it that shape a daydream just as much: a note John typed on a
// card (`notes.ts`), a place he named (`places.ts`), and anything the chat
// itself chose to remember. Listing only the rulings answered "what has it
// checked" when the question was "what does it know".
//
// The origin is recovered by joining back rather than by adding a column: the
// links already exist and point the other way (`review_memory_id`,
// `note_memory_id`, `daydream_places.memory_id`), so a new `source` column
// would be a second copy of a fact already recorded — free to write and free to
// disagree with itself later.

/**
 * How many live memories reach one ponder pack.
 *
 * Mirrors `PACK_LIMITS.memories`. Duplicated as a named constant rather than
 * imported because `pack.ts` pulls in the whole snapshot type graph, and this
 * module is read by a page load; the test asserts the two agree, which is the
 * cheap half of an import without the cost.
 */
export const MEMORIES_PER_PACK = 16;

export type MemoryOrigin = 'ruling' | 'note' | 'place' | 'elsewhere';

export interface DaydreamMemory {
  id: string;
  category: string;
  /** The exact sentence. This string, unaltered, is what a pack card holds. */
  content: string;
  confidence: string;
  createdAt: string;
  origin: MemoryOrigin;
  /** The thought this was written about, when it was written about one. */
  thoughtId: string | null;
  thoughtTitle: string | null;
  thoughtKind: string | null;
  /** The reviewer's verdict, for a ruling. Null for every other origin. */
  verdict: string | null;
  likelihood: number | null;
  /** The place this names, when it names one. */
  placeLabel: string | null;
}

/** Where a memory came from, in the owner's terms rather than a column name. */
export const ORIGIN_LABEL: Record<MemoryOrigin, string> = {
  ruling: 'It went and checked',
  note: 'You told it',
  place: 'You named a place',
  elsewhere: 'From a conversation',
};

/**
 * What this memory DOES — the half the owner asked about.
 *
 * Deterministic, and derived from the row rather than written by anything, so
 * it cannot claim a mechanism that is not running. Two mechanisms exist and
 * they are not equal:
 *
 *   1. Every live memory is carded into the ponder pack, verbatim. That makes
 *      it MATERIAL: the proposer may reason over it, cite it, or ignore it.
 *   2. A refuted ruling is additionally repeated in `refutedBlock` — a hard
 *      instruction not to propose the claim again in any wording. That is the
 *      only one of the two that BINDS.
 *
 * The distinction is worth printing, because "it remembers this" and "it will
 * never say this again" read the same on a card and are very different
 * promises. The Canva misreading came round eight times under eight names while
 * only mechanism 1 was in place.
 */
export function memoryUse(m: Pick<DaydreamMemory, 'category' | 'origin' | 'verdict'>): {
  lines: string[];
  binding: boolean;
} {
  const lines = [
    `Carded into every ponder pack, verbatim, as “Known (${m.category}): …” — the proposer ` +
      'reads it as material and may reason over it or ignore it.',
  ];
  const binding = m.origin === 'ruling' && m.verdict === 'refuted';
  if (binding) {
    lines.push(
      'Also repeated in the refutation block, which tells the proposer never to raise this ' +
        'claim again in any wording. This is the one that binds — rewording it is still ' +
        'proposing it.',
    );
  }
  if (m.origin === 'place') {
    lines.push(
      'A named place also un-mutes the detectors that stay silent until a place has a name, ' +
        'so this one changes what can be noticed at all.',
    );
  }
  if (m.origin === 'note') {
    lines.push(
      'Read by the rest of jkai too, not only by daydreaming — it is a memory in the shared ' +
        'store rather than one feature’s private column.',
    );
  }
  return { lines, binding };
}

/**
 * Group memories by category, in a fixed order.
 *
 * Pure so the ordering is testable. `jkai_memories.category` is an open text
 * column, so an unknown category must not be dropped — it lands after the known
 * ones rather than disappearing, which is the failure a hard-coded switch would
 * have produced silently.
 */
export const CATEGORY_ORDER = [
  'situations',
  'places',
  'people',
  'preferences',
  'health',
  'devices',
] as const;

export function groupByCategory<T extends { category: string }>(
  rows: T[],
): Array<{ category: string; items: T[] }> {
  const byCat = new Map<string, T[]>();
  for (const r of rows) {
    const key = r.category || 'uncategorised';
    const list = byCat.get(key) ?? [];
    list.push(r);
    byCat.set(key, list);
  }
  const rank = (c: string) => {
    const i = (CATEGORY_ORDER as readonly string[]).indexOf(c);
    return i === -1 ? CATEGORY_ORDER.length : i;
  };
  return [...byCat.entries()]
    .map(([category, items]) => ({ category, items }))
    .sort((a, b) => rank(a.category) - rank(b.category) || a.category.localeCompare(b.category));
}
