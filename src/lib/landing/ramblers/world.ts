// The rambler's world, read off the page: the tops of marked elements become
// floors, and floors become a route map. Walking happens along a floor; he
// moves between floors the way a climber would, with nothing left standing on
// the page afterwards:
//
//   - a short gap he jumps;
//   - where an element's side comes down near the floor below, he scales that
//     side like a climbing wall (jumping up to grab it if it stops short);
//   - anywhere else he fires a grappling hook to the top edge and climbs the
//     rope, then reels it in. Going down he abseils, or steps off a ledge.
//
// Pure: rectangles in, map out.

export type Spot = 'lookout' | 'desk' | 'think' | 'gym' | 'bed' | 'garage';

export interface SceneryRect {
  key: number;
  x1: number;
  x2: number;
  /** The element's top edge, in page coordinates. */
  y: number;
  /** The element's bottom edge: how far down its sides run. */
  bottom?: number;
  spot?: Spot;
  /** Where along the element the spot sits, 0 (left) to 1 (right). */
  at?: number;
}

export interface Floor {
  id: number;
  x1: number;
  x2: number;
  y: number;
  keys: number[];
  /** Inner edges where two merged elements meet: preferred rope lines. */
  seams: number[];
  /** Where the side walls under each end stop. */
  leftWall: number;
  rightWall: number;
}

export type ClimbKind = 'jump' | 'wall' | 'rope';

export type Link =
  | { type: 'drop'; from: Floor; to: Floor; fx: number; tx: number; side: -1 | 1 }
  | {
      type: ClimbKind;
      from: Floor;
      to: Floor;
      /** Where he walks to on the starting floor. */
      fx: number;
      /** Where the climb happens: a wall's foot, a rope's line, a jump's spot. */
      ax: number;
      /** Where he steps off onto the destination floor. */
      tx: number;
      up: boolean;
      /** For a wall: which way he faces while on it; the bottom of the wall. */
      face: -1 | 1;
      wallBottom: number;
    };

export interface World {
  floors: Floor[];
  links: Link[];
  spots: Partial<Record<Spot, { floor: Floor; x: number }>>;
  margin: number;
}

export interface WorldOptions {
  /** Closest the character's origin may get to a floor's end. */
  margin: number;
  /** How far out from a wall he hangs while climbing it. */
  standOff: number;
  /** Tallest gap he clears with a standing jump. */
  jump: number;
  /** Tallest gap he will step off a ledge into; deeper ones he abseils. */
  drop: number;
  /** Page width: a climb just off a floor's end must stay on the page. */
  pageWidth?: number;
  /**
   * Longest climb he takes by choice. Longer ones are added only where
   * nothing shorter connects the two floors, so he goes level by level
   * instead of abseiling the whole page in one go.
   */
  longest?: number;
}

const MIN_FLOOR = 24;
/** Ropes and walls keep this far from the page's edges. */
const EDGE = 24;
const COST: Record<Link['type'], number> = { drop: 24, jump: 30, wall: 60, rope: 90 };

export const clampTo = (w: World, x: number, f: Floor) => Math.max(f.x1 + w.margin, Math.min(f.x2 - w.margin, x));

export function buildWorld(rects: SceneryRect[], opts: WorldOptions): World {
  const m = opts.margin;
  const floors: Floor[] = [];
  const sorted = rects.filter((r) => r.x2 - r.x1 >= MIN_FLOOR).sort((a, b) => a.y - b.y || a.x1 - b.x1);
  for (const r of sorted) {
    const bottom = r.bottom ?? r.y;
    const f = floors.find((q) => Math.abs(q.y - r.y) <= 2 && r.x1 <= q.x2 + 4 && r.x2 >= q.x1 - 4);
    if (f) {
      f.seams.push(r.x1 > f.x2 ? (r.x1 + f.x2) / 2 : r.x1 < f.x1 ? (r.x2 + f.x1) / 2 : r.x1);
      if (r.x1 < f.x1) f.leftWall = bottom;
      if (r.x2 > f.x2) f.rightWall = bottom;
      f.x1 = Math.min(f.x1, r.x1);
      f.x2 = Math.max(f.x2, r.x2);
      f.keys.push(r.key);
    } else {
      floors.push({ id: floors.length, x1: r.x1, x2: r.x2, y: Math.round(r.y), keys: [r.key], seams: [], leftWall: bottom, rightWall: bottom });
    }
  }
  for (const f of floors) f.seams = f.seams.filter((s) => s > f.x1 + m && s < f.x2 - m);

  const world: World = { floors, links: [], spots: {}, margin: m };
  const inside = (x: number, f: Floor) => x >= f.x1 + m && x <= f.x2 - m;
  const onPage = (x: number) => x >= EDGE && x <= (opts.pageWidth ?? Infinity) - EDGE;
  const below = (x: number, y: number) => {
    let best: Floor | null = null;
    for (const f of floors) if (f.y > y + 4 && x >= f.x1 && x <= f.x2 && (!best || f.y < best.y)) best = f;
    return best;
  };

  // Drops: step off either end and land on whatever is underneath, if it is
  // not too far down.
  for (const f of floors) {
    for (const side of [-1, 1] as const) {
      const probe = (side < 0 ? f.x1 : f.x2) + side * 6;
      const to = below(probe, f.y);
      if (to && to.y - f.y <= opts.drop)
        world.links.push({ type: 'drop', from: f, to, fx: clampTo(world, side < 0 ? f.x1 : f.x2, f), tx: clampTo(world, probe + side * 4, to), side });
    }
  }

  // Every pair of floors where one sits directly above the other.
  const pairs = new Map<string, { top: Floor; bot: Floor; xs: number[] }>();
  for (const top of floors) {
    for (let x = top.x1 + m; x <= top.x2 - m; x += 4) {
      const bot = below(x, top.y);
      if (!bot || !inside(x, bot) || !onPage(x)) continue;
      const k = `${top.id}:${bot.id}`;
      const p = pairs.get(k) ?? { top, bot, xs: [] };
      p.xs.push(x);
      pairs.set(k, p);
    }
  }

  const add = (kind: ClimbKind, top: Floor, bot: Floor, ax: number, face: -1 | 1, wallBottom: number) => {
    const x = Math.round(ax);
    const common = { ax: x, face, wallBottom };
    world.links.push({ type: kind, from: bot, to: top, fx: clampTo(world, x, bot), tx: clampTo(world, x, top), up: true, ...common });
    world.links.push({ type: kind, from: top, to: bot, fx: clampTo(world, x, top), tx: clampTo(world, x, bot), up: false, ...common });
  };

  const connect = ({ top, bot, xs }: { top: Floor; bot: Floor; xs: number[] }) => {
    const lo = xs[0];
    const hi = xs[xs.length - 1];
    const mid = (lo + hi) / 2;
    if (bot.y - top.y <= opts.jump) {
      add('jump', top, bot, xs.reduce((a, b) => (Math.abs(b - mid) < Math.abs(a - mid) ? b : a)), 1, bot.y);
      return;
    }
    // Prefer the outside of a box: climbing its side never crosses its
    // contents. The right-hand side first, as headings sit on the left.
    const side = ([1, -1] as const)
      .map((s) => ({ s, x: (s > 0 ? top.x2 : top.x1) + s * opts.standOff, wall: s > 0 ? top.rightWall : top.leftWall }))
      .find(({ x }) => onPage(x) && inside(x, bot) && below(x, top.y) === bot);
    if (side) {
      const reachable = bot.y - side.wall <= opts.jump;
      add(reachable ? 'wall' : 'rope', top, bot, side.x, side.s > 0 ? -1 : 1, Math.min(side.wall, bot.y));
      return;
    }
    // A seam between two cells is a natural line for a rope; otherwise the
    // right-hand end, away from headings.
    const seams = [...top.seams, ...bot.seams].filter((s) => s >= lo && s <= hi);
    const x = seams.length ? seams.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid))[0] : hi;
    add('rope', top, bot, x, 1, bot.y);
  };

  const longest = opts.longest ?? Infinity;
  const all = [...pairs.values()].sort((a, b) => a.bot.y - a.top.y - (b.bot.y - b.top.y));
  for (const p of all) if (p.bot.y - p.top.y <= longest) connect(p);
  for (const p of all) {
    if (p.bot.y - p.top.y <= longest) continue;
    const reach = reachability(world);
    if (!reach[p.bot.id].has(p.top.id) || !reach[p.top.id].has(p.bot.id)) connect(p);
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
      for (const l of w.links)
        if (l.from === cur && !seen.has(l.to.id)) {
          seen.add(l.to.id);
          queue.push(l.to);
        }
    }
    return seen;
  });
}

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
      const climb = l.type === 'drop' ? 0 : Math.abs(l.to.y - l.from.y);
      const d = dist.get(cur)! + Math.abs(at.get(cur)! - l.fx) + COST[l.type] + climb;
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
