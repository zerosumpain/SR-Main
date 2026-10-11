// /projects read as a place: the index drawn as a town. Every project on the
// page is one building on one street, its quarter its family: the field
// studies are civic buildings, the games a funfair, the tools the works and
// what an agent built the new glass towers. Below the skyline the same
// buildings stand on their plots, one quarter at a time.
//
// Pure: entries in, path strings and positions out. Each building's shape is
// drawn in its own box (x across, y down, the street at y = h) so the
// skyline and a plot draw the same building at any size, and nothing is
// measured in the browser. Shapes come from the entry's key, so a project
// keeps its building from one visit to the next.

import { seeded } from '$lib/landing/place-city';
import { facade, VARIANTS, type Facade, type Variant } from '$lib/components/projects/place/facade';
import type { ProjectCounts, ProjectEntry, ProjectFamily } from './views';

const r1 = (n: number) => Math.round(n * 10) / 10;
const rect = (x: number, y: number, w: number, h: number) => (w <= 0 || h <= 0 ? '' : `M${r1(x)},${r1(y)}h${r1(w)}v${r1(h)}h${r1(-w)}Z`);
const seg = (x1: number, y1: number, x2: number, y2: number) => `M${r1(x1)},${r1(y1)}L${r1(x2)},${r1(y2)}`;

/* ------------------------------------------------------------ quarters */

export interface Quarter {
  id: ProjectFamily;
  /** The fragment the fingerpost points at. */
  anchor: string;
  name: string;
  /** What its buildings are, for the key. */
  building: string;
  /** The sentence under its name. */
  strap: string;
  /** Built by hand or by an agent: the original page's two sections. */
  built: 'by hand' | 'by an agent';
}

export const QUARTERS: Record<ProjectFamily, Quarter> = {
  study: {
    id: 'study',
    anchor: 'pp-studies',
    name: 'The Field Studies quarter',
    building: 'Civic',
    strap: 'Long-form arguments you can operate rather than read.',
    built: 'by hand',
  },
  game: {
    id: 'game',
    anchor: 'pp-arcade',
    name: 'The Arcade',
    building: 'Funfair',
    strap: 'Games and simulations, made to be played rather than read.',
    built: 'by hand',
  },
  tool: {
    id: 'tool',
    anchor: 'pp-works',
    name: 'The Works',
    building: 'Works',
    strap: 'A few tools that had a job to do.',
    built: 'by hand',
  },
  agent: {
    id: 'agent',
    anchor: 'pp-newtown',
    name: 'The New Town',
    building: 'Glass tower',
    strap: 'One prompt in, a working page out. The iteration count is how many passes it took.',
    built: 'by an agent',
  },
};

/** The street's order, left to right, and the page's below it. */
export const ORDER: ProjectFamily[] = ['study', 'game', 'tool', 'agent'];

/** The entries in each quarter, in page order, quarters with nobody in them left out (the New Town stays for the owner). */
export function quarters(hand: ProjectEntry[], agent: ProjectEntry[], showAgent: boolean) {
  const all = [...hand, ...(showAgent ? agent : [])];
  return ORDER.flatMap((id) => {
    const entries = all.filter((e) => e.family === id);
    if (!entries.length && !(id === 'agent' && showAgent)) return [];
    return [{ quarter: QUARTERS[id], entries }];
  });
}

/** A title's short name for a sign: what comes before its dash or colon. */
export function shortName(title: string): string {
  const cut = title.split(/\s+[—–]\s+|:\s+/)[0].trim();
  return cut.length >= 3 ? cut : title;
}

/* ------------------------------------------------------------ buildings */

// The drawings themselves (one per family) live beside the view that fills them.
export { facade, type Facade, type Material, type Variant } from '$lib/components/projects/place/facade';

/** A building's variant, width share and height share: its family's, varied by its key. */
export function shapeOf(e: Pick<ProjectEntry, 'key' | 'family'>, index: number): { variant: Variant; weight: number; height: number } {
  const rnd = seeded(e.key);
  const list = VARIANTS[e.family];
  // In turn down the quarter, so neighbours differ; the size is the key's own.
  const variant = list[index % list.length];
  const a = rnd();
  const b = rnd();
  switch (e.family) {
    case 'study':
      return { variant, weight: 1.15 + 0.3 * a, height: 0.5 + 0.26 * b };
    case 'game':
      return variant === 'wheel'
        ? { variant, weight: 1.8 + 0.2 * a, height: 0.62 + 0.18 * b }
        : variant === 'helter'
          ? { variant, weight: 0.78 + 0.16 * a, height: 0.56 + 0.2 * b }
          : { variant, weight: 1.2 + 0.24 * a, height: 0.4 + 0.16 * b };
    case 'tool':
      return { variant, weight: 1.45 + 0.35 * a, height: (variant === 'sawtooth' ? 0.3 : 0.44) + 0.16 * b };
    default:
      return { variant, weight: 0.72 + 0.22 * a, height: 0.76 + 0.22 * b };
  }
}

/* --------------------------------------------------------------- street */

export type Fit = 'wide' | 'narrow';

interface Geometry {
  W: number;
  H: number;
  /** Between two buildings in a quarter, and between two quarters. */
  gap: number;
  street: number;
  /** The most a unit of building weight may take, so a short street stays a street. */
  cap: number;
  /** Room at each end. */
  end: number;
  /** A callout's width in street units, for keeping two apart, and its two heights. */
  label: number;
}

export const GEOMETRY: Record<Fit, Geometry> = {
  wide: { W: 1000, H: 240, gap: 6, street: 40, cap: 74, end: 10, label: 160 },
  narrow: { W: 380, H: 220, gap: 2.5, street: 14, cap: 46, end: 4, label: 146 },
};

export interface Lot {
  entry: ProjectEntry;
  variant: Variant;
  /** Left edge and width in street units; the building's height and its highest point, up from the street. */
  x: number;
  w: number;
  h: number;
  roof: number;
  facade: Facade;
}

export interface Span {
  id: ProjectFamily;
  /** The quarter's number on the fingerpost. */
  no: number;
  x: number;
  w: number;
}

export interface Callout {
  id: 'bench' | 'studies' | 'agent';
  kicker: string;
  value: string;
  unit: string;
  sub: string;
  /** Where its leader meets a roof: x a share of the street, y a share of its height up from the street. */
  x: number;
  y: number;
  /** 0 just over the skyline, 1 a step higher. */
  tier: 0 | 1;
  /** Which side of its leader the words hang. */
  hang: 'l' | 'r';
}

export interface Street {
  fit: Fit;
  W: number;
  H: number;
  lots: Lot[];
  spans: Span[];
  /** The New Town's empty plot, while nothing stands in it (the owner's view only). */
  vacant: { x: number; w: number } | null;
  /** Trees and lamp posts in the gaps between quarters, x in street units. */
  trees: number[];
  callouts: Callout[];
}

/** The whole index as one street, quarter by quarter, at one of the two fits. */
export function street(hand: ProjectEntry[], agent: ProjectEntry[], showAgent: boolean, counts: ProjectCounts, owner: boolean, fit: Fit): Street {
  const g = GEOMETRY[fit];
  const qs = quarters(hand, agent, showAgent);
  const plan = qs.map(({ quarter, entries }) => ({
    id: quarter.id,
    items: entries.map((e, i) => ({ e, ...shapeOf(e, i) })),
    vacant: entries.length === 0,
  }));
  const weightOf = (p: (typeof plan)[number]) => (p.vacant ? 1.6 : p.items.reduce((s, it) => s + it.weight, 0));
  const total = plan.reduce((s, p) => s + weightOf(p), 0);
  const inner = plan.reduce((s, p) => s + Math.max(0, p.items.length - 1) * g.gap, 0);
  const between = Math.max(0, plan.length - 1) * g.street;
  const room = g.W - 2 * g.end - inner - between;
  const unit = total ? Math.min(g.cap, room / total) : 0;
  // A short street spreads its quarters out rather than stretch its buildings.
  const spare = room - unit * total;
  const pad = plan.length ? spare / (plan.length + 1) : 0;

  const lots: Lot[] = [];
  const spans: Span[] = [];
  const trees: number[] = [];
  let vacant: Street['vacant'] = null;
  let at = g.end + pad;
  plan.forEach((p, qi) => {
    const from = at;
    if (p.vacant) {
      const w = 1.6 * unit;
      vacant = { x: at, w };
      at += w;
    } else
      p.items.forEach((it, i) => {
        const w = it.weight * unit;
        let h = Math.min(g.H - 2, it.height * g.H);
        let f = facade(it.e, it.variant, w, h);
        // A shape held by its width (a big wheel on a narrow plot) gets a box only as tall as it is drawn.
        if (f.top > 1) {
          h -= f.top;
          f = facade(it.e, it.variant, w, h);
        }
        lots.push({ entry: it.e, variant: it.variant, x: at, w, h, roof: h - f.top, facade: f });
        at += w + (i < p.items.length - 1 ? g.gap : 0);
      });
    spans.push({ id: p.id, no: qi + 1, x: from, w: at - from });
    if (qi < plan.length - 1) {
      trees.push(at + (g.street + pad) / 2);
      at += g.street + pad;
    }
  });

  return { fit, W: g.W, H: g.H, lots, spans, vacant, trees, callouts: callouts(lots, vacant, showAgent, counts, owner, g) };
}

/** The three readings pinned to the picture: on the bench, the field studies, what an agent built. */
function callouts(lots: Lot[], vacant: Street['vacant'], showAgent: boolean, counts: ProjectCounts, owner: boolean, g: Geometry): Callout[] {
  const tallest = (pick: (l: Lot) => boolean) => lots.filter(pick).reduce<Lot | null>((b, l) => (!b || l.roof > b.roof ? l : b), null);
  const pinAt = (l: Lot) => ({ x: (l.x + l.w / 2) / g.W, y: l.roof / g.H });
  const out: Array<Omit<Callout, 'tier' | 'hang'>> = [];
  const study = tallest((l) => l.entry.family === 'study');
  if (study && counts.studies > 0) out.push({ id: 'studies', kicker: 'Field studies', value: String(counts.studies), unit: 'long-form', sub: 'interactive', ...pinAt(study) });
  // On the bench: the tallest in the arcade or the works, else anything not already pinned.
  const agentLot = tallest((l) => l.entry.family === 'agent');
  const bench =
    tallest((l) => l.entry.family === 'game' || l.entry.family === 'tool') ?? tallest((l) => l !== study && l !== agentLot) ?? study ?? agentLot;
  if (bench && counts.bench > 0)
    out.push({
      id: 'bench',
      kicker: 'On the bench',
      value: String(counts.bench),
      unit: counts.bench === 1 ? 'project' : 'projects',
      sub: owner && counts.hidden > 0 ? `${counts.hidden} only you can see` : 'live and playable',
      ...pinAt(bench),
    });
  if (showAgent) {
    if (agentLot) out.push({ id: 'agent', kicker: 'Agent built', value: String(counts.agent), unit: 'from a prompt', sub: 'in the New Town', ...pinAt(agentLot) });
    else if (vacant) out.push({ id: 'agent', kicker: 'Agent built', value: 'None', unit: 'yet', sub: 'the plot is empty', x: (vacant.x + vacant.w / 2) / g.W, y: 0.12 });
  }
  // Left to right; each takes the lower step unless it would cover the one before it.
  out.sort((a, b) => a.x - b.x);
  const placed: Callout[] = [];
  const span = (c: { x: number; hang: 'l' | 'r' }) => {
    const x = c.x * g.W;
    return c.hang === 'r' ? [x - 6, x + g.label] : [x - g.label, x + 6];
  };
  const clash = (a: Callout, b: Callout) => {
    const [a0, a1] = span(a);
    const [b0, b1] = span(b);
    return a.tier === b.tier && a0 < b1 && b0 < a1;
  };
  for (const c of out) {
    const hang: 'l' | 'r' = c.x * g.W + g.label > g.W - 4 ? 'l' : 'r';
    const other: 'l' | 'r' = hang === 'l' ? 'r' : 'l';
    const all: Callout[] = [
      { ...c, tier: 0, hang },
      { ...c, tier: 1, hang },
      { ...c, tier: 0, hang: other },
      { ...c, tier: 1, hang: other },
    ];
    const tries = all.filter((t) => {
      const [a, b] = span(t);
      return a >= -2 && b <= g.W + 2;
    });
    placed.push(tries.find((t) => !placed.some((p) => clash(p, t))) ?? tries[0] ?? { ...c, tier: 1, hang });
  }
  return placed;
}

/* ---------------------------------------------------------- the distance */

/**
 * A row of plain towers for the distance, in a 1000 × 100 box stretched to
 * the width: blocks with flat roofs, a few stepped back, a few masts.
 * Scenery only, never a project.
 */
export function range(seed: string, count: number, lo: number, hi: number): { d: string; masts: string } {
  const rnd = seeded(seed);
  let d = '';
  let masts = '';
  let x = -4;
  const step = 1008 / count;
  while (x < 1004) {
    const w = step * (0.6 + rnd() * 0.8);
    const top = 100 - (lo + rnd() * (hi - lo));
    if (rnd() < 0.3) {
      const t2 = top - (4 + rnd() * 10);
      d += rect(x + w * 0.2, t2, w * 0.6, top - t2);
    }
    d += rect(x, top, w, 100 - top);
    if (rnd() < 0.12) masts += seg(x + w / 2, top, x + w / 2, top - 6 - rnd() * 8);
    x += w + rnd() * step * 0.25;
  }
  return { d, masts };
}
