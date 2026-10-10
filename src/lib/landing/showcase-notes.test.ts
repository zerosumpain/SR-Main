import { describe, expect, it } from 'vitest';
import type { AppShowcase, DaydreamShowcase, HealthShowcase, ShowcaseData } from './showcase';
import type { LandingVitals } from './live-vitals.svelte';
import {
  PAGES,
  SKETCH_H,
  SKETCH_W,
  TALLY_ROW,
  allCopy,
  areaBoxes,
  callouts,
  checklist,
  clockFace,
  codaItems,
  dayShift,
  deployTally,
  deviceSketch,
  dotRing,
  fairPages,
  fairRows,
  figureEm,
  ringPad,
  dayFace,
  shippedAside,
  fig,
  hourMarks,
  hourly,
  hourlySentence,
  nowBinAt,
  inkArrow,
  inkBox,
  inkRound,
  inkTick,
  moon,
  odometer,
  perDayWords,
  percent,
  plural,
  receipt,
  recoveryDots,
  recoveryPiles,
  REC_PITCH,
  recoverySentence,
  recoveryWords,
  rectFill,
  ruleLines,
  scribbles,
  shortDay,
  sinceLine,
  sleepWords,
  stepChart,
  stepsSentence,
  tallyRows,
  thinkingShare,
  trendWords,
  verdictCols,
  verdictSentence,
} from './showcase-notes';
import { rng } from './notes-ink';

const NOW = Date.parse('2026-10-10T14:30:00Z');

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
  games: ['Tap Duel', 'Wordle Race'],
  backgroundModes: 3,
  liveActivities: true,
  nativeEndpoints: 61,
  nativeAreas: 20,
  pairCodeMinutes: 10,
  deviceTokenDays: 90,
};

const HEALTH: HealthShowcase = {
  // Thirty days, oldest first, the latest with readings last; the rest had none.
  steps30: Array.from({ length: 30 }, (_, i) => (i === 0 ? 4203 : i === 1 ? 15672 : i === 29 ? 9800 : null)),
  stepsYear: 2412806,
  daysOver10k: 97,
  bestDay: { date: '2026-06-15', steps: 24318 },
  kmYear: 1650.4,
  recovery30: { high: 17, mid: 10, low: 3 },
  sleepAvg7: 7.1,
  bands: { sleep: 'mid', recovery: 'high' },
  kinds: null,
};

const DATA: ShowcaseData = {
  daydream: {
    week: { questions: 142, hours: 31.5, lookups: 1204, struckOut: 18, areasCovered: 6 },
    impact: {
      hitRate: 0.73,
      previousHitRate: 0.64,
      rated: 41,
      noticed: 58,
      shipped: 3,
      accepted: 7,
      weeks: [
        { start: '2026-09-28', useful: 4, notUseful: 1, undecided: 2 },
        { start: '2026-10-05', useful: 0, notUseful: 0, undecided: 0 },
      ],
    },
    rules: RULES,
  },
  health: HEALTH,
  app: APP,
};

const V: LandingVitals = {
  jkai: { activeJobs: 2 },
  builder: { stage: 'building', active: true, shippedCount: 3, lastShippedTitle: 'secret title', lastShippedHref: '/x' },
  canvas: { count: 15, lastRunAt: new Date(NOW - 19 * 60_000).toISOString() },
  generatedAt: new Date(NOW).toISOString(),
};

/** Strip every figure the data put in, then any digit left is a literal in the copy. */
function literalDigits(text: string, figures: Array<number | string>): string[] {
  let t = text;
  const all = figures
    .flatMap((f) => (typeof f === 'number' ? [f.toLocaleString('en-GB', { maximumFractionDigits: 1 }), String(f)] : [f]))
    .sort((a, b) => b.length - a.length);
  for (const f of all) t = t.split(f).join('');
  return t.match(/\d/g) ?? [];
}

const prose = (s: string) => {
  expect(s).not.toMatch(/!/);
  // No colons in prose (clock times like 07:00 are figures, not punctuation).
  expect(s.replace(/\d{2}:\d{2}/g, '')).not.toMatch(/:/);
};

describe('figures', () => {
  it('formats en-GB and never shows a missing number as zero', () => {
    expect(fig(2412806)).toEqual({ value: '2,412,806', n: 2412806, decimals: 0 });
    expect(fig(31.5, 1).value).toBe('31.5');
    expect(fig(null)).toEqual({ value: '—', spoken: 'not answering just now', n: null, decimals: 0 });
    expect(fig(undefined, 0, 'none yet').spoken).toBe('none yet');
    expect(fig(Number.NaN).value).toBe('—');
    expect(fig(0).value).toBe('0');
  });
  it('uses the real minus sign', () => {
    expect(fig(-3).value).toBe('−3');
  });
  it('turns a rate into a clamped whole percentage', () => {
    expect(percent(0.734)).toBe(73);
    expect(percent(1.4)).toBe(100);
    expect(percent(null)).toBeNull();
  });
  it('plurals by count, plural for null', () => {
    expect(plural(1, 'day', 'days')).toBe('day');
    expect(plural(2, 'day', 'days')).toBe('days');
    expect(plural(null, 'day', 'days')).toBe('days');
  });
  it('says the trend only with both windows', () => {
    expect(trendWords(0.73, 0.64)).toEqual({ dir: 'up', words: 'up from 64%' });
    expect(trendWords(0.5, 0.64)?.dir).toBe('down');
    expect(trendWords(0.641, 0.639)?.dir).toBe('level');
    expect(trendWords(0.7, null)).toBeNull();
  });
  it('writes days the British way and shifts them by calendar', () => {
    expect(shortDay('2026-06-15')).toBe('15 Jun');
    expect(shortDay('nope')).toBe('');
    expect(dayShift('2026-03-29', 1)).toBe('2026-03-30');
    expect(dayShift('2026-01-01', -1)).toBe('2025-12-31');
  });
});

describe('the pen', () => {
  it('draws the same marks from the same seed', () => {
    expect(inkBox(rng(1), 0, 0, 10, 10)).toBe(inkBox(rng(1), 0, 0, 10, 10));
    expect(inkRound(rng(2), 0, 0, 40, 80, 10)).toMatch(/^M-?[\d.]+,-?[\d.]+ C/);
    expect(inkTick(rng(3), 0, 0)).toMatch(/^M/);
    const a = inkArrow(rng(4), 0, 0, 50, 20);
    expect(a.shaft).toMatch(/^M/);
    expect(a.head.match(/M/g)).toHaveLength(2);
    expect(rectFill(1, 2, 3, 4)).toBe('M1,2 h3 v4 h-3 Z');
  });
  it('builds a closed crescent moon and its stars', () => {
    const m = moon();
    expect(m.body).toMatch(/^M/);
    expect(m.body).not.toMatch(/NaN/);
    expect(m.stars.match(/M/g)).toHaveLength(6);
    expect(moon()).toEqual(m);
  });
});

describe('daydream page', () => {
  it('tallies fifty to a row and owes the rest as +n', () => {
    const t = tallyRows(142);
    expect(t.rows.map((r) => r.count)).toEqual([50, 50, 42]);
    expect(t.more).toBe(0);
    const big = tallyRows(TALLY_ROW * 4 + 17);
    expect(big.rows).toHaveLength(4);
    expect(big.more).toBe(17);
    expect(tallyRows(null)).toEqual({ rows: [], more: 0 });
    expect(tallyRows(0).rows).toHaveLength(0);
  });
  it('shades the share of the waking week', () => {
    expect(thinkingShare(28, { start: 7, end: 23 })).toBeCloseTo(0.25);
    expect(thinkingShare(500, { start: 7, end: 23 })).toBe(1);
    expect(thinkingShare(null, { start: 7, end: 23 })).toBeNull();
    expect(clockFace(0.25).wedge).toMatch(/A22,22 0 0 1/);
    expect(clockFace(0.75).wedge).toMatch(/A22,22 0 1 1/);
    expect(clockFace(null).wedge).toBeNull();
    expect(clockFace(0).wedge).toBeNull();
  });
  it('scribbles out at most five lines and never a word', () => {
    expect(scribbles(18).lines).toHaveLength(5);
    expect(scribbles(2).strikes).toHaveLength(2);
    expect(scribbles(null).lines).toHaveLength(0);
    expect(scribbles(0).lines).toHaveLength(0);
  });
  it('ticks one box per area covered', () => {
    const b = areaBoxes(6, 7);
    expect(b).toHaveLength(7);
    expect(b.filter((x) => x.on)).toHaveLength(6);
    expect(b[6].tick).toBeNull();
    expect(areaBoxes(null, 7).every((x) => !x.on)).toBe(true);
    expect(areaBoxes(12, 3).filter((x) => x.on)).toHaveLength(3);
  });
  it('stacks verdicts bottom up and leaves an empty week bare', () => {
    const cols = verdictCols(DATA.daydream.impact!.weeks, 480, 132);
    expect(cols).toHaveLength(2);
    expect(cols[0].useful?.d).toMatch(/^M/);
    expect(cols[0].useful?.fill).toMatch(/Z$/);
    expect(cols[1]).toMatchObject({ useful: null, notUseful: null, undecided: null, total: 0 });
    expect(verdictCols([], 480, 132)).toEqual([]);
  });
  it('says the verdicts chart in one sentence', () => {
    const s = verdictSentence(DATA.daydream.impact!.weeks);
    expect(s).toBe('Over the last two weeks I marked 4 of its notes useful and 1 not, with 2 still waiting on me.');
    expect(verdictSentence([])).toBe('No verdicts to draw yet.');
    prose(s);
  });
  it('writes the rules from the constants, never from literals', () => {
    const lines = ruleLines(RULES);
    expect(lines[0]).toBe('a think every 45 minutes, 07:00 to 23:00');
    expect(lines.join(' ')).toContain('at most 12 look-ups a think');
    const other = ruleLines({ ...RULES, cadenceMinutes: 30, maxLookups: 9 });
    expect(other[0]).toContain('30 minutes');
    expect(other.join(' ')).toContain('nine look-ups');
    for (const l of lines) expect(literalDigits(l, [45, 21, 12, 4, 2, '07:00', '23:00'])).toEqual([]);
  });
});

describe('health page', () => {
  it('places step bars by day, rings the best and leaves gaps as gaps', () => {
    const c = stepChart(HEALTH.steps30, 600, 190)!;
    expect(c.bars).toHaveLength(3);
    expect(c.bars[0].x).toBeLessThan(c.bars[1].x);
    // The latest day with readings takes the last slot of thirty.
    expect(c.bars[2].x).toBeGreaterThan(560);
    expect(c.bars.filter((b) => b.best).map((b) => b.i)).toEqual([1]);
    expect(c.ring).toMatch(/^M/);
    expect(c.tenK).toBeGreaterThan(0);
    expect(c.tenK).toBeLessThan(190);
  });
  it('draws nothing without days', () => {
    expect(stepChart(null, 600, 190)).toBeNull();
    expect(stepChart([], 600, 190)).toBeNull();
    expect(stepChart([null, null], 600, 190)).toBeNull();
  });
  it('says the step chart in words', () => {
    const s = stepsSentence(HEALTH.steps30);
    expect(s).toContain('from 4,203 to 15,672');
    expect(s).toContain('one of them over ten thousand');
    expect(stepsSentence(null)).toBe('No complete days of steps to draw yet.');
    prose(s);
  });
  it('sums quarter-hours to hours and leaves the future null', () => {
    const bins = Array.from({ length: 96 }, (_, i) => (i < 4 ? 10 : i === 40 ? 500 : 0));
    const h = hourly(bins, 41);
    expect(h).toHaveLength(24);
    expect(h[0]).toBe(40);
    expect(h[10]).toBe(500);
    expect(h[11]).toBeNull();
    expect(hourly(null, 41).every((x) => x == null)).toBe(true);
    const m = hourMarks(h, 480, 64, 41);
    expect(m.now).toBe(220);
    expect(m.strokes).toMatch(/^M/);
    expect(m.hatch).toMatch(/^M/);
  });
  it('knows the hour from the clock when the phone has sent nothing, and hatches only what is to come', () => {
    const bin = nowBinAt(NOW);
    // 14:30 UTC is 15:30 in London in October.
    expect(bin).toBe(62);
    const none = hourly(null, bin);
    expect(none.every((x) => x == null)).toBe(true);
    const m = hourMarks(none, 480, 64, bin);
    expect(m.now).toBe(320);
    expect(m.strokes).toBe('');
    // The hatch starts at now, never over the hours already gone.
    const xs = [...m.hatch.matchAll(/M([\d.]+),/g)].map((x) => Number(x[1]));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(320);
  });
  it('says today in words, and says none rather than zero', () => {
    expect(hourlySentence([1, 0, null], 1)).toBe('Today so far, 1 step spread over one of the hours gone.');
    expect(hourlySentence([1200, 0, null], 1200)).toBe('Today so far, 1,200 steps spread over one of the hours gone.');
    // With nothing in, it describes the chart and claims nothing about the phone.
    expect(hourlySentence([], null)).not.toMatch(/no steps|phone|yet/i);
  });
  it('piles the recovery days by band, never as a calendar', () => {
    const p = recoveryPiles({ high: 17, mid: 10, low: 2 })!;
    expect(p.piles.map((x) => [x.band, x.count])).toEqual([
      ['high', 17],
      ['mid', 10],
      ['low', 2],
      [null, 1],
    ]);
    expect(p.piles[0].dots).toHaveLength(17);
    // Bottom up: the first dot of every pile sits on the floor.
    for (const pile of p.piles) expect(pile.dots[0][1]).toBe(p.h - REC_PITCH / 2);
    expect(recoveryPiles({ high: 20, mid: 10, low: 0 })!.piles).toHaveLength(3);
    expect(recoveryPiles(null)).toBeNull();
  });
  it('lays out thirty recovery dots, best first, gaps for missing days', () => {
    const d = recoveryDots({ high: 17, mid: 10, low: 2 });
    expect(d).toHaveLength(30);
    expect(d.slice(0, 17).every((x) => x === 'high')).toBe(true);
    expect(d[29]).toBeNull();
    expect(recoveryDots(null)).toEqual([]);
    expect(dotRing(1, 10, 10, 5)).toBe(dotRing(1, 10, 10, 5));
    expect(recoverySentence({ high: 17, mid: 10, low: 3 })).toBe('Of the last thirty days, 17 were good, 10 middling and 3 low, piled up by band rather than by date.');
    expect(recoverySentence({ high: 9, mid: 10, low: 3 })).toMatch(/^Of the last thirty days, nine were good, ten middling and three low/);
    expect(recoverySentence(null)).toBe('No recovery readings to draw yet.');
  });
  it('words the bands and nothing more', () => {
    expect(sleepWords('mid')).toBe('about average');
    expect(sleepWords(null)).toBeNull();
    expect(recoveryWords('high')).toBe('good');
    expect(recoveryWords('low')).toBe('low');
  });
  it('rolls the odometer to the tenth', () => {
    expect(odometer(1650.44)).toEqual({ whole: ['1', ',', '6', '5', '0'], tenth: '4' });
    expect(odometer(999.96)).toEqual({ whole: ['1', ',', '0', '0', '0'], tenth: '0' });
    expect(odometer(0)).toEqual({ whole: ['0'], tenth: '0' });
    expect(odometer(null)).toBeNull();
    expect(odometer(-1)).toBeNull();
  });
});

describe('app page', () => {
  it('numbers only the parts the manifest has', () => {
    const c = callouts(APP);
    expect(c.map((x) => x.n)).toEqual([1, 2, 3, 4, 5]);
    expect(c[1].text).toBe('Two of its three widgets on the Home Screen');
    expect(c[2].text).toBe('Readiness on the watch, the same number as on the health page');
    expect(c[1].more).toBe('Family steps and Family tasks');
    expect(c[3].more).toBe('“Hey Siri, health today”, “Hey Siri, ask jkai”, “Hey Siri, sync now”');
    expect(callouts({ ...APP, intents: [{ title: 'Ask JKAI' }] })[3].more).toBe('“Hey Siri, ask JKAI”');
    expect(callouts({ ...APP, widgets: APP.widgets.slice(1) })[1].text).toBe('Two widgets on the Home Screen');
    for (const x of c) {
      expect(x.at[0]).toBeGreaterThanOrEqual(0);
      expect(x.at[0]).toBeLessThanOrEqual(1);
      prose(x.text);
    }
    const bare = callouts({ ...APP, liveActivities: false, widgets: [], complications: [], intents: [], games: [] });
    expect(bare).toEqual([]);
  });
  it('draws the sketch inside its box', () => {
    const s = deviceSketch();
    expect(s.games).toHaveLength(10);
    expect(SKETCH_W).toBeGreaterThan(0);
    expect(SKETCH_H).toBeGreaterThan(0);
    expect(deviceSketch()).toEqual(s);
  });
  it('itemises the receipt from the source', () => {
    const r = receipt(APP);
    expect(r.find((x) => x.k === 'tabs')).toEqual({ k: 'tabs', v: '8', sub: 'today · chat · health · family · games · news · flows · more' });
    expect(r.find((x) => x.k === 'pairing code dies in')?.v).toBe('10 min');
    expect(r.find((x) => x.k === 'paired key lasts')?.v).toBe('90 days');
    for (const x of r) expect(literalDigits(x.k, [])).toEqual([]);
  });
});

describe('build page', () => {
  it('ticks the steps and says the bench, never a title', () => {
    const c = checklist(V);
    expect(c.steps.length).toBeGreaterThan(3);
    expect(c.bench).toEqual({ text: 'on the bench now, building', live: true });
    expect(JSON.stringify(c)).not.toContain('secret title');
    expect(checklist({ ...V, builder: { ...V.builder, active: false } }).bench).toEqual({ text: 'the bench is clear just now', live: false });
    expect(checklist(null).bench).toBeNull();
  });
  it('dates and averages in words', () => {
    expect(sinceLine('2026-03-19T10:00:00Z', 205, NOW)).toBe('since March, over 205 days');
    expect(sinceLine('2025-03-19T10:00:00Z', null, NOW)).toBe('since March 2025');
    expect(sinceLine(null, 205, NOW)).toBeNull();
    expect(perDayWords(6.8)).toBe('about 6.8 a day on average');
    expect(perDayWords(12.4)).toBe('about 12 a day on average');
    expect(perDayWords(null)).toBeNull();
    expect(perDayWords(0)).toBeNull();
  });
  it('tallies today only when there is something to tally', () => {
    expect(deployTally(7)).toMatch(/^M/);
    expect(deployTally(0)).toBeNull();
    expect(deployTally(null)).toBeNull();
  });
});

describe('the rest', () => {
  it('says what each is up to, and a dash until the poll answers', () => {
    const c = codaItems(V, NOW);
    expect(c.map((x) => x.href)).toEqual(['/projects/engine-room', '/projects/engine-room', '/projects/engine-room/app']);
    expect(c[0].line).toMatch(/^15 canvases running, the last ran/);
    expect(c[1].line).toBe('my assistant is busy with two jobs');
    expect(c[2].line).toBe('private to the family');
    const quiet = codaItems({ ...V, jkai: { activeJobs: 0 }, canvas: { count: 0, lastRunAt: null } }, NOW);
    expect(quiet[0].line).toBe('no canvases running just now');
    expect(quiet[1].line).toBe('my assistant is quiet just now');
    const none = codaItems(null, NOW);
    expect(none[0]).toMatchObject({ line: '—', spoken: 'not answering just now' });
    expect(none[1]).toMatchObject({ line: '—', spoken: 'not answering just now' });
    expect(c.map((x) => x.href).join()).not.toContain('/releases');
  });
});

describe('fair copy', () => {
  const build = { releases: 1389, linesWritten: 1720172, days: 205, firstDeploy: null, deploysPerDay: 6.8, deploysToday: 7, fromDaydream: 3 };
  const facts = { daydream: { cadenceMinutes: 45, activeHours: { start: 7, end: 23 }, hitRate: null, windowDays: 28 }, app: { nativeEndpoints: 61 } };
  const base = { data: DATA, build, v: V, now: NOW, facts, steps: null };
  it('types up every reading, page by page, with dashes for the missing', () => {
    const pages = fairPages({ ...base, pulse: { state: 'fresh', bpm: 72, at: '' } });
    expect(Object.keys(pages)).toEqual(['daydream', 'health', 'app', 'build', 'rest']);
    const rows = fairRows({ ...base, pulse: { state: 'fresh', bpm: 72, at: '' } });
    const get = (k: string) => rows.find((r) => r.k === k)?.v;
    expect(get('Steps this year')).toBe('2,412,806');
    expect(get('Rated notes marked useful, the last 28 days')).toBe('73% of 41, up from 64%');
    expect(get('Verdicts over two weeks')).toBe('4 useful, 1 not, 2 waiting');
    expect(get('Steps today')).toBe('—');
    expect(get('Heart rate, fresh from the watch')).toBe('72 bpm');
    expect(get('Best day this year')).toBe('24,318 steps, 15 Jun');
    expect(get('Last night’s sleep')).toBe('about average');
    expect(get('Today’s recovery')).toBe('good');
    expect(get('Lines of code written')).toBe('1,720,172');
    expect(get('The builder')).toBe('on the bench now, building');
    expect(get('Answer back')).toBe('my assistant is busy with two jobs');
    expect(get('Just now')).toMatch(/^(next think in|the site is|the daydreamer is)/);
    // All four rules, each with its own key.
    expect(pages.daydream.filter((r) => ['How often it thinks', 'Thinks a day', 'Look-ups', 'Notes'].includes(r.k))).toHaveLength(4);
    for (const r of rows) expect(r.k).not.toBe('');
  });
  it('never mentions a stale pulse', () => {
    const rows = fairRows({ ...base, pulse: { state: 'stale', at: '2026-10-01T00:00:00Z' } });
    expect(rows.find((r) => r.k.startsWith('Heart rate'))).toBeUndefined();
    expect(JSON.stringify(rows)).not.toContain('2026-10-01');
  });
  it('keeps a null week as dashes, never zeros, and never prints a share of nothing', () => {
    const d: ShowcaseData = { ...DATA, daydream: { ...DATA.daydream, week: null, impact: null } };
    const rows = fairRows({ ...base, data: d, pulse: { state: 'none' } });
    expect(rows.find((r) => r.k === 'Questions it asked itself this week')?.v).toBe('—');
    expect(rows.find((r) => r.k.startsWith('Rated notes marked useful'))?.v).toBe('—');
    expect(rows.find((r) => r.k === 'Areas of life covered')?.v).toBe('—');
    expect(JSON.stringify(rows)).not.toContain('% of 0');
  });
});

describe('the notebook’s extras', () => {
  it('rings a figure with room to clear its corners', () => {
    expect(figureEm('1,720,172')).toBeGreaterThan(figureEm('73%'));
    expect(ringPad(figureEm('1,720,172'))).toBeGreaterThan(1);
    expect(ringPad(figureEm('61'))).toBeGreaterThanOrEqual(0.34);
  });
  it('draws the day on one face, a dot for every chance to think', () => {
    const f = dayFace(RULES, 15.5);
    expect(f.slots).toHaveLength(21);
    expect(f.wedge).toMatch(/^M40,40 L/);
    expect(f.hand).toMatch(/^M/);
    expect(dayFace(RULES, null).hand).toBeNull();
    expect(dayFace(RULES, 3)).toEqual(dayFace(RULES, 3));
  });
  it('points on to the shipped ideas only when there are some', () => {
    expect(shippedAside(3)).toBe('three of its ideas have shipped as code, three pages on.');
    expect(shippedAside(1)).toBe('one of its ideas has shipped as code, three pages on.');
    expect(shippedAside(0)).toBeNull();
    expect(shippedAside(null)).toBeNull();
  });
  it('puts the best day’s figure beside its ring', () => {
    const c = stepChart(HEALTH.steps30, 600, 190)!;
    expect(c.bestAt?.steps).toBe(15672);
    expect(c.ring).toMatch(/^M/);
  });
});

describe('copy rules', () => {
  const copy = allCopy();
  it('has every page in order with its link', () => {
    expect(Object.keys(PAGES)).toEqual(['daydream', 'health', 'app', 'build', 'rest']);
    expect(Object.values(PAGES).map((p) => p.href)).not.toContain('/releases');
  });
  it('writes no digits, no exclamation marks and no colons', () => {
    for (const s of copy) {
      expect(s).not.toMatch(/\d/);
      prose(s);
    }
  });
  it('keeps to British spellings and no marketing words', () => {
    const all = copy.join(' ').toLowerCase();
    for (const w of ['seamless', 'journey', 'leverage', 'robust', 'color', 'organize', "it's not just"]) expect(all).not.toContain(w);
  });
  it('generated lines carry only the figures they were given', () => {
    const lines = [
      ...ruleLines(RULES),
      verdictSentence(DATA.daydream.impact!.weeks),
      recoverySentence(HEALTH.recovery30),
      stepsSentence(HEALTH.steps30),
      ...callouts(APP).map((c) => c.text),
      ...codaItems(V, NOW).map((c) => c.line),
    ];
    for (const l of lines) {
      prose(l);
      expect(literalDigits(l, [45, 21, 12, 2, 4, 1, 17, 10, 3, 4203, 15672, 15, 19, '07:00', '23:00'])).toEqual([]);
    }
  });
});
