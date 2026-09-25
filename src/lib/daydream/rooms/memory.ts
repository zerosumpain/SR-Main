// src/lib/daydream/rooms/memory.ts
//
// ── PURE. Nothing here may reach `$lib/db` ────────────────────────────────
//
// What the Memory room needs that neither `$lib/daydream/memories` (the shared
// pure module for the store) nor `$lib/daydream/priority` (the one colour
// authority) already gives it.
//
//   `memoryTone` — a raw memory is coloured by what the nightly pass DID with
//   it, not by its category. Derived from the row through `memoryUse`, so
//   "this binds" has exactly one definition.
//
// The reviewer's rulings list (and its row type, filter and tone) went with the
// reviewer in P4a (2026-09-25).

import type { Tone } from '$lib/daydream/priority';
import { memoryUse, type DaydreamMemory } from '$lib/daydream/memories';

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
