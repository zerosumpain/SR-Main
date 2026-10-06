// The rambler's world, read off the page: the tops of marked elements become
// floors, and floors become a route map. Walking happens along a floor;
// dropping off an end and climbing a ladder move between them. Ladders are not
// placed by hand — wherever one floor sits above another and the two cannot yet
// reach each other, a ladder goes in, so any layout (four columns, one column,
// a missing section) ends up fully connected. Pure: rectangles in, map out.

export type Spot = 'lookout' | 'desk' | 'think' | 'gym' | 'bed' | 'garage';

export interface SceneryRect {
  key: number;
  x1: number;
  x2: number;
  /** The element's top edge, in page coordinates. */
  y: number;
  spot?: Spot;
  /** Where along the element the spot sits, 0 (left) to 1 (right). */
  at?: number;
  /** Lean a ladder against this side of the element, down to the floor below. */
  ladder?: 'left' | 'right';
}

export interface Floor {
  id: number;
  x1: number;
  x2: number;
  y: number;
  keys: number[];
  /** Inner edges where two merged elements meet: preferred ladder lines. */
  seams: number[];
}

export interface Ladder {
  x: number;
  top: Floor;
  bot: Floor;
}

export type Link =
  | { type: 'ladder'; from: Floor; to: Floor; fx: number; tx: number; ladder: Ladder }
  | { type: 'drop'; from: Floor; to: Floor; fx: number; tx: number; side: -1 | 1 };

export interface World {
  floors: Floor[];
  ladders: Ladder[];
  links: Link[];
  spots: Partial<Record<Spot, { floor: Floor; x: number }>>;
  margin: number;
}

export interface WorldOptions {
  /** Closest the character's origin may get to a floor's end. */
  margin: number;
  /** Half a ladder's drawn width, so two ladders never overlap. */
  ladderHalf: number;
  /** Page width: a side ladder is pulled in rather than drawn off the edge. */
  pageWidth?: number;
}

const MIN_FLOOR = 24;

export const clampTo = (w: World, x: number, f: Floor) => Math.max(f.x1 + w.margin, Math.min(f.x2 - w.margin, x));

export function buildWorld(rects: SceneryRect[], opts: WorldOptions): World {
  const m = opts.margin;
  const floors: Floor[] = [];
  const sorted = rects.filter((r) => r.x2 - r.x1 >= MIN_FLOOR).sort((a, b) => a.y - b.y || a.x1 - b.x1);
  for (const r of sorted) {
    const f = floors.find((q) => Math.abs(q.y - r.y) <= 2 && r.x1 <= q.x2 + 4 && r.x2 >= q.x1 - 4);
    if (f) {
      f.seams.push(r.x1 > f.x2 ? (r.x1 + f.x2) / 2 : r.x1 < f.x1 ? (r.x2 + f.x1) / 2 : r.x1);
      f.x1 = Math.min(f.x1, r.x1);
      f.x2 = Math.max(f.x2, r.x2);
      f.keys.push(r.key);
    } else {
      floors.push({ id: floors.length, x1: r.x1, x2: r.x2, y: Math.round(r.y), keys: [r.key], seams: [] });
    }
  }
  for (const f of floors) f.seams = f.seams.filter((s) => s > f.x1 + m && s < f.x2 - m);

  const world: World = { floors, ladders: [], links: [], spots: {}, margin: m };
  const inside = (x: number, f: Floor) => x >= f.x1 + m && x <= f.x2 - m;
  const below = (x: number, y: number) => {
    let best: Floor | null = null;
    for (const f of floors) if (f.y > y + 4 && x >= f.x1 && x <= f.x2 && (!best || f.y < best.y)) best = f;
    return best;
  };

  // Drops: step off either end and land on whatever is underneath.
  for (const f of floors) {
    for (const side of [-1, 1] as const) {
      const probe = (side < 0 ? f.x1 : f.x2) + side * 6;
      const to = below(probe, f.y);
      if (to) world.links.push({ type: 'drop', from: f, to, fx: clampTo(world, side < 0 ? f.x1 : f.x2, f), tx: clampTo(world, probe + side * 4, to), side });
    }
  }

  // Every place a ladder could stand: one floor directly above another.
  const pairs = new Map<string, { top: Floor; bot: Floor; xs: number[] }>();
  for (const top of floors) {
    for (let x = top.x1 + m; x <= top.x2 - m; x += 4) {
      const bot = below(x, top.y);
      if (!bot || !inside(x, bot)) continue;
      const k = `${top.id}:${bot.id}`;
      const p = pairs.get(k) ?? { top, bot, xs: [] };
      p.xs.push(x);
      pairs.set(k, p);
    }
  }

  // A ladder may stand just off a floor's end (against an element's side); he
  // walks to the floor's last step, then across to the ladder.
  const addLadder = (top: Floor, bot: Floor, x: number) => {
    const ladder: Ladder = { x: Math.round(x), top, bot };
    world.ladders.push(ladder);
    world.links.push({ type: 'ladder', from: bot, to: top, fx: clampTo(world, ladder.x, bot), tx: clampTo(world, ladder.x, top), ladder });
    world.links.push({ type: 'ladder', from: top, to: bot, fx: clampTo(world, ladder.x, top), tx: clampTo(world, ladder.x, bot), ladder });
  };
  for (const r of rects) {
    if (!r.ladder) continue;
    const top = floors.find((f) => f.keys.includes(r.key));
    const edge = opts.ladderHalf + 2;
    const want = r.ladder === 'right' ? r.x2 + opts.ladderHalf + 6 : r.x1 - opts.ladderHalf - 6;
    const x = Math.max(edge, Math.min((opts.pageWidth ?? Infinity) - edge, want));
    const bot = below(x, r.y);
    if (top && bot) addLadder(top, bot, x);
  }
  const clear = (x: number, top: Floor, bot: Floor) =>
    world.ladders.every((l) => Math.abs(l.x - x) > opts.ladderHalf * 2 + 6 || (l.top !== top && l.top !== bot && l.bot !== top && l.bot !== bot));
  const placeFor = (p: { top: Floor; bot: Floor; xs: number[] }) => {
    const lo = p.xs[0];
    const hi = p.xs[p.xs.length - 1];
    const mid = (lo + hi) / 2;
    // A seam between two cells is a wall to climb; otherwise the right-hand end
    // keeps the ladder clear of headings, which sit on the left.
    const seams = [...p.top.seams, ...p.bot.seams].filter((s) => s >= lo && s <= hi && clear(s, p.top, p.bot));
    if (seams.length) return seams.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid))[0];
    for (let x = hi; x >= lo; x -= 4) if (clear(x, p.top, p.bot) && p.xs.includes(x)) return x;
    return null;
  };

  for (let guard = 0; guard < 40; guard++) {
    const reach = reachability(world);
    let pick: { top: Floor; bot: Floor; xs: number[] } | null = null;
    for (const p of pairs.values()) {
      if (reach[p.bot.id].has(p.top.id) && reach[p.top.id].has(p.bot.id)) continue;
      if (!pick || p.bot.y - p.top.y < pick.bot.y - pick.top.y) pick = p;
    }
    if (!pick) break;
    const x = placeFor(pick);
    pairs.delete(`${pick.top.id}:${pick.bot.id}`);
    if (x !== null) addLadder(pick.top, pick.bot, x);
  }

  for (const r of rects) {
    if (!r.spot) continue;
    const floor = floors.find((f) => f.keys.includes(r.key));
    if (floor) world.spots[r.spot] = { floor, x: clampTo(world, r.x1 + (r.x2 - r.x1) * (r.at ?? 0.5), floor) };
  }
  return world;
}

function reachability(w: World): Set<number>[] {
  return w.floors.map((f) => {
    const seen = new Set([f.id]);
    const queue = [f];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const l of w.links) if (l.from === cur && !seen.has(l.to.id)) {
        seen.add(l.to.id);
        queue.push(l.to);
      }
    }
    return seen;
  });
}

const STEP_COST = { ladder: 70, drop: 24 };

/** The cheapest chain of drops and climbs from one floor to another, or null. */
export function route(w: World, from: Floor, fromX: number, to: Floor): Link[] | null {
  const dist = new Map<Floor, number>([[from, 0]]);
  const at = new Map<Floor, number>([[from, fromX]]);
  const prev = new Map<Floor, Link>();
  const open = new Set([from]);
  while (open.size) {
    let cur: Floor | null = null;
    for (const f of open) if (!cur || dist.get(f)! < dist.get(cur)!) cur = f;
    open.delete(cur!);
    if (cur === to) break;
    for (const l of w.links) {
      if (l.from !== cur) continue;
      const d = dist.get(cur)! + Math.abs(at.get(cur)! - l.fx) + STEP_COST[l.type] + (l.type === 'ladder' ? Math.abs(l.to.y - l.from.y) : 0);
      if (!dist.has(l.to) || d < dist.get(l.to)!) {
        dist.set(l.to, d);
        at.set(l.to, l.tx);
        prev.set(l.to, l);
        open.add(l.to);
      }
    }
  }
  if (!dist.has(to)) return null;
  const out: Link[] = [];
  for (let f = to; f !== from; f = prev.get(f)!.from) out.unshift(prev.get(f)!);
  return out;
}
