// Four starting layouts. They are starting points, not answers — each one is
// checked by the same rules as anything you drag yourself, so a preset that
// warns in your room is telling you something true about your room.

import { FIX, place, type Item, type Plan, type Wall } from './fixtures';

interface Placed {
  t: string;
  x: number;
  y: number;
  r: 0 | 90 | 180 | 270;
}

/** Sit a fitting flush against a wall, `off` mm from that wall's first corner. */
function onWall(p: Plan, t: string, wall: Wall, off: number): Placed {
  const f = FIX[t];
  if (wall === 'N') return { t, x: off, y: 0, r: 0 };
  if (wall === 'S') return { t, x: off, y: p.D - f.d, r: 180 };
  if (wall === 'W') return { t, x: 0, y: off, r: 90 };
  return { t, x: p.W - f.d, y: off, r: 270 };
}

export type PresetKey = 'classic' | 'bathshower' | 'walkin' | 'fitted';

export const PRESETS: { key: PresetKey; label: string; note: string }[] = [
  { key: 'classic', label: 'Bath under window', note: 'The layout the house was built for.' },
  { key: 'bathshower', label: 'Bath + shower', note: 'Four pieces, if the room will take them.' },
  { key: 'walkin', label: 'Walk-in, no bath', note: 'Shower first. Feels twice the size.' },
  { key: 'fitted', label: 'Fitted run', note: 'Everything hidden in one run of furniture.' },
];

function layout(p: Plan, key: PresetKey): Placed[] {
  const w = (t: string, wall: Wall, off: number) => onWall(p, t, wall, off);
  const cap = (n: number, max: number) => Math.max(0, Math.min(n, max));
  switch (key) {
    case 'classic':
      return [
        w(p.W >= 1750 ? 'bath17' : p.W >= 1650 ? 'bath16' : 'bath15', 'N', 0),
        w('wcCC', 'E', 950),
        w('van60', 'W', 900),
        w('rail', 'S', cap(p.W - 700, p.W)),
      ];
    case 'bathshower':
      return [
        w('bath15', 'N', 0),
        w('tray90', 'E', 1300),
        w('wcCC', 'N', cap(1600, p.W - 370)),
        w('basinSm', 'W', 1000),
        w('rail', 'S', cap(1000, p.W - 500)),
      ];
    case 'walkin':
      return [
        w(p.D >= 1450 ? 'tray149' : 'tray128', 'E', 0),
        w('wcCC', 'N', 600),
        w('van60', 'W', 900),
        w('rail', 'W', 200),
        w('tall', 'S', cap(p.W - 800, p.W)),
      ];
    case 'fitted':
      return [w('pbath', 'N', 0), w('combo', 'E', 950), w('tall', 'W', 1000), w('rail', 'W', 1600)];
  }
}

/** Replace the room's contents with a preset, snapped and clamped to fit. */
export function applyPreset(p: Plan, key: PresetKey): Item[] {
  return layout(p, key).map((o) => {
    const it: Item = { id: p.seq++, ...o };
    place(p, it, it.x, it.y);
    return it;
  });
}
