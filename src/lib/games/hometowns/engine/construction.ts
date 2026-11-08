// Tick step 1 (spec §5.2): construction counts down. Every tile or building
// with ticks left loses one; at zero it completes (its capacity appears in the
// next supply count) and writes a tile event, which the phone plays as a
// ribbon sparkle. WP1 owns `construction`; WP2e starts it (growth, level-ups,
// repairs) and the build command starts it for placed buildings.

import { appendTileEvent } from './records';
import type { TickContext, TownState } from './types';

export function constructionStep(t: TownState, ctx: TickContext): void {
  const list = t.construction;
  let w = 0;
  for (let i = 0; i + 1 < list.length; i += 2) {
    const tile = list[i];
    const left = list[i + 1] - 1;
    if (left > 0) {
      list[w++] = tile;
      list[w++] = left;
    } else appendTileEvent(t, ctx.tick, tile, 'built');
  }
  list.length = w;
}
