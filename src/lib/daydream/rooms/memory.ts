// src/lib/daydream/rooms/memory.ts
//
// ── PURE. Nothing here may reach `$lib/db` ────────────────────────────────
//
// What the Memory room needs that neither `$lib/daydream/memories` (the shared
// pure module for the store) nor `$lib/daydream/priority` (the one colour
// authority) already gives it. Three things, and deliberately nothing else:
//
//   1. `RulingListRow` — a browser-safe mirror of `rulings.ts`'s `RulingRow`.
//      That module reaches the database, so importing its type into a
//      component is how `$env/dynamic/private` ends up in the browser bundle:
//      a hard BUILD failure that `svelte-check` passes clean. The monolith
//      solved this by redeclaring the shape inline in the page; one named type
//      the page, the card and the loader all agree on is the same fix without
//      the copies.
//
//   2. `rulingTone` — `priority.ts`'s `verdictTone` answers a DIFFERENT
//      question. Its vocabulary is a hypothesis verdict (supported /
//      wrong_direction / underpowered); a reviewer's ruling has three other
//      words, and `refuted` means the opposite thing here. A refuted
//      hypothesis is a line of enquiry that closed quietly; a refuted ruling is
//      a binding prohibition — the loudest row on the page, and the only
//      mechanism that stops the same disproven claim being proposed under a
//      new name. So it maps to `urgent`, not `steady`.
//
//   3. `memoryTone` — a raw memory is coloured by what the nightly pass DID
//      with it, not by its category. Derived from the row through `memoryUse`,
//      so "this binds" has exactly one definition.
//
// All three return `Tone` from `priority.ts`; no `t-*` class is written by
// hand from a database word anywhere in the room.

import type { Tone } from '$lib/daydream/priority';
import { memoryUse, type DaydreamMemory } from '$lib/daydream/memories';

/** Mirrors `RulingRow` in `$lib/daydream/rulings` — see the header. */
export interface RulingListRow {
  id: string;
  kind: string;
  title: string;
  verdict: string | null;
  likelihood: number | null;
  reasoning: string | null;
  sources: string[];
  model: string | null;
  /** Null means the verdict never reached the store the engine reads. */
  memoryId: string | null;
  ruledAt: string | null;
}

export type RulingFilter = 'all' | 'refuted' | 'verified' | 'uncertain';

/** A reviewer's ruling wears the review tone — decided in `priority.ts`, the
 *  one place colour comes from. (`verdictTone` there speaks the HYPOTHESIS
 *  vocabulary and is the wrong instrument for a ruling.) */
export { reviewTone as rulingTone } from '../priority';

/** The verdict in the owner's words rather than the column's. */
export function rulingWord(verdict: string | null | undefined): string {
  if (verdict === 'refuted') return 'did not hold';
  if (verdict === 'verified') return 'held up';
  return 'cannot tell';
}

/** What the nightly pass did with a raw memory, as a tone. */
export function memoryTone(
  m: Pick<DaydreamMemory, 'category' | 'origin' | 'verdict' | 'consolidatedAt' | 'themeIds'>,
): Tone {
  if (memoryUse(m).binding) return 'urgent';
  if (m.consolidatedAt == null) return 'watch';
  return m.themeIds.length ? 'steady' : 'quiet';
}

/** A theme kind, as a heading. Unknown kinds keep their own word rather than
 *  disappearing — `kind` is a narrow union today and an open column tomorrow. */
export function themeKindLabel(kind: string): string {
  if (kind === 'value') return 'Values to respect';
  if (kind === 'lesson') return 'Lessons to consider';
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}
