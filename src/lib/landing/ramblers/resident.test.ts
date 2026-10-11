import { describe, expect, it } from 'vitest';
import { Resident, type Activity } from './resident';
import { cueBeats, visitBeats, type Topic } from './exhibits';
import { NO_DAY } from './day';
import { moodFor } from './mood';
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
      if (r.cloud && r.mode === 'surprised' && r.activity === 'umbrella' && !r.umbrella) soaked = true;
      if (r.cloud && r.umbrella) sheltered = true;
    }
    expect(soaked).toBe(true);
    expect(sheltered).toBe(true);
  });

  it('turns to face the visitor to think, and side on to walk', () => {
    const w = buildWorld(RECTS, OPTS);
    const r = new Resident(seeded(21));
    r.setWorld(w);
    r.start('think');
    const views = new Map<string, string>();
    for (let i = 0; i < 60 * 60 && r.activity === 'think'; i++) {
      r.update(1 / 60);
      views.set(r.mode, r.view);
    }
    expect(views.get('think')).toBe('front');
    expect(views.get('walk') ?? views.get('run')).toBe('side');
  });

  it('loses his temper at most once a visit', () => {
    const w = buildWorld(RECTS, OPTS);
    let mads = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const r = new Resident(seeded(seed));
      r.setWorld(w);
      let wasMad = false;
      let count = 0;
      // Six dry-day umbrella gags in a row, each left to play out.
      for (let gag = 0; gag < 6; gag++) {
        r.start('umbrella');
        for (let i = 0; i < 60 * 90 && r.activity === 'umbrella'; i++) {
          r.update(1 / 60);
          const mad = r.mode === 'mad';
          if (mad && !wasMad) count++;
          wasMad = mad;
        }
      }
      expect(count).toBeLessThanOrEqual(1);
      mads += count;
    }
    expect(mads).toBeGreaterThan(0);
  });

  it('loses it once when jk is sat still with a racing pulse, then stays stressed', () => {
    const w = buildWorld(RECTS, OPTS);
    const r = new Resident(seeded(19));
    r.setWorld(w);
    r.setMood(moodFor({ sky: 'cloudy', temp: 14, pulse: 118, dayPhase: 'day', day: { ...NO_DAY, moving: 'still' }, hour: 11, weekday: true }));
    let mads = 0;
    let stressed = false;
    let was = false;
    for (let i = 0; i < 60 * 300; i++) {
      r.update(1 / 60);
      const mad = r.mode === 'mad';
      if (mad && !was) mads++;
      was = mad;
      if (r.activity === 'stressed') stressed = true;
    }
    expect(mads).toBe(1);
    expect(stressed).toBe(true);
  });

  it('is stressed in episodes, not as a hobby, when the pulse is up', () => {
    const w = buildWorld(RECTS, OPTS);
    const r = new Resident(seeded(17));
    r.setWorld(w);
    r.setMood(moodFor({ sky: 'cloudy', temp: 14, pulse: 115, dayPhase: 'day', day: NO_DAY, hour: 15 }));
    const seen = new Set<string>();
    for (let i = 0; i < 60 * 300; i++) {
      r.update(1 / 60);
      seen.add(r.activity);
    }
    expect(seen.has('stressed')).toBe(true);
    expect(seen.size).toBeGreaterThanOrEqual(4);
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

  describe('visiting the page', () => {
    // Two sections: one round the floor at 400, one round the floor at 700.
    const sections = [
      { topic: 'health' as Topic, box: { x1: 100, x2: 1100, top: 390, bottom: 650 }, focus: { x: 800, y: 500 } },
      { topic: 'build' as Topic, box: { x1: 100, x2: 1100, top: 690, bottom: 880 }, focus: { x: 300, y: 760 } },
    ];
    const setup = (seed = 3) => {
      const r = new Resident(seeded(seed));
      r.setWorld(buildWorld(RECTS, OPTS));
      r.setExhibits(sections, (t) => visitBeats(t, () => ({ health: { kmYear: 1704 } }), seeded(seed)));
      return r;
    };

    it('finds where to stand at each section', () => {
      expect(setup().exhibitTopics).toEqual(['health', 'build']);
    });

    it('goes to the section the visitor is reading, and talks about it there', () => {
      const r = setup();
      r.setView(300, 800);
      const said: string[] = [];
      let arrived = false;
      for (let i = 0; i < 60 * 90 && !arrived; i++) {
        r.update(1 / 60);
        if (r.bubble) said.push(r.bubble.text);
        if (r.topic === 'health' && r.mode === 'flex') arrived = true;
      }
      expect(arrived).toBe(true);
      expect(r.floor?.y).toBe(400);
      expect(Math.abs(r.x - 800)).toBeLessThan(2);
      // The first line of the visit is about the figure on show.
      for (let i = 0; i < 30; i++) r.update(1 / 60);
      expect(r.bubble?.text).toMatch(/1,704 km|steps|posing/);
    });

    it('carries on with a visit when the page re-lays itself out', () => {
      const r = setup();
      r.setView(300, 800);
      for (let i = 0; i < 60 * 90 && !(r.topic === 'health' && r.mode === 'flex'); i++) r.update(1 / 60);
      expect(r.mode).toBe('flex');
      // A rebuild mid-beat (as the sections' figures count up).
      r.setWorld(buildWorld(RECTS, OPTS));
      r.setExhibits(sections, (t) => visitBeats(t, () => ({}), seeded(3)));
      const modes = new Set<string>();
      for (let i = 0; i < 60 * 12; i++) {
        r.update(1 / 60);
        if (r.topic === 'health') modes.add(r.mode);
      }
      expect(modes.has('pushup')).toBe(true);
    });

    it('does not visit a section off screen', () => {
      const r = setup();
      r.setView(0, 300);
      expect(r.visit('build')).toBe(false);
      const r2 = setup();
      r2.setView(0, 300);
      for (let i = 0; i < 60 * 30; i++) r2.update(1 / 60);
      expect(r2.topic).toBeNull();
    });

    it('reacts to the visitor where he stands', () => {
      const r = setup();
      r.setView(0, 1000);
      for (let i = 0; i < 60; i++) r.update(1 / 60);
      // Let any climb finish first.
      for (let i = 0; i < 60 * 10 && r.mode !== 'idle' && r.mode !== 'walk' && r.mode !== 'run'; i++) r.update(1 / 60);
      const floor = r.floor;
      r.react(cueBeats('view', () => 0));
      let surprised = false;
      for (let i = 0; i < 60 * 3 && !surprised; i++) {
        r.update(1 / 60);
        surprised = r.mode === 'surprised';
      }
      expect(surprised).toBe(true);
      expect(r.floor).toBe(floor);
      expect(r.bubble?.text).toBe('ooh. redecorating');
    });

    it('holds still with the page, and carries on after', () => {
      const r = setup();
      r.setView(0, 1000);
      for (let i = 0; i < 120; i++) r.update(1 / 60);
      r.freeze(true, { text: 'statues, is it', kind: 'say' });
      const at = [r.x, r.y, r.mode];
      for (let i = 0; i < 600; i++) r.update(1 / 60);
      expect([r.x, r.y, r.mode]).toEqual(at);
      expect(r.bubble).toBeNull();
      r.freeze(false);
      for (let i = 0; i < 60 * 20; i++) r.update(1 / 60);
      expect(r.clock).toBeGreaterThan(20);
    });
  });
});
