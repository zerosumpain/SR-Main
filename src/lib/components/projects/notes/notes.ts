// notes.ts — the pure rules behind /projects read as notes
// ($lib/components/projects/notes): how a project is filed on the contents
// page, which coloured pencil marks its kind, how far off true its index card
// is pinned, and the tally of the bench by family. Pure and seeded from the
// project's key, so the server and the browser draw the same page and the
// rules are unit tests (notes.test.ts).

import { plural, sayCount, type ProjectCounts, type ProjectEntry, type ProjectFamily } from './views';

/** The family, as the word pencilled beside its dot. */
export const FAMILY_WORD: Record<ProjectFamily, string> = {
  study: 'field study',
  game: 'game',
  tool: 'tool',
  agent: 'by an agent',
};

/**
 * One pencil per family, in the notes-paper kit's order (orange, petrol,
 * olive, ochre), on the paper and on the ink cover. Never the only signal:
 * the family's word is always written beside its dot.
 */
export const FAMILY_PENCIL: Record<ProjectFamily, { paper: string; ink: string }> = {
  study: { paper: 'var(--accent)', ink: 'var(--accent-on-dark)' },
  game: { paper: 'var(--accent-ink)', ink: 'var(--accent-ink-on-dark)' },
  tool: { paper: 'var(--good)', ink: '#a8b986' },
  agent: { paper: '#8c6a12', ink: '#d6b25a' },
};

/** A small stable hash of a word (FNV-1a), for seeds and tilts. */
export function hashKey(key: string): number {
  let h = 2166136261;
  for (const ch of key) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * How far off true a card is pinned, in degrees: between 0.4 and 1.4 either
 * way, never dead straight (a straight card reads as printed, not pinned), and
 * the same for the same key on every visit.
 */
export function tiltFor(key: string): number {
  const h = hashKey(key);
  const mag = 0.4 + ((h >>> 1) % 11) / 10;
  return Math.round((h & 1 ? mag : -mag) * 10) / 10;
}

/**
 * What holds a card to the page. Agent builds are taped in (they arrived
 * from elsewhere); hand-built cards are mostly pinned, with the odd one taped.
 */
export function fixingFor(e: Pick<ProjectEntry, 'key' | 'section'>): 'pin' | 'tape' {
  if (e.section === 'agent') return 'tape';
  return hashKey(`${e.key}:fix`) % 4 === 0 ? 'tape' : 'pin';
}

/**
 * The name a project goes by on the contents page: the title up to its dash
 * ("Marbler" for "Marbler — a marble race built on luck"). The card below
 * keeps the whole title.
 */
export function shortTitle(title: string): string {
  const cut = title.split(/\s+[—–]\s+/)[0]?.trim();
  return cut || title.trim();
}

/** The anchor of a project's card, for the contents page to point at. */
export function cardId(key: string): string {
  return `pn-${key.replace(/[^a-z0-9_-]+/gi, '-')}`;
}

/** The project's chips, split back into the separate notes they are (`a · b · c`). */
export function chipList(chips: string): string[] {
  return chips
    .split('·')
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface TallyRow {
  family: ProjectFamily;
  count: number;
  /** `field studies`, `games`… as the margin label. */
  label: string;
  /** The count said in words, for a screen reader: `six field studies`. */
  spoken: string;
  /** The italic aside: what the original page said of each kind, kept short. */
  aside: string;
}

/**
 * The bench by family, tallied on the cover. The agent row only appears when
 * the agent's page does (`showAgent`), so the cover never counts a section
 * the reader cannot turn to.
 */
export function tallyRows(counts: ProjectCounts, showAgent: boolean): TallyRow[] {
  const rows: TallyRow[] = [
    {
      family: 'study',
      count: counts.studies,
      label: 'field studies',
      spoken: plural(counts.studies, 'field study', 'field studies'),
      aside: 'long-form, interactive.',
    },
    { family: 'game', count: counts.games, label: 'games', spoken: plural(counts.games, 'game'), aside: 'to play, or to watch.' },
    { family: 'tool', count: counts.tools, label: 'tools', spoken: plural(counts.tools, 'tool'), aside: 'each had a job to do.' },
  ];
  if (showAgent) {
    rows.push({
      family: 'agent',
      count: counts.agent,
      label: 'by an agent',
      spoken: `${sayCount(counts.agent)} by an agent`,
      aside: counts.agent ? 'from a single prompt.' : 'none yet.',
    });
  }
  return rows;
}

/** The bench count's aside: what the owner can see that nobody else can, or nothing to add. */
export function benchAside(counts: ProjectCounts, owner: boolean): string {
  if (owner && counts.hidden > 0) return `${sayCount(counts.hidden)} of them only I can see.`;
  return 'live, and open to poke at.';
}

/** The pinned card's line under the hand-built count. */
export function handAside(agentCount: number, showAgent: boolean): string {
  if (!showAgent) return 'every one of them.';
  if (agentCount === 0) return 'and none by an agent, yet.';
  return `and ${sayCount(agentCount)} by an agent.`;
}
