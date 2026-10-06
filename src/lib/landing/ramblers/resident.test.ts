import { describe, expect, it } from 'vitest';
import { Resident, type Activity } from './resident';
import { buildWorld, type SceneryRect } from './world';

const OPTS = { margin: 8, standOff: 8, jump: 52, drop: 160 };

const RECTS: SceneryRect[] = [
  { key: 1, x1: 100, x2: 1100, y: 100, spot: 'lookout' },
  { key: 2, x1: 100, x2: 600, y: 400, spot: 'desk' },
  { key: 3, x1: 600, x2: 1100, y: 400, spot: 'think' },
  { key: 4, x1: 100, x2: 1100, y: 700, spot: 'bed' },
  { key: 5, x1: 0, x2: 1200, y: 900, spot: 'garage' },
];

// A repeatable random source, so a failure replays exactly.
function seeded(seed: number) {
  return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
}

describe('Resident', () => {
  it('lives ten minutes without leaving the world', () => {
    const w = buildWorld(RECTS, OPTS);
    const r = new Resident(seeded(7));
    r.setWorld(w);
    const seen = new Set<Activity>();
    for (let i = 0; i < 60 * 600; i++) {
      r.update(1 / 60);
      seen.add(r.activity);
      expect(Number.isFinite(r.x) && Number.isFinite(r.y)).toBe(true);
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.x).toBeLessThanOrEqual(1200);
      expect(r.y).toBeGreaterThanOrEqual(100 - 40);
      expect(r.y).toBeLessThanOrEqual(900);
    }
    expect(seen.size).toBeGreaterThanOrEqual(6);
  });

  it('drives off and parks the car back where it was', () => {
    const w = buildWorld(RECTS, OPTS);
    const r = new Resident(seeded(3));
    r.setWorld(w);
    const parked = r.car!.x;
    r.start('drive');
    let drove = false;
    for (let i = 0; i < 60 * 60 && r.activity === 'drive'; i++) {
      r.update(1 / 60);
      if (r.inCar && Math.abs(r.car!.x - parked) > 200) drove = true;
      if (drove && !r.inCar) break;
    }
    expect(drove).toBe(true);
    expect(r.car!.x).toBeCloseTo(parked, 0);
  });

  it('sleeps in place when motion is reduced', () => {
    const w = buildWorld(RECTS, OPTS);
    const r = new Resident(seeded(1));
    r.setWorld(w, { asleep: true });
    r.update(0.1);
    expect(r.mode).toBe('sleep');
    expect(r.y).toBe(700);
  });

  it('gets out of the car when something else comes up mid-drive', () => {
    const w = buildWorld(RECTS, OPTS);
    const r = new Resident(seeded(5));
    r.setWorld(w);
    r.start('drive');
    for (let i = 0; i < 60 * 120 && !r.inCar; i++) r.update(1 / 60);
    for (let i = 0; i < 60; i++) r.update(1 / 60);
    expect(r.inCar).toBe(true);
    const at = r.x;
    r.start('think');
    expect(r.inCar).toBe(false);
    expect(r.car!.x).toBe(at);
  });

  it('fires a rope up, climbs it, and reels it in behind him', () => {
    const w = buildWorld(RECTS, OPTS);
    const r = new Resident(seeded(9));
    r.setWorld(w, { asleep: true });
    r.start('lookout');
    let roped = false;
    for (let i = 0; i < 60 * 180 && r.mode !== 'lookout'; i++) {
      r.update(1 / 60);
      if (r.rope) roped = true;
    }
    expect(r.mode).toBe('lookout');
    expect(r.y).toBe(100);
    expect(roped).toBe(true);
    expect(r.rope).toBeNull();
  });

  it('digs, plants, and leaves a flower behind', () => {
    const w = buildWorld(RECTS, OPTS);
    const r = new Resident(seeded(11));
    r.setWorld(w);
    r.start('garden');
    const seen = new Set<string>();
    for (let i = 0; i < 60 * 120 && r.flowers.length === 0; i++) {
      r.update(1 / 60);
      seen.add(r.mode);
    }
    expect(seen.has('dig') && seen.has('plant')).toBe(true);
    expect(r.flowers).toHaveLength(1);
  });

  it('gets caught by a cloud, then puts his umbrella up', () => {
    const w = buildWorld(RECTS, OPTS);
    const r = new Resident(seeded(12));
    r.setWorld(w);
    r.start('umbrella');
    let soaked = false;
    let sheltered = false;
    for (let i = 0; i < 60 * 120 && !sheltered; i++) {
      r.update(1 / 60);
      if (r.cloud && r.mode === 'idle' && r.activity === 'umbrella' && !r.umbrella && r.bubble?.text === '!') soaked = true;
      if (r.cloud && r.umbrella) sheltered = true;
    }
    expect(soaked).toBe(true);
    expect(sheltered).toBe(true);
  });

  it('ropes back into view when the visitor scrolls far away', () => {
    const w = buildWorld(RECTS, OPTS);
    const r = new Resident(seeded(13));
    r.setWorld(w);
    r.setView(0, 600);
    r.update(1 / 60);
    expect(r.y).toBeLessThan(600);
    // The visitor jumps to the bottom of the page and stays there.
    r.setView(700, 1300);
    let roped = false;
    for (let i = 0; i < 60 * 20; i++) {
      r.setView(700, 1300);
      r.update(1 / 60);
      if (r.rope) roped = true;
      if (r.y >= 700 && r.y <= 1300 && !r.rope && roped) break;
    }
    expect(roped).toBe(true);
    expect(r.y).toBe(900);
  });
});
