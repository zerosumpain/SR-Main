// The /projects sentence view's words: the bench read out as one sentence
// built from the counts, the bridge line under it, the chapter headings, the
// titles split into a name and a dek, and the line that beats once per
// project. Pure, so sentence.test.ts can pin every zero and every plural.
//
// The sentence never says "no games": a family with nothing in it drops its
// clause, as a writer would, rather than report an absence.

import { plural, sayCount, type ProjectCounts, type ProjectEntry, type ProjectFamily } from '$lib/projects/views';

export type Seg =
  | { t: 'text'; s: string }
  /** The total: set as a figure, but plain (no colour, no note). */
  | { t: 'total'; word: string }
  /** A family's count: coloured, footnoted, a link to its entries. */
  | { t: 'fig'; id: ProjectFamily; word: string; n: number; end?: string };

const FAMILY_WORDS: Record<Exclude<ProjectFamily, 'agent'>, [string, string]> = {
  study: ['field study', 'field studies'],
  game: ['game', 'games'],
  tool: ['tool', 'tools'],
};

const text = (s: string): Seg => ({ t: 'text', s });
/** "made by hand" after one, "both" after two, "all" after more. */
const quantifier = (k: number) => (k === 1 ? '' : k === 2 ? 'both ' : 'all ');

/**
 * "There are fifteen things on the bench: six field studies, three games and
 * four tools I made by hand, and two an agent wrote from a single prompt."
 * Footnotes are numbered in reading order, so the first coloured figure is 1.
 * When everything on the bench is one kind, that kind is the total.
 */
export function benchSentence(c: Pick<ProjectCounts, 'bench' | 'studies' | 'games' | 'tools' | 'agent'>): Seg[] {
  return glue(say(c));
}

/**
 * A comma straight after a figure goes before its note numeral, as type sets
 * a note mark ("six field studies,¹"), not after it.
 */
function glue(segs: Seg[]): Seg[] {
  const out: Seg[] = [];
  for (const s of segs) {
    const prev = out[out.length - 1];
    if (s.t === 'text' && prev?.t === 'fig' && /^[,.;:]/.test(s.s)) {
      out[out.length - 1] = { ...prev, end: s.s[0] };
      if (s.s.length > 1) out.push(text(s.s.slice(1)));
    } else out.push(s);
  }
  return out;
}

function say(c: Pick<ProjectCounts, 'bench' | 'studies' | 'games' | 'tools' | 'agent'>): Seg[] {
  if (c.bench <= 0) return [text('There is nothing on the bench just now.')];

  let n = 0;
  const hand = (
    [
      ['study', c.studies],
      ['game', c.games],
      ['tool', c.tools],
    ] as const
  )
    .filter(([, k]) => k > 0)
    .map(([id, k]): Seg => ({ t: 'fig', id, word: plural(k, ...FAMILY_WORDS[id]), n: ++n }));
  const handTotal = c.studies + c.games + c.tools;
  const is = `There ${c.bench === 1 ? 'is' : 'are'} `;

  // One kind of thing only: it is the total.
  if (c.agent === 0 && hand.length === 1) {
    return [text(is), hand[0], text(` on the bench, ${quantifier(handTotal)}made by hand.`)];
  }
  if (handTotal === 0) {
    return [
      text(is),
      { t: 'fig', id: 'agent', word: plural(c.agent, 'thing'), n: 1 },
      text(` on the bench, ${quantifier(c.agent)}written by an agent from a single prompt.`),
    ];
  }

  const list: Seg[] = [];
  hand.forEach((f, i) => {
    if (i > 0) list.push(text(i === hand.length - 1 ? ' and ' : ', '));
    list.push(f);
  });
  const segs: Seg[] = [text(is), { t: 'total', word: plural(c.bench, 'thing') }, text(' on the bench: '), ...list];
  if (c.agent === 0) return [...segs, text(`, ${quantifier(handTotal)}made by hand.`)];
  return [
    ...segs,
    text(' I made by hand, and '),
    { t: 'fig', id: 'agent', word: sayCount(c.agent), n: n + 1 },
    text(' an agent wrote from a single prompt.'),
  ];
}

/** The italic line that carries the sentence down onto the paper. */
export function bridgeLine(bench: number, chapters: number): string {
  if (bench <= 0) return 'That’s the whole of it for now. The chapters below fill up as things get made.';
  return `That’s the short version. The long one takes ${plural(chapters, 'chapter')}, a paragraph to each ${bench === 1 ? 'thing' : 'project'}.`;
}

/**
 * "The field studies, games & tools", from the families actually in the
 * chapter. Always plural: it names the kinds, as a section of a shop does.
 */
export function handHeading(entries: Pick<ProjectEntry, 'family'>[]): string {
  const words = (['study', 'game', 'tool'] as const).filter((f) => entries.some((e) => e.family === f)).map((f) => FAMILY_WORDS[f][1]);
  if (!words.length) return 'Made by hand';
  const last = words.pop()!;
  return `The ${words.length ? `${words.join(', ')} & ${last}` : last}`;
}

/** A title as a name and a dek: "Marbler — a marble race built on luck". */
export function splitTitle(title: string): { name: string; dek: string | null } {
  const m = /^(.+?)(?:\s+[—–]\s+|:\s+)(.+)$/.exec(title.trim());
  if (!m) return { name: title.trim(), dek: null };
  return { name: m[1], dek: m[2] };
}

/** The entry's number as it is set in the margin: two figures. */
export const entryNumber = (n: number): string => String(n).padStart(2, '0');

/**
 * The line under the masthead: a flat trace with one beat per project, in
 * reading order, in a 1000-wide box (stretched to the page). Each beat is its
 * own path so it can carry its section's colour; the flat between beats is
 * the `base`.
 */
export function benchLine(sections: ProjectEntry['section'][], h = 56): { base: string; beats: { d: string; section: ProjectEntry['section'] }[] } {
  const W = 1000;
  const y = Math.round(h * 0.66 * 10) / 10;
  const r = (v: number) => Math.round(v * 10) / 10;
  const count = sections.length;
  if (!count) return { base: `M0,${y} L${W},${y}`, beats: [] };
  // A little air at either end, then even slots; the complex fills the middle of its slot.
  const pad = 24;
  const slot = (W - pad * 2) / count;
  const w = Math.min(slot * 0.72, 54);
  const top = r(h * 0.06);
  const dip = r(h * 0.94);
  const beats = sections.map((section, i) => {
    const x0 = pad + i * slot + (slot - w) / 2;
    const x = (t: number) => r(x0 + t * w);
    const d =
      `M${x(0)},${y} Q${x(0.12)},${r(y - h * 0.12)} ${x(0.24)},${y} L${x(0.34)},${y} L${x(0.38)},${r(y + h * 0.07)}` +
      ` L${x(0.44)},${top} L${x(0.5)},${dip} L${x(0.55)},${y} L${x(0.66)},${y} Q${x(0.83)},${r(y - h * 0.2)} ${x(1)},${y}`;
    return { d, section };
  });
  return { base: `M0,${y} L${W},${y}`, beats };
}
