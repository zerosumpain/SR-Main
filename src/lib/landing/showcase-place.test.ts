import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { showcaseFixture } from './showcase.fixture';
import { COUNT_MS } from './showcase-motion';
import type { AppShowcase, BuildShowcase, DaydreamShowcase, HealthShowcase } from './showcase';
import type { LandingVitals } from './live-vitals.svelte';
import {
  CRATE_CAP,
  METEOR_CAP,
  MOON_FULL_HOURS,
  STAR_CAP,
  BIG_STAR,
  WALK_POINTS,
  along,
  constellation,
  countDelay,
  crates,
  dayWords,
  domePanels,
  hourly,
  labelBox,
  lanterns,
  meteors,
  milestoneStep,
  moon,
  questionSky,
  samplePath,
  scatter,
  seeded,
  slitShare,
  smoothPath,
  stepTrees,
  stringPath,
  trend,
  walk,
  windows,
} from './showcase-place';
import {
  appWords,
  bandWord,
  daydreamWords,
  figure,
  healthWords,
  listWords,
  plural,
  signposts,
  tagLine,
  worksWords,
  type Tag,
} from './showcase-place-words';

const TODAY = '2026-10-10';
const fx = showcaseFixture(TODAY);
const RULES: DaydreamShowcase['rules'] = {
  cadenceMinutes: 45,
  activeHours: { start: 7, end: 23 },
  slotsPerDay: 21,
  areas: 7,
  maxLookups: 12,
  maxNotes: 2,
  dailyRaiseCap: 4,
  windowDays: 28,
  loopStart: '2026-09-25',
};
const DD: DaydreamShowcase = { ...fx.daydream, rules: RULES };
const EMPTY_DD: DaydreamShowcase = { week: null, impact: null, rules: RULES };
const EMPTY_HEALTH: HealthShowcase = {
  steps30: null,
  stepsYear: null,
  daysOver10k: null,
  bestDay: null,
  kmYear: null,
  recovery30: null,
  sleepAvg7: null,
  bands: { sleep: null, recovery: null },
  kinds: null,
};
const APP: AppShowcase = {
  targets: 4,
  tabs: 8,
  tabNames: ['today', 'chat', 'health', 'family', 'games', 'news', 'flows', 'more'],
  watchPages: 4,
  widgets: [
    { name: 'Journey Live Activity', surface: 'live-activity' },
    { name: 'Family steps', surface: 'home-screen' },
    { name: 'Family tasks', surface: 'home-screen' },
  ],
  complications: [{ name: 'Readiness' }, { name: 'Alerts' }],
  intents: [{ title: 'Health today' }, { title: 'Ask jkai' }, { title: 'Sync now' }],
  games: ['Tap Duel', 'Wordle Race', 'Quiz Night', 'Anagram Blitz', 'Quick Maths Sprint', 'Sequence Memory', 'Boggle', 'Categories', "Liar's Dice", 'Draw & Guess'],
  backgroundModes: 3,
  liveActivities: true,
  nativeEndpoints: 61,
  nativeAreas: 20,
  pairCodeMinutes: 10,
  deviceTokenDays: 90,
};
const BUILD: BuildShowcase = {
  releases: 1734,
  linesWritten: 1_286_400,
  days: 412,
  firstDeploy: '2025-08-25T10:00:00Z',
  deploysPerDay: 4.2,
  deploysToday: 5,
  fromDaydream: 3,
};
const NO_BUILD: BuildShowcase = {
  releases: null,
  linesWritten: null,
  days: null,
  firstDeploy: null,
  deploysPerDay: null,
  deploysToday: null,
  fromDaydream: null,
};
const VITALS: LandingVitals = {
  jkai: { activeJobs: 2 },
  builder: { stage: 'Testing', active: true, shippedCount: 3, lastShippedTitle: null, lastShippedHref: null },
  canvas: { count: 12, lastRunAt: '2026-10-10T09:56:00Z' },
  generatedAt: '2026-10-10T10:00:00Z',
};
const NEXT = { value: '20 minutes', sub: 'till the site next thinks' };
const AREA = { x: 350, y: 10, w: 640, h: 370 };

/* ----------------------------------------------------------- copy checks */

/** Every piece of text a set of tags would put on the page. */
const texts = (tags: Tag[]) => tags.flatMap((t) => [t.kicker, t.value, t.spoken, t.unit, t.sub, t.note].filter((x): x is string => !!x));

function wordsOnly(all: string[]) {
  for (const s of all) {
    expect(s, s).not.toMatch(/!/);
    // A digit next to a hyphen-minus would be a negative printed wrong.
    expect(s, s).not.toMatch(/-\d/);
    // Big numbers are grouped the en-GB way.
    expect(s, s).not.toMatch(/\d{5,}/);
    for (const w of ['seamless', 'journey', 'leverage', 'robust']) expect(s.toLowerCase(), s).not.toContain(w);
  }
}

/** Prose (notes and keys) carries no colons; times like 07:00 are figures, not prose. */
function noColons(all: string[]) {
  for (const s of all) expect(s.replace(/\d{2}:\d{2}/g, ''), s).not.toMatch(/:/);
}

/**
 * The static parts of every string literal between the copy markers in the
 * source: the words this module writes itself, as opposed to the figures it
 * is handed. None may hold a digit.
 */
function copyLiterals(): string[] {
  const src = readFileSync(fileURLToPath(new URL('./showcase-place-words.ts', import.meta.url)), 'utf8');
  const region = src.slice(src.indexOf('/* copy:start'), src.indexOf('/* copy:end'));
  const out: string[] = [];
  let i = 0;
  const readTemplate = () => {
    // At the char after an opening backtick: collect static text, recurse into ${…}.
    let buf = '';
    while (i < region.length) {
      const c = region[i];
      if (c === '\\') {
        buf += region[i + 1];
        i += 2;
      } else if (c === '`') {
        i++;
        break;
      } else if (c === '$' && region[i + 1] === '{') {
        i += 2;
        readCode(1);
      } else {
        buf += c;
        i++;
      }
    }
    out.push(buf);
  };
  const readQuoted = (q: string) => {
    let buf = '';
    while (i < region.length && region[i] !== q) {
      if (region[i] === '\\') i++;
      buf += region[i++];
    }
    i++;
    out.push(buf);
  };
  const readCode = (depth: number) => {
    while (i < region.length) {
      const c = region[i];
      if (c === '/' && region[i + 1] === '/') {
        while (i < region.length && region[i] !== '\n') i++;
      } else if (c === '/' && region[i + 1] === '*') {
        i = region.indexOf('*/', i + 2) + 2;
      } else if (c === "'" || c === '"') {
        i++;
        readQuoted(c);
      } else if (c === '`') {
        i++;
        readTemplate();
      } else if (c === '{') {
        depth++;
        i++;
      } else if (c === '}') {
        depth--;
        i++;
        if (depth === 0) return;
      } else i++;
    }
  };
  readCode(Infinity);
  return out;
}

describe('the copy in this module', () => {
  it('has no digits of its own: every figure comes from the data', () => {
    const lits = copyLiterals();
    expect(lits.length).toBeGreaterThan(80);
    for (const s of lits) expect(s, `literal ${JSON.stringify(s)}`).not.toMatch(/\d/);
  });
});

/* ------------------------------------------------------------------ random */

describe('seeded and scatter', () => {
  it('repeats exactly for a seed and differs between seeds', () => {
    const a = seeded(7);
    const b = seeded(7);
    const c = seeded(8);
    const xs = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(xs);
    expect(c()).not.toBe(xs[0]);
    for (const x of xs) expect(x).toBeGreaterThanOrEqual(0), expect(x).toBeLessThan(1);
  });
  it('always returns the count asked for, inside the area and outside every box to avoid', () => {
    const avoid = [{ x: 400, y: 50, w: 200, h: 200 }];
    const pts = scatter(300, AREA, avoid, 1, 9);
    expect(pts).toHaveLength(300);
    for (const [x, y] of pts) {
      expect(x).toBeGreaterThanOrEqual(AREA.x);
      expect(x).toBeLessThanOrEqual(AREA.x + AREA.w);
      expect(y).toBeGreaterThanOrEqual(AREA.y);
      expect(y).toBeLessThanOrEqual(AREA.y + AREA.h);
      expect(x > 400 && x < 600 && y > 50 && y < 250).toBe(false);
    }
    expect(scatter(300, AREA, avoid, 1, 9)).toEqual(pts);
    expect(scatter(0, AREA, [], 1)).toEqual([]);
    expect(scatter(-3, AREA, [], 1)).toEqual([]);
  });
});

describe('countDelay', () => {
  it('keeps pace with the shared count: rising, the last landing with it', () => {
    const ds = Array.from({ length: 50 }, (_, i) => countDelay(i, 50));
    for (let i = 1; i < ds.length; i++) expect(ds[i]).toBeGreaterThanOrEqual(ds[i - 1]);
    expect(ds.at(-1)).toBe(COUNT_MS);
    // Ease-out: half the things are out well before half the time.
    expect(ds[24]).toBeLessThan(COUNT_MS / 3);
    expect(countDelay(0, 0)).toBe(0);
  });
});

describe('labelBox', () => {
  it('puts the words where the label hangs', () => {
    expect(labelBox({ x: 500, y: 300, lead: 22, dir: 'up', hang: 'r' }, 100, 50, 1.1)).toEqual({ x: 496, y: 230, w: 100, h: 50 });
    expect(labelBox({ x: 500, y: 300, lead: 22, dir: 'down', hang: 'l' }, 100, 50, 1.1)).toEqual({ x: 404, y: 320, w: 100, h: 50 });
    expect(labelBox({ x: 500, y: 300, lead: 22, dir: 'side', hang: 'l' }, 100, 50, 1.1)).toEqual({ x: 380, y: 275, w: 100, h: 50 });
  });
});

/* -------------------------------------------------------------- observatory */

describe('questionSky', () => {
  it('draws a star per question, in step with the count, and the struck ones apart', () => {
    const s = questionSky(142, 18, AREA, [], [440, 236]);
    expect(s.stars).toHaveLength(142);
    expect(s.drawn).toBe(142);
    expect(s.asked).toBe(142);
    expect(s.capped).toBe(false);
    expect(s.struck).toHaveLength(18);
    expect(s.struck[0]).toEqual({ x: 440, y: 236 });
    expect(s.stars.at(-1)!.d).toBe(COUNT_MS);
    expect(s.stars.some((x) => x.tw)).toBe(true);
    // A range of sizes, about one in ten big enough to glow, so the field reads as a lot.
    const big = s.stars.filter((x) => x.r >= BIG_STAR).length;
    expect(big).toBeGreaterThan(142 * 0.04);
    expect(big).toBeLessThan(142 * 0.2);
    expect(new Set(s.stars.map((x) => x.r)).size).toBeGreaterThanOrEqual(3);
    expect(questionSky(142, 18, AREA, [], [440, 236])).toEqual(s);
  });
  it('caps a huge week and says so', () => {
    const s = questionSky(STAR_CAP * 3, 0, AREA, []);
    expect(s.stars).toHaveLength(STAR_CAP);
    expect(s.capped).toBe(true);
    expect(s.asked).toBe(STAR_CAP * 3);
  });
  it('draws nothing for a week that is not answering, and knows it is not a zero', () => {
    const s = questionSky(null, null, AREA, []);
    expect(s.stars).toEqual([]);
    expect(s.struck).toEqual([]);
    expect(s.asked).toBeNull();
    const z = questionSky(0, 0, AREA, []);
    expect(z.asked).toBe(0);
  });
});

describe('constellation', () => {
  const box = { x: 600, y: 150, w: 300, h: 110 };
  it('puts a star a week left to right, higher for more useful', () => {
    const c = constellation(
      [
        { start: '2026-09-14', useful: 1, notUseful: 1, undecided: 0 },
        { start: '2026-09-21', useful: 4, notUseful: 0, undecided: 3 },
      ],
      box,
    );
    expect(c.points.map((p) => p.x)).toEqual([600, 900]);
    expect(c.points[0].rate).toBe(0.5);
    expect(c.points[1].y).toBeLessThan(c.points[0].y);
    expect(c.points[1].y).toBe(150);
    expect(c.points[1].r).toBeGreaterThan(c.points[0].r);
    expect(c.d).toBe('M600,205 L900,150');
  });
  it('breaks the line at a week with nothing rated rather than drawing it as a bad week', () => {
    const c = constellation(
      [
        { start: 'a', useful: 1, notUseful: 0, undecided: 0 },
        { start: 'b', useful: 0, notUseful: 0, undecided: 4 },
        { start: 'c', useful: 0, notUseful: 2, undecided: 0 },
      ],
      box,
    );
    expect(c.points[1].rate).toBeNull();
    expect(c.d.match(/M/g)).toHaveLength(2);
    expect(c.d).not.toContain('L');
  });
  it('is empty without impact', () => {
    expect(constellation(null, box)).toEqual({ points: [], d: '' });
    expect(constellation([], box)).toEqual({ points: [], d: '' });
  });
});

describe('trend, dome, slit and meteors', () => {
  it('compares whole percentages', () => {
    expect(trend(0.73, 0.64)).toBe('up');
    expect(trend(0.6, 0.64)).toBe('down');
    expect(trend(0.731, 0.729)).toBe('level');
    expect(trend(null, 0.6)).toBeNull();
    expect(trend(0.6, null)).toBeNull();
  });
  it('lights a panel per area covered, from the middle out', () => {
    expect(domePanels(6, 7).filter(Boolean)).toHaveLength(6);
    expect(domePanels(1, 7)).toEqual([false, false, false, true, false, false, false]);
    expect(domePanels(null, 7).some(Boolean)).toBe(false);
    expect(domePanels(12, 7).every(Boolean)).toBe(true);
  });
  it('lights the slit for the share of the waking week spent thinking', () => {
    expect(slitShare(31.5, { start: 7, end: 23 })).toBeCloseTo(31.5 / 112, 3);
    expect(slitShare(500, { start: 7, end: 23 })).toBe(1);
    expect(slitShare(null, { start: 7, end: 23 })).toBe(0);
    expect(slitShare(-2, { start: 7, end: 23 })).toBe(0);
  });
  it('drops a shooting star per shipped idea, falling down and right, up to a cap', () => {
    const m = meteors(3, { x: 372, y: 26, w: 170, h: 50 });
    expect(m).toHaveLength(3);
    for (const f of m) expect(f.x2).toBeGreaterThan(f.x1), expect(f.y2).toBeGreaterThan(f.y1);
    expect(meteors(100, AREA)).toHaveLength(METEOR_CAP);
    expect(meteors(null, AREA)).toEqual([]);
  });
});

/* ---------------------------------------------------------------- the walk */

describe('paths', () => {
  it('draws a smooth path through every point, and measures along it', () => {
    const d = smoothPath([
      [0, 0],
      [100, 0],
      [100, 100],
    ]);
    expect(d.startsWith('M0,0 C')).toBe(true);
    expect(d.endsWith('100,100')).toBe(true);
    expect(smoothPath([[1, 1]])).toBe('');
    const line = samplePath([
      [0, 0],
      [100, 0],
    ]);
    expect(along(line, 0)).toEqual([0, 0]);
    expect(along(line, 0.5)[0]).toBeCloseTo(50, 0);
    expect(along(line, 1)).toEqual([100, 0]);
    expect(along([], 0.5)).toEqual([0, 0]);
  });
  it('picks a round milestone with no more than the most posts', () => {
    expect(milestoneStep(1650.4)).toBe(100);
    expect(milestoneStep(40)).toBe(5);
    expect(milestoneStep(9000)).toBe(500);
    expect(1650.4 / milestoneStep(1650.4)).toBeLessThanOrEqual(18);
  });
  it('puts a post at each milestone and marks no day on a path of distance', () => {
    const w = walk(1650.4);
    expect(w.step).toBe(100);
    expect(w.posts).toHaveLength(16);
    expect('best' in w).toBe(false);
    expect(w.start).toEqual(WALK_POINTS[0]);
    expect(w.end).toEqual(WALK_POINTS.at(-1));
  });
  it('has no posts without the figures', () => {
    const w = walk(null);
    expect(w.posts).toEqual([]);
    expect(w.step).toBe(0);
    expect(w.d).toMatch(/^M/);
  });
});

describe('stepTrees', () => {
  const box = { x: 180, y: 452, w: 468, h: 104 };
  it('stands a tree a day, as tall as its steps, with the ten-thousand line', () => {
    const t = stepTrees(fx.health.steps30, box);
    expect(t.trees).toHaveLength(30);
    expect(t.line).not.toBeNull();
    expect(t.line!).toBeGreaterThan(box.y);
    expect(t.trees.filter((x) => x.tallest)).toHaveLength(1);
    expect(t.over).toBe(fx.health.steps30!.filter((d) => d != null && d >= 10_000).length);
    const tallest = t.trees.find((x) => x.tallest)!;
    expect(Math.max(...t.trees.map((x) => x.h))).toBe(tallest.h);
  });
  it('leaves a gap for a missing day rather than a stump, and the latest day stands at the right', () => {
    const days = Array.from({ length: 30 }, (_, i) => (i === 0 ? 5000 : i === 29 ? 12000 : null));
    const t = stepTrees(days, box);
    expect(t.trees).toHaveLength(2);
    expect(t.trees[0].x).toBeCloseTo(box.x + t.pitch / 2, 0);
    expect(t.trees[1].x).toBeCloseTo(box.x + box.w - t.pitch / 2, 0);
    expect(t.trees[1].over).toBe(true);
  });
  it('is empty without readings', () => {
    expect(stepTrees(null, box)).toMatchObject({ trees: [], line: null, over: 0 });
    expect(stepTrees([null, null], box).trees).toEqual([]);
  });
});

describe('lanterns, moon and hourly', () => {
  it('hangs a lantern per reading, good mornings first, never dated', () => {
    const l = lanterns({ high: 17, mid: 10, low: 3 }, [300, 300], [646, 306], 22);
    expect(l).toHaveLength(30);
    expect(l.slice(0, 17).every((x) => x.band === 'high')).toBe(true);
    expect(l.at(-1)!.band).toBe('low');
    expect(l[15].y).toBeGreaterThan(300);
    expect(lanterns(null, [0, 0], [1, 1], 1)).toEqual([]);
    expect(stringPath([0, 0], [100, 0], 10)).toBe('M0,0 Q50,20 100,0');
  });
  it('fills the moon towards full at the set hours, and leaves it an outline with no reading', () => {
    expect(moon(null, 0, 0, 10)).toBeNull();
    expect(moon(0, 0, 0, 10)).toEqual({ share: 0, d: '' });
    expect(moon(MOON_FULL_HOURS + 2, 0, 0, 10)!.share).toBe(1);
    const m = moon(7.1, 600, 60, 18)!;
    expect(m.share).toBeCloseTo(7.1 / MOON_FULL_HOURS, 2);
    expect(m.d).toMatch(/^M600,42 A18,18/);
  });
  it('sums quarter-hours into hours, nothing after now, and null with nothing in', () => {
    const bins = Array.from({ length: 96 }, (_, i) => (i < 40 ? 10 : 0));
    const h = hourly({ bins, total: 400, nowBin: 41 })!;
    expect(h).toHaveLength(24);
    expect(h[0]).toBe(40);
    expect(h[10]).toBe(0);
    expect(h[11]).toBeNull();
    expect(hourly(null)).toBeNull();
    expect(hourly({ bins, total: null, nowBin: 41 })).toBeNull();
  });
});

/* ------------------------------------------------------------ house, works */

describe('windows and crates', () => {
  it('lights a window per doorway, in step with the count', () => {
    const w = windows(61, 6, { x: 362, y: 146, w: 108, h: 324 });
    expect(w).toHaveLength(61);
    expect(w.at(-1)!.d).toBe(COUNT_MS);
    expect(new Set(w.map((x) => `${x.x},${x.y}`)).size).toBe(61);
    expect(windows(null, 6, AREA)).toEqual([]);
  });
  it('carries up to the cap on the hook and counts the rest', () => {
    expect(crates(5).boxes).toHaveLength(5);
    expect(crates(5).more).toBe(0);
    expect(crates(CRATE_CAP + 4)).toMatchObject({ more: 4 });
    expect(crates(null)).toEqual({ boxes: [], more: 0 });
  });
});

/* -------------------------------------------------------------------- words */

describe('small words', () => {
  it('formats figures en-GB, dashes what is missing and says why', () => {
    expect(figure(2_412_806)).toEqual({ value: '2,412,806' });
    expect(figure(1650.4, 1)).toEqual({ value: '1,650.4' });
    expect(figure(-3)).toEqual({ value: '−3' });
    expect(figure(null)).toEqual({ value: '—', spoken: 'not answering just now' });
    expect(figure(Number.NaN).value).toBe('—');
    expect(figure(0)).toEqual({ value: '0' });
  });
  it('joins lists, counts and dates the British way', () => {
    expect(listWords(['a'])).toBe('a');
    expect(listWords(['a', 'b', 'c'])).toBe('a, b and c');
    expect(listWords([])).toBe('');
    expect(plural(1, 'idea', 'ideas')).toBe('one idea');
    expect(plural(3, 'idea', 'ideas')).toBe('three ideas');
    expect(plural(14, 'idea', 'ideas')).toBe('14 ideas');
    expect(dayWords('2026-06-15')).toBe('Mon 15 June');
    expect(bandWord('high')).toBe('good');
    expect(bandWord(null)).toBeNull();
  });
  it('prints a dashed label as what it means rather than a dash', () => {
    expect(tagLine({ id: 'x', kicker: 'Look-ups', value: '—', spoken: 'not answering just now', unit: 'this week', note: '' })).toBe(
      'Look-ups · not answering just now',
    );
    expect(tagLine({ id: 'x', kicker: 'Sleep', value: '7.1', unit: 'hours', sub: 'the last seven', note: '' })).toBe('Sleep · 7.1 hours (the last seven)');
  });
});

describe('daydreamWords', () => {
  const sky = { drawn: 142, capped: false };
  const next = { state: 'next' as const, minutes: 20 };
  it('words every label from the figures', () => {
    const w = daydreamWords(DD, sky, next, NEXT);
    const tags = Object.values(w.tags);
    expect(w.tags.dome.value).toBe('31.5');
    expect(w.tags.dome.sub).toBe('across six of seven areas of life');
    expect(w.tags.lookups.value).toBe('1,204');
    expect(w.tags.useful.value).toBe('73%');
    expect(w.tags.useful.unit).toBe('of 41 rated');
    expect(w.tags.useful.sub).toBe('up from 64%');
    expect(w.tags.shipped.unit).toBe('ideas');
    expect(w.rules).toBe('A think every 45 minutes from 07:00 to 23:00, at most 12 look-ups a think, and never more than 4 notes a day raised to me.');
    wordsOnly([...texts(tags), w.key, w.rules, ...Object.values(w.head)]);
    noColons([...tags.map((t) => t.note), w.key, w.head.aside]);
  });
  it('says the sky is capped, and dashes a week that is not answering without calling it zero', () => {
    expect(daydreamWords(DD, { drawn: STAR_CAP, capped: true }, next, NEXT).key).toContain(`first ${STAR_CAP}`);
    const w = daydreamWords(EMPTY_DD, { drawn: 0, capped: false }, next, NEXT);
    for (const id of ['dome', 'lookups', 'struck', 'useful', 'shipped'] as const) {
      expect(w.tags[id].value).toBe('—');
      expect(w.tags[id].spoken).toBeTruthy();
    }
    // Not answering is not the same as nothing rated.
    expect(w.tags.useful.unit).toBeUndefined();
    expect(daydreamWords({ ...DD, impact: { ...DD.impact!, rated: 0, hitRate: null } }, sky, next, NEXT).tags.useful.unit).toBe('nothing rated yet');
    expect(w.key).not.toMatch(/\d/);
    wordsOnly([...texts(Object.values(w.tags)), w.key]);
  });
  it('explains the cloud for each state, in the dome’s own words rather than the hero’s', () => {
    expect(daydreamWords(DD, sky, { state: 'asleep', wakes: '07:00' }, NEXT).tags.next.note).toContain('mist');
    const off = daydreamWords(DD, sky, { state: 'off' }, { value: 'switched off', sub: 'for now' }).tags.next;
    expect(off.note).toContain('outline');
    expect(off.value).toBe('the dome’s shut');
    expect(daydreamWords(DD, sky, { state: 'asleep', wakes: '07:00' }, NEXT).tags.next.sub).toBe('opens at 07:00');
    expect(daydreamWords(DD, sky, next, NEXT).tags.next.value).toBe(NEXT.value);
  });
  it('says how many ideas it took up and how many shipped, without running them together', () => {
    const n = daydreamWords(DD, sky, next, NEXT).tags.shipped.note;
    expect(n).toContain(`taken up ${DD.impact!.accepted} of its ideas`);
    expect(n).toContain(`${DD.impact!.shipped} have gone on to ship`);
  });
  it('keeps a real zero struck out, and says so', () => {
    const z = daydreamWords({ ...DD, week: { ...DD.week!, struckOut: 0 } }, sky, next, NEXT).tags.struck;
    expect(z.value).toBe('0');
    expect(z.note).toContain('nothing to cross out');
  });
});

describe('healthWords', () => {
  const opts = { bpm: 72, today: 6231, walkStep: 100, overInWindow: 9, days: 30 };
  it('words the record, with the pulse only when it is fresh', () => {
    const w = healthWords(fx.health, opts);
    const by = Object.fromEntries(w.tags.map((t) => [t.id, t]));
    expect(w.head.figure).toBe(2_412_806);
    expect(by.km.value).toBe('1,650.4');
    expect(by.km.sub).toContain('24,318');
    expect(by.over.kicker).toBe('Over 10,000');
    expect(by.over.sub).toBe('nine of the last 30');
    expect(by.recovery.unit).toBe('good of 30');
    expect(by.recovery.sub).toBe('ten middling, three low · today good');
    expect(by.sleep.value).toBe('7.1');
    expect(by.today.sub).toContain('72 bpm');
    expect(healthWords(fx.health, { ...opts, bpm: null }).tags.find((t) => t.id === 'today')!.sub).toBeUndefined();
    wordsOnly([...texts(w.tags), w.key, w.head.aside]);
    noColons([...w.tags.map((t) => t.note), w.key]);
  });
  it('never shows how stale anything is, nor clock times', () => {
    const all = texts(healthWords(fx.health, { ...opts, bpm: null }).tags).join(' ');
    expect(all).not.toMatch(/ago|last synced|asleep|out walking|\d{1,2}:\d{2}/i);
  });
  it('dashes what is missing, and leads with km when the year’s steps are not in', () => {
    const w = healthWords(EMPTY_HEALTH, { bpm: null, today: null, walkStep: 0, overInWindow: 0, days: 30 });
    for (const t of w.tags) expect(t.value).toBe('—');
    // No steps today is a flourish left out, never a claim the phone has sent nothing.
    expect(w.tags.find((t) => t.id === 'today')).toBeUndefined();
    expect(texts(w.tags).join(' ')).not.toMatch(/no steps/i);
    // A fresh pulse still has the cottage to itself.
    const p = healthWords(EMPTY_HEALTH, { bpm: 64, today: null, walkStep: 0, overInWindow: 0, days: 30 });
    expect(p.tags.find((t) => t.id === 'today')).toMatchObject({ kicker: 'Pulse', value: '64', unit: 'bpm' });
    expect(w.head.figure).toBeNull();
    const km = healthWords({ ...EMPTY_HEALTH, kmYear: 12.5 }, { ...opts, bpm: null });
    expect(km.head.figure).toBe(12.5);
    expect(km.head.decimals).toBe(1);
  });
});

describe('appWords', () => {
  it('counts and names the app from its own manifest, quoting the Siri phrases', () => {
    const w = appWords(APP);
    const by = Object.fromEntries(w.tags.map((t) => [t.id, t]));
    expect(by.phone.value).toBe(String(APP.tabs));
    expect(by.phone.sub).toBe(APP.tabNames.join(', '));
    expect(by.watch.value).toBe('Readiness');
    expect(by.watch.sub).toBe('the same number as the health page');
    expect(by.siri.sub).toContain('“Health today”');
    expect(by.games.note).toContain('Draw & Guess');
    expect(by.lock.value).toBe('Live Activity');
    // The parts of the site, with the windows (the doorways) between them, as drawn.
    expect(by.areas.kicker).toBe('Parts of the site');
    expect(by.areas.value).toBe(String(APP.nativeAreas));
    expect(by.areas.sub).toBe(`${APP.nativeEndpoints} windows between them`);
    expect(w.pairing).toBe('A new phone gets in with a code that dies in ten minutes, and the key it’s given lasts 90 days.');
    wordsOnly([...texts(w.tags), w.key, w.pairing]);
    noColons([...w.tags.map((t) => t.note), w.key, w.pairing]);
  });
  it('never names a player', () => {
    expect(texts(appWords(APP).tags).join(' ')).not.toMatch(/won by|player/i);
  });
});

describe('worksWords and signposts', () => {
  it('words the record and the builder', () => {
    const w = worksWords(BUILD, VITALS.builder);
    const by = Object.fromEntries(w.tags.map((t) => [t.id, t]));
    expect(by.today.value).toBe('5');
    expect(by.rate.value).toBe('4.2');
    expect(by.lines.value).toBe('1,286,400');
    expect(by.builder.value).toBe('testing');
    expect(by.builder.sub).toBe('at it right now');
    expect(by.rate.note).toContain('Mon 25 August');
    wordsOnly([...texts(w.tags), w.key]);
    noColons([...w.tags.map((t) => t.note), w.key]);
  });
  it('leaves out the readings that are not in, keeps the builder, and says why', () => {
    const w = worksWords(NO_BUILD, null);
    expect(w.tags.map((t) => t.id)).toEqual(['builder']);
    for (const t of w.tags) expect(t.value).toBe('—');
    expect(w.key).toContain('isn’t answering');
  });
  it('never says nought shipped beside the ideas that did', () => {
    const idle = worksWords(BUILD, { ...VITALS.builder!, active: false, shippedCount: 0 });
    expect(idle.tags.find((t) => t.id === 'builder')!.sub).toBeUndefined();
    const some = worksWords(BUILD, { ...VITALS.builder!, active: false, shippedCount: 3 });
    expect(some.tags.find((t) => t.id === 'builder')!.sub).toBe('3 shipped');
  });
  it('points on to the rest, private family included', () => {
    const arms = signposts(VITALS, Date.parse('2026-10-10T10:00:00Z'), () => '4m ago');
    expect(arms.map((a) => a.href)).toEqual(['/projects/engine-room', '/projects/engine-room', '/projects/engine-room/app']);
    expect(arms[0].status).toBe('12 canvases · ran 4m ago');
    expect(arms[1].status).toBe('two jobs running');
    expect(arms[2].status).toBe('private to the family');
    expect(signposts(null, 0, () => '')[1].status).toBe('the assistant behind it all');
    expect(signposts({ ...VITALS, jkai: { activeJobs: 0 } }, 0, () => '')[1].status).toBe('quiet right now');
    for (const a of arms) expect(a.href).not.toContain('/releases');
  });
});
