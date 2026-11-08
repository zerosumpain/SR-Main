// The welcome-back time-lapse (spec §9.9): a 6–12 second replay of the tile
// log since the phone last looked, ending exactly on the town as it is.

import { describe, expect, it } from 'vitest';
import { HarnessSession } from '../src/harness/session';
import { readTileLog, type TileEvent } from '../src/engine';
import { MASK_SHOWN, MASK_TERRAIN } from '../src/render/model';
import { LAPSE_MAX_MS, LAPSE_MIN_MS, LapsePlayer, lapseFor, lapseOf } from '../src/timelapse';

describe('the time-lapse', () => {
  const s = new HarnessSession({ seed: 6 });
  s.runDays(2);
  const t = s.town;

  it('lasts 6 to 12 seconds and keeps its steps in order', () => {
    const lapse = lapseFor(t, 0, false)!;
    expect(lapse).not.toBeNull();
    expect(lapse.durationMs).toBeGreaterThanOrEqual(LAPSE_MIN_MS);
    expect(lapse.durationMs).toBeLessThanOrEqual(LAPSE_MAX_MS);
    for (let k = 1; k < lapse.steps.length; k++) expect(lapse.steps[k].at).toBeGreaterThanOrEqual(lapse.steps[k - 1].at);
    expect(lapse.steps[lapse.steps.length - 1].at).toBeLessThanOrEqual(lapse.durationMs);
    expect(lapse.steps.some((x) => x.sparkle)).toBe(true);
  });

  it('starts with the new roads and lots hidden and ends on the town as it is', () => {
    const lapse = lapseFor(t, 0, false)!;
    expect([...lapse.start].some((m) => m === MASK_TERRAIN)).toBe(true);
    const p = new LapsePlayer(lapse);
    p.step(0);
    const mid = p.step(lapse.durationMs / 2);
    expect(Array.isArray(mid)).toBe(true);
    p.step(lapse.durationMs + 1);
    expect(p.done).toBe(true);
    expect([...p.mask].every((m) => m === MASK_SHOWN)).toBe(true);
  });

  it('can be skipped, is skipped under Reduce Motion, and is not worth it for a couple of events', () => {
    const p = new LapsePlayer(lapseFor(t, 0, false)!);
    p.finish();
    expect([...p.mask].every((m) => m === MASK_SHOWN)).toBe(true);
    expect(lapseFor(t, 0, true)).toBeNull();
    const few: TileEvent[] = readTileLog(t).slice(0, 2);
    expect(lapseOf(few)).toBeNull();
    expect(lapseFor(t, t.tick + 1, false)).toBeNull();
  });
});
