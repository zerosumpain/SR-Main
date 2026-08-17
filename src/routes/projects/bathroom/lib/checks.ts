// What the planner tells you about a layout: clashes, tight spots, and the one
// measurement that decides a chunk of the budget — how far the WC has drifted
// from the soil stack.

import {
  FIX,
  doorGeom,
  foot,
  notchRect,
  overlap,
  wallPt,
  zone,
  type Item,
  type Plan,
} from './fixtures';

export type Level = 'crit' | 'warn' | 'good' | 'info';
export interface Issue {
  level: Level;
  text: string;
}

const nm = (it: Item) => FIX[it.t].n;

export function checks(p: Plan): Issue[] {
  const out: Issue[] = [];
  const nr = notchRect(p);
  const dg = doorGeom(p);

  for (const it of p.items) {
    const b = foot(it);
    if (b.x < -1 || b.y < -1 || b.x + b.w > p.W + 1 || b.y + b.h > p.D + 1)
      out.push({
        level: 'crit',
        text: `${nm(it)} doesn't fit — it's bigger than the space you've given it.`,
      });
    if (nr && overlap(b, nr) > 2000)
      out.push({ level: 'crit', text: `${nm(it)} runs into the chimney breast.` });
    if (dg.sq && overlap(b, dg.sq) > 15000)
      out.push({
        level: 'crit',
        text: `The door will hit the ${nm(it)}. Move it, or hang the door the other way.`,
      });
  }

  for (let i = 0; i < p.items.length; i++)
    for (let j = i + 1; j < p.items.length; j++) {
      if (overlap(foot(p.items[i]), foot(p.items[j])) > 2000)
        out.push({
          level: 'crit',
          text: `${nm(p.items[i])} and ${nm(p.items[j])} are on top of each other.`,
        });
    }

  const room = { x: 0, y: 0, w: p.W, h: p.D };
  for (const it of p.items) {
    const z = zone(it);
    if (!z) continue;
    const full = z.w * z.h;
    if (full && overlap(z, room) / full < 0.68)
      out.push({
        level: 'warn',
        text: `Not much room in front of the ${nm(it)} — it's up against a wall.`,
      });
    for (const other of p.items) {
      if (other.id === it.id) continue;
      const ov = overlap(z, foot(other));
      // Both thresholds matter: a small absolute clash in a big room is noise,
      // and a large one in a tiny zone is the whole zone.
      if (ov > 60000 && ov > full * 0.28)
        out.push({
          level: 'warn',
          text: `Tight: you'd be standing on the ${nm(other)} to use the ${nm(it)}.`,
        });
    }
  }

  const wcs = p.items.filter((i) => FIX[i.t].k === 'wc' || FIX[i.t].k === 'combo');
  const sp = wallPt(p, p.stack.wall, p.stack.pos);
  for (const it of wcs) {
    const b = foot(it);
    const dist = Math.round(Math.hypot(b.x + b.w / 2 - sp.x, b.y + b.h / 2 - sp.y));
    if (dist <= 1500)
      out.push({ level: 'good', text: `WC is ${dist} mm from the stack — a straightforward connection.` });
    else if (dist <= 3000)
      out.push({
        level: 'warn',
        text: `WC is ${(dist / 1000).toFixed(1)} m from the stack. Doable, but expect a boxed-in run and a fall to maintain. Add £300–£1,000.`,
      });
    else
      out.push({
        level: 'crit',
        text: `WC is ${(dist / 1000).toFixed(1)} m from the stack. That's macerator territory — powered, noisier, one more thing to service.`,
      });
  }

  const has = (k: string) => p.items.some((i) => FIX[i.t].k === k);
  if (!wcs.length) out.push({ level: 'info', text: 'No toilet in the room yet.' });
  if (!has('basin') && !has('combo')) out.push({ level: 'info', text: 'No basin yet.' });
  if (!has('bath') && !has('shower'))
    out.push({ level: 'info', text: 'Nothing to wash in yet — add a bath or a shower.' });
  if (!has('rail'))
    out.push({
      level: 'info',
      text: 'No towel rail. In a solid-walled terrace you want one, and it needs 500–700 mm of wall.',
    });
  if (p.door.w < 686)
    out.push({
      level: 'warn',
      text: 'That door is narrower than 686 mm — awkward for getting a bath in, never mind out.',
    });
  if (!p.items.length)
    out.push({
      level: 'info',
      text: 'Empty room. Try one of the starting layouts, or add fittings from the list.',
    });
  if (!out.some((o) => o.level === 'crit' || o.level === 'warn') && p.items.length)
    out.unshift({
      level: 'good',
      text: 'No clashes. Everything fits with room to stand in front of it.',
    });
  return out;
}

export interface Stats {
  area: number;
  net: number;
  free: number;
  freePct: number;
  perim: number;
  stackDist: number | null;
}

export function stats(p: Plan): Stats {
  const area = (p.W * p.D) / 1e6;
  const nr = notchRect(p);
  const net = area - (nr ? (nr.w * nr.h) / 1e6 : 0);
  let taken = 0;
  for (const it of p.items) {
    const b = foot(it);
    taken += (b.w * b.h) / 1e6;
  }
  const free = Math.max(0, net - taken);
  const perim = (2 * (p.W + p.D)) / 1000;
  const wcs = p.items.filter((i) => FIX[i.t].k === 'wc' || FIX[i.t].k === 'combo');
  const sp = wallPt(p, p.stack.wall, p.stack.pos);
  let stackDist: number | null = null;
  if (wcs.length) {
    const b = foot(wcs[0]);
    stackDist = Math.round(Math.hypot(b.x + b.w / 2 - sp.x, b.y + b.h / 2 - sp.y));
  }
  return { area, net, free, freePct: net ? (free / net) * 100 : 0, perim, stackDist };
}
