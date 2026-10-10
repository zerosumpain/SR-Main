import { describe, expect, it } from 'vitest';
import {
  DASH,
  FIRST_NOTE,
  STEP_GOAL,
  appChapter,
  bandMarks,
  bandWord,
  bandsSummary,
  buildChapter,
  builderSide,
  capWord,
  chapterStrings,
  codaSegments,
  counted,
  dayCells,
  daydreamChapter,
  daydreamSide,
  daysSummary,
  deployCells,
  deploysSummary,
  figureEms,
  healthChapter,
  hourBars,
  hoursSummary,
  joinClauses,
  layoutRun,
  longDate,
  longDay,
  standfirst,
  widgetName,
  numberNotes,
  pct,
  plainText,
  plural,
  sentenceChapters,
  verdictColumns,
  verdictSummary,
  type ChapterCopy,
  type Seg,
} from './showcase-sentence';
import type { ShowcaseProps } from './showcase';
import type { LandingVitals } from './live-vitals.svelte';
import { showcaseFixture } from './showcase.fixture';
import { NOTES } from './sentence';
import { thinkSchedule } from './rhythm';
import { wildmindChapter } from './showcase-sentence-wildmind';
import { wildmindFixture } from './wildmind.fixture';
import { offlineShowcase } from './wildmind';

// 14:30 London on a Saturday in October (BST).
const NOW = Date.parse('2026-10-10T13:30:00Z');
const TODAY = '2026-10-10';

const RULES = {
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

const APP = {
  targets: 4,
  tabs: 8,
  tabNames: ['today', 'chat', 'health', 'family', 'games', 'news', 'flows', 'more'],
  watchPages: 4,
  widgets: [
    { name: 'Journey', surface: 'live-activity' },
    { name: 'Family steps', surface: 'home-screen' },
    { name: 'Family tasks', surface: 'home-screen' },
  ],
  complications: [{ name: 'Readiness' }, { name: 'Alerts' }],
  intents: [{ title: 'Health today' }, { title: 'Ask jkai' }, { title: 'Sync now' }],
  games: ['Tap Duel', 'Wordle Race', 'Quiz Night'],
  backgroundModes: 3,
  liveActivities: true,
  nativeEndpoints: 61,
  nativeAreas: 20,
  pairCodeMinutes: 10,
  deviceTokenDays: 90,
};

const VITALS: LandingVitals = {
  jkai: { activeJobs: 2 },
  builder: { stage: 'Testing', active: true, shippedCount: 1, lastShippedTitle: 'Secret title', lastShippedHref: '/x' },
  canvas: { count: 15, lastRunAt: new Date(NOW - 19 * 60_000).toISOString() },
  daydream: { lastRunAt: null, nextRunAt: new Date(NOW + 12 * 60_000).toISOString(), paused: false },
  generatedAt: new Date(NOW).toISOString(),
};

function bins(): number[] {
  const b = new Array(96).fill(0);
  b[32] = 400; // 08:00
  b[36] = 1200; // 09:00
  b[52] = 300; // 13:00
  return b;
}

function full(): ShowcaseProps {
  const fx = showcaseFixture(TODAY);
  return {
    data: {
      daydream: { ...fx.daydream, rules: RULES },
      health: fx.health,
      app: APP,
      fixture: true,
    },
    build: {
      releases: 1389,
      linesWritten: 1_720_172,
      days: 205,
      firstDeploy: '2026-03-19T10:00:00Z',
      deploysPerDay: 6.8,
      deploysToday: 1,
      fromDaydream: 3,
    },
    v: VITALS,
    now: NOW,
    pulse: { state: 'fresh', bpm: 72, at: new Date(NOW - 120_000).toISOString() },
    steps: { bins: bins(), total: 1900, nowBin: 54 },
    cadence: [
      { date: '2026-10-08', count: 4 },
      { date: '2026-10-09', count: 11 },
      { date: '2026-10-10', count: 1 },
    ],
    facts: { daydream: { cadenceMinutes: 45, activeHours: { start: 7, end: 23 }, hitRate: null, windowDays: 28 }, app: { nativeEndpoints: 61 } },
  };
}

/** Everything nullable set to null: the record isn't answering. */
function empty(): ShowcaseProps {
  const p = full();
  return {
    ...p,
    data: {
      daydream: { week: null, impact: null, rules: RULES },
      health: {
        steps30: null,
        stepsYear: null,
        daysOver10k: null,
        bestDay: null,
        kmYear: null,
        recovery30: null,
        sleepAvg7: null,
        bands: { sleep: null, recovery: null },
        kinds: null,
      },
      app: APP,
    },
    build: { releases: null, linesWritten: null, days: null, firstDeploy: null, deploysPerDay: null, deploysToday: null, fromDaydream: null },
    v: null,
    pulse: { state: 'stale', at: new Date(NOW - 9 * 3_600_000).toISOString() },
    steps: null,
    cadence: [],
  };
}

const ctx = (p: ShowcaseProps) => ({ ...p, todayKey: TODAY });
const allStrings = (cs: ChapterCopy[]) => cs.flatMap(chapterStrings);
const words = (segs: Seg[]) => segs.filter((s): s is Extract<Seg, { t: 'word' }> => s.t === 'word');
const allWords = (c: ChapterCopy) => words([...c.p1, ...(c.p2?.segs ?? [])]);

describe('figures', () => {
  it('formats en-GB with the real minus sign', () => {
    expect(plural(1234567, 'step')).toBe('1,234,567 steps');
    expect(plural(1, 'step')).toBe('1 step');
    expect(pct(0.734)).toBe('73%');
    expect(capWord(3)).toBe('Three');
    expect(capWord(12)).toBe('12');
    expect(counted(8, 'tab')).toBe('eight tabs');
    expect(counted(1, 'piece')).toBe('one piece');
  });
  it('sizes a figure by its glyphs, never below a floor', () => {
    expect(figureEms('2,412,806')).toBeCloseTo(7 * 0.64 + 2 * 0.3 - 0.64 * 0, 1);
    expect(figureEms('61')).toBe(1.6);
    expect(figureEms(DASH)).toBe(1.6);
    expect(figureEms('2,412,806')).toBeGreaterThan(figureEms('142'));
  });
  it('names bands in plain words', () => {
    expect([bandWord('high'), bandWord('mid'), bandWord('low')]).toEqual(['good', 'middling', 'low']);
  });
  it('writes a long date, or null', () => {
    expect(longDate('2026-03-19T10:00:00Z')).toBe('19 March 2026');
    expect(longDate(null)).toBeNull();
    expect(longDate('nonsense')).toBeNull();
  });
});

describe('verdictColumns', () => {
  it('stacks each week as shares of the busiest', () => {
    const cols = verdictColumns([
      { start: '2026-09-28', useful: 4, notUseful: 2, undecided: 2 },
      { start: '2026-10-05', useful: 2, notUseful: 0, undecided: 2 },
    ]);
    expect(cols[0]).toMatchObject({ hUseful: 0.5, hNotUseful: 0.25, hUndecided: 0.25 });
    expect(cols[1].hUseful + cols[1].hNotUseful + cols[1].hUndecided).toBe(0.5);
  });
  it('treats junk as zero and survives an empty record', () => {
    expect(verdictColumns([{ start: 'x', useful: -1, notUseful: NaN, undecided: 0 }])[0]).toMatchObject({ useful: 0, hUseful: 0 });
    expect(verdictColumns([])).toEqual([]);
    expect(verdictSummary([])).toBe('No verdicts on record yet.');
  });
  it('sums the verdicts for a screen reader', () => {
    const cols = verdictColumns([{ start: 'a', useful: 3, notUseful: 1, undecided: 2 }]);
    expect(verdictSummary(cols)).toBe('Over one weeks, 3 notes marked useful, 1 not useful and 2 still undecided.');
  });
});

describe('hourBars', () => {
  it('folds 96 quarter-hours into 24 hourly bars, nothing after now', () => {
    const b = hourBars({ bins: bins(), total: 1900, nowBin: 54 });
    expect(b).toHaveLength(24);
    expect(b[8]).toMatchObject({ steps: 400, state: 'past' });
    expect(b[9]).toMatchObject({ steps: 1200, h: 1 });
    expect(b[13]).toMatchObject({ steps: 300, state: 'now' });
    expect(b[14]).toMatchObject({ steps: 0, h: 0, state: 'future' });
  });
  it('ignores readings binned after now', () => {
    const raw = bins();
    raw[60] = 9999;
    expect(hourBars({ bins: raw, total: 1, nowBin: 54 })[15].steps).toBe(0);
  });
  it('draws an empty day as all future with no data', () => {
    const b = hourBars(null);
    expect(b.every((x) => x.state === 'future' && x.h === 0)).toBe(true);
  });
  it('says what the picture shows, and never a time of day', () => {
    const s = { bins: bins(), total: 1900, nowBin: 54 };
    const text = hoursSummary(s, hourBars(s));
    expect(text).toBe('1,900 steps so far today, with some walking in three of the 14 hours since midnight.');
    expect(text).not.toMatch(/\d:\d/);
    expect(hoursSummary(null, hourBars(null))).toMatch(/No steps/);
  });
});

describe('dayCells', () => {
  const window = (last: Record<number, number>) => Array.from({ length: 30 }, (_, i) => last[i] ?? null);
  it('draws thirty days oldest first, a missing day as a dash', () => {
    const cells = dayCells(window({ 0: 12_400, 29: 4_203 }));
    expect(cells).toHaveLength(30);
    expect(cells[0]).toMatchObject({ i: 0, k: '12', over: true });
    expect(cells[29]).toMatchObject({ i: 29, k: '4', over: false });
    expect(cells[5]).toMatchObject({ steps: null, k: '–', over: false });
  });
  it('keeps every numeral at or above the contrast floor', () => {
    const cells = dayCells(window({ 29: 1, 28: 20_000 }));
    expect(Math.min(...cells.map((c) => c.a))).toBeGreaterThanOrEqual(0.68);
  });
  it('counts a day of exactly the goal as over it', () => {
    expect(dayCells(window({ 29: STEP_GOAL }))[29].over).toBe(true);
  });
  it('returns nothing for no record, and summarises honestly', () => {
    expect(dayCells(null)).toEqual([]);
    expect(daysSummary([])).toBe('No days of steps on record.');
    const cells = dayCells(window({ 29: 11_000, 28: 5_000 }));
    expect(daysSummary(cells)).toBe('The last 30 days with readings ran from 5,000 to 11,000 steps, one of them at or over 10,000.');
  });
});

describe('bandMarks', () => {
  it('sorts the days by band, best first', () => {
    expect(bandMarks({ high: 2, mid: 1, low: 1 })).toEqual(['high', 'high', 'mid', 'low']);
    expect(bandMarks(null)).toEqual([]);
    expect(bandMarks({ high: -1, mid: 1.7, low: NaN })).toEqual(['mid']);
  });
  it('says it is sorted, not a diary', () => {
    expect(bandsSummary({ high: 17, mid: 10, low: 3 })).toBe('17 good, ten middling and three low, sorted by band rather than by date.');
    expect(bandsSummary(null)).toBe('No recovery on record.');
  });
});

describe('deployCells', () => {
  it('lays out forty days ending today, today marked', () => {
    const cells = deployCells(full().cadence, TODAY);
    expect(cells).toHaveLength(40);
    expect(cells[39]).toMatchObject({ date: TODAY, count: 1, today: true });
    expect(cells[38].count).toBe(11);
    expect(cells[0].count).toBe(0);
    expect(Math.min(...cells.map((c) => c.a))).toBeGreaterThanOrEqual(0.72);
  });
  it('is empty with no record', () => {
    expect(deployCells([], TODAY)).toEqual([]);
    expect(deploysSummary([])).toBe('No deploys on record.');
  });
  it('summarises the busiest day', () => {
    expect(deploysSummary(deployCells(full().cadence, TODAY))).toBe('16 deploys in the last 40 days, the busiest 11 on Fri 9 Oct, and 37 quiet days.');
  });
});

describe('live states', () => {
  it('reads the daydreamer', () => {
    expect(daydreamSide({ state: 'next', minutes: 12 })).toEqual({ text: 'next think in 12 minutes', live: true });
    expect(daydreamSide({ state: 'now' })).toEqual({ text: 'thinking now', live: true });
    expect(daydreamSide({ state: 'asleep', wakes: '07:00' })).toEqual({ text: 'asleep till 07:00' });
    expect(daydreamSide({ state: 'off' }).live).toBeUndefined();
    expect(daydreamSide({ state: 'late', minutes: 99 }).text).not.toMatch(/\d/);
    expect(daydreamSide({ state: 'unknown', cadence: 45 }).text).toBe('a think every 45 minutes');
  });
  it('reads the builder, never its last title', () => {
    expect(builderSide(VITALS)).toEqual({ text: 'building now · testing', live: true });
    expect(builderSide({ ...VITALS, builder: { ...VITALS.builder, active: false } })).toEqual({ text: 'the builder is idle' });
    expect(builderSide(null)).toBeNull();
  });
});

describe('layoutRun', () => {
  const note = { head: 'h', text: 't', visual: { kind: 'none' as const } };
  it('puts a footnote after the sentence its word is in', () => {
    const run = layoutRun([
      { t: 'text', s: 'I walked ' },
      { t: 'word', id: 'a', word: 'far', tone: 'accent', note, n: 6 },
      { t: 'text', s: ' today. Then home.' },
    ]);
    expect(run.map((p) => p.t)).toEqual(['text', 'word', 'text', 'note', 'text']);
    expect(run[2]).toEqual({ t: 'text', s: ' today.' });
    expect(run[4]).toEqual({ t: 'text', s: ' Then home.' });
  });
  it('glues punctuation to the word, before its note number', () => {
    const run = layoutRun([
      { t: 'word', id: 'a', word: 'four', tone: 'accent', note, n: 6 },
      { t: 'text', s: ', with more.' },
    ]);
    expect(run[0]).toMatchObject({ t: 'word', end: ',' });
    expect(run[1]).toEqual({ t: 'text', s: ' with more.' });
    expect(run[2].t).toBe('note');
  });
  it('a full stop glued to the word lets the note follow at once', () => {
    const run = layoutRun([{ t: 'word', id: 'a', word: 'good', tone: 'accent', note, n: 6 }, { t: 'text', s: '.' }]);
    expect(run.map((p) => p.t)).toEqual(['word', 'note']);
    expect(run[0]).toMatchObject({ end: '.' });
  });
  it('flushes notes left waiting at the end of the run', () => {
    const run = layoutRun([{ t: 'word', id: 'a', word: 'x', tone: 'ink', note, n: 6 }, { t: 'text', s: ' and on' }]);
    expect(run.at(-1)?.t).toBe('note');
  });
  it('leaves plain words and links alone', () => {
    const run = layoutRun([{ t: 'word', id: 'a', word: 'x', tone: 'ink' }, { t: 'text', s: ', y.' }]);
    expect(run).toEqual([{ t: 'word', id: 'a', word: 'x', tone: 'ink' }, { t: 'text', s: ', y.' }]);
  });
});

describe('joinClauses', () => {
  it('joins as prose does', () => {
    const c = (s: string): Seg[] => [{ t: 'text', s }];
    expect(plainText(joinClauses([c('a')]))).toBe('a');
    expect(plainText(joinClauses([c('a'), c('b')]))).toBe('a and b');
    expect(plainText(joinClauses([c('a'), c('b'), c('c')], ', and '))).toBe('a, b, and c');
  });
});

describe('the chapters, with every figure in', () => {
  const cs = sentenceChapters(full());

  it('tells the same four chapters in order', () => {
    expect(cs.map((c) => c.id)).toEqual(['daydream', 'health', 'app', 'build']);
    expect(cs.map((c) => c.ground)).toEqual(['paper', 'paper', 'ink', 'paper']);
    expect(cs.map((c) => c.figure.value)).toEqual([142, 2_412_806, 61, 1389]);
  });

  it('numbers footnotes on from the hero, in reading order, without gaps', () => {
    const ns = cs.flatMap((c) => allWords(c).filter((w) => w.note).map((w) => w.n));
    expect(FIRST_NOTE).toBe(NOTES.length + 1);
    expect(ns[0]).toBe(FIRST_NOTE);
    expect(ns).toEqual(ns.map((_, i) => FIRST_NOTE + i));
  });

  it('gives every footnoted word a unique id', () => {
    const ids = cs.flatMap((c) => allWords(c).map((w) => w.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('reads Daydream as prose', () => {
    const d = cs[0];
    expect(plainText(d.p1)).toBe(
      'I taught the site to daydream. Every 45 minutes between 07:00 and 23:00 it picks one corner of my life, asks itself one narrow question about it, goes off and looks things up, and writes down only what it thinks I ought to see. This week that came to 31.5 hours of thinking and 1,204 look-ups across six of seven areas of life, and its own auditor struck out 18 claims it couldn’t stand behind.',
    );
    expect(plainText(d.p2!.segs)).toBe(
      'I mark what it tells me as useful or not from my phone, and over the last 28 days 73% of the 41 notes I rated were worth having, up from 64% the stretch before. Three of its ideas have gone on to become real code on this site, which is a better strike rate than most of mine.',
    );
    expect(d.side).toEqual([{ text: 'next think in 12 minutes', live: true }]);
    const hit = allWords(d).find((w) => w.id === 'dd-hit')!;
    expect(hit.note?.visual.kind).toBe('verdicts');
    expect(allWords(d).find((w) => w.id === 'dd-cadence')!.note?.visual.kind).toBe('slots');
  });

  it('reads the health record as prose, with the pulse only because it is fresh', () => {
    const h = cs[1];
    expect(plainText(h.p1)).toBe(
      'My watch and phone keep a closer record of me than I’d ever manage by hand, and the site reads it every day. This year I’ve covered 1,650.4 km on foot, passed 10,000 steps on 97 days and managed 24,318 steps on my best day, back on Monday 15 June. Today I’m on 1,900 steps so far.',
    );
    expect(plainText(h.p2!.segs)).toBe(
      'The line above this chapter is my heartbeat, drawn at the rate my watch last read. Over the last 30 days I’ve had 17 days of good recovery, ten middling and three low, and I’ve slept 7.1 hours a night on average this past week. Last night’s sleep was middling and today’s recovery reads good.',
    );
    expect(h.side).toEqual([{ text: '72 bpm, as my watch last read it', live: true }]);
    const kinds = allWords(h).map((w) => w.note?.visual.kind).filter(Boolean);
    expect(kinds).toEqual(expect.arrayContaining(['days', 'hours', 'bands']));
  });

  it('reads the app as prose, quoting Siri and listing the tabs', () => {
    const a = cs[2];
    expect(plainText(a.p1)).toBe(
      'There’s an app too, on my iPhone and my Apple Watch, with eight tabs, three widgets, one of them a Live Activity on the Lock Screen, and two complications for the watch. The Readiness one shows the same number as the health page, so my wrist and the website can’t disagree. I can ask Siri for three things by name, and there are three family games for evenings when we really ought to be doing something else.',
    );
    expect(plainText(a.p2!.segs)).toContain('a code that dies in 10 minutes, swapped for a key that lasts 90 days.');
    expect(plainText(a.p2!.segs)).toContain('The app is also where the loop closes, because Daydream’s notes land in a little inbox on its More page');
    const widgets = allWords(a).find((w) => w.id === 'a-widgets')!.note!.visual;
    expect(widgets).toEqual({ kind: 'list', items: ['Live Activity · Lock Screen', 'Family steps · Home Screen', 'Family tasks · Home Screen'] });
    const siri = allWords(a).find((w) => w.id === 'a-siri')!.note!.visual;
    expect(siri).toEqual({ kind: 'quotes', lines: ['Health today', 'Ask jkai', 'Sync now'] });
    const tabs = allWords(a).find((w) => w.id === 'a-tabs')!.note!.visual;
    expect(tabs).toEqual({ kind: 'list', items: APP.tabNames });
  });

  it('reads the builder as prose, with its deploy row', () => {
    const b = cs[3];
    expect(plainText(b.p1)).toBe(
      'When I accept one of its ideas, or hand it one of my own, a builder writes the change, tests it and puts it up for me to look at, and once I say yes it ships itself. That’s been going for 205 days at about 6.8 deploys a day, with one today so far, and three of the ideas it built came from Daydream.',
    );
    expect(plainText(b.p2!.segs)).toBe('Between them those releases have added 1,720,172 lines of code, very few of which I typed and all of which I have to live with.');
    expect(allWords(b).find((w) => w.id === 'b-rate')!.note!.visual.kind).toBe('deploys');
    expect(b.side).toEqual([{ text: 'building now · testing', live: true }]);
  });

  it('closes with one linked sentence, never the private release record', () => {
    const segs = codaSegments(full());
    expect(plainText(segs)).toBe(
      'The site also runs 15 jobs of its own on a timetable, the latest 19 minutes ago. It answers back when I ask it something, with two jobs on the go just now, and keeps a corner for the family that stays between us.',
    );
    const hrefs = words(segs).map((w) => w.href ?? '');
    expect(hrefs).toEqual(['/projects/engine-room', '', '/projects/engine-room', '/projects/engine-room/app']);
    const links = [...cs.map((c) => c.link?.href ?? ''), ...cs.flatMap((c) => allWords(c).map((w) => w.note?.href ?? '')), ...hrefs];
    expect(links.some((h) => h.startsWith('/releases'))).toBe(false);
  });
});

describe('honest empty states', () => {
  const cs = sentenceChapters(empty());

  it('shows a dash for each missing headline figure, never a zero', () => {
    expect(cs.map((c) => c.figure.value)).toEqual([null, null, 61, null]);
    for (const c of cs) expect(c.figure.spoken).toBe('not answering just now');
  });

  it('says the record is not answering rather than inventing figures', () => {
    expect(plainText(cs[0].p1)).toContain('This week’s tally isn’t answering just now.');
    expect(plainText(cs[0].p2!.segs)).toBe('I mark what it tells me as useful or not from my phone, and how that’s going isn’t answering just now.');
    expect(plainText(cs[1].p1)).toContain('This year’s totals aren’t answering just now.');
    expect(plainText(cs[1].p2!.segs)).toBe('The rest of the record isn’t answering just now.');
    expect(cs[3].p2).toBeNull();
  });

  it('leaves out what the hero has already said is missing', () => {
    // No steps yet today, no release record: the hero says so; the essay
    // doesn't repeat it, it just doesn't add the clause.
    expect(plainText(cs[1].p1)).not.toMatch(/today/i);
    expect(plainText(cs[3].p1)).toBe(
      'When I accept one of its ideas, or hand it one of my own, a builder writes the change, tests it and puts it up for me to look at, and once I say yes it ships itself.',
    );
  });

  it('draws no margin chart without its record', () => {
    expect(cs.map((c) => c.margin?.visual.kind ?? null)).toEqual([null, null, 'quotes', null]);
  });

  it('says nothing about the watch when the pulse is stale', () => {
    const text = allStrings(cs).join(' ');
    expect(text).not.toMatch(/bpm|heart|beats a minute|watch checked|no fresh/i);
    expect(cs[1].side).toEqual([]);
  });

  it('drops live states until the poll answers', () => {
    expect(cs[0].side).toEqual([{ text: 'a think every 45 minutes' }]);
    expect(cs[3].side).toEqual([]);
    expect(plainText(codaSegments(empty()))).toBe(
      'The site also runs jobs of its own on a timetable. It answers back when I ask it something, and keeps a corner for the family that stays between us.',
    );
  });

  it('handles a zero week as zero, and nothing shipped as nothing', () => {
    const p = full();
    p.data.daydream.week = { questions: 0, hours: 0, lookups: 0, struckOut: 0, areasCovered: 0 };
    p.data.daydream.impact = { ...p.data.daydream.impact!, shipped: 0, accepted: 0, hitRate: null, previousHitRate: null, rated: 0 };
    const d = daydreamChapter(ctx(p));
    expect(d.figure.value).toBe(0);
    expect(plainText(d.p1)).toContain('across none of seven areas of life, and its own auditor struck out nothing.');
    expect(plainText(d.p2!.segs)).toBe(
      'I mark what it tells me as useful or not from my phone, though nothing has been rated in the last 28 days. None of its ideas has become code yet.',
    );
  });

  it('turns the comparison when the rate falls or holds', () => {
    const p = full();
    p.data.daydream.impact = { ...p.data.daydream.impact!, hitRate: 0.5, previousHitRate: 0.6 };
    expect(plainText(daydreamChapter(ctx(p)).p2!.segs)).toContain('down from 60% the stretch before');
    p.data.daydream.impact = { ...p.data.daydream.impact!, hitRate: 0.6, previousHitRate: 0.6 };
    expect(plainText(daydreamChapter(ctx(p)).p2!.segs)).toContain('the same as 60% the stretch before');
  });

  it('drops a health clause whose figure is missing, keeping the rest', () => {
    const p = full();
    p.data.health = { ...p.data.health, kmYear: null, bestDay: null, recovery30: null, bands: { sleep: null, recovery: 'low' } };
    const h = healthChapter(ctx({ ...p, pulse: { state: 'none' } }));
    expect(plainText(h.p1)).toContain('This year I’ve passed 10,000 steps on 97 days.');
    expect(plainText(h.p2!.segs)).toBe('Lately I’ve slept 7.1 hours a night on average this past week. Today’s recovery reads low.');
  });

  it('says none today when nothing has shipped yet', () => {
    const p = full();
    p.build = { ...p.build, deploysToday: 0, fromDaydream: 0 };
    expect(plainText(buildChapter(ctx(p)).p1)).toContain('at about 6.8 deploys a day, with none today so far.');
  });

  it('copes with an app missing its optional parts', () => {
    const p = full();
    p.data.app = { ...APP, intents: [], games: [], complications: [{ name: 'Alerts' }], widgets: [{ name: 'Family steps', surface: 'home-screen' }] };
    const text = plainText(appChapter(ctx(p)).p1);
    expect(text).not.toMatch(/Siri|games|Readiness|Live Activity/);
    expect(text).toMatch(/one widget and one complication for the watch\.$/);
  });
});

describe('copy rules', () => {
  // Wildmind's chapter is held to the same rules, live and not answering.
  const sets = [
    allStrings(sentenceChapters(full(), [wildmindChapter(wildmindFixture(NOW))])),
    allStrings(sentenceChapters(empty(), [wildmindChapter(offlineShowcase())])),
  ];
  const coda = [plainText(codaSegments(full())), plainText(codaSegments(empty()))];

  it('never exclaims, and never puts a colon in prose', () => {
    for (const s of [...sets.flat(), ...coda]) {
      expect(s).not.toContain('!');
      // Clock times (07:00) are figures, not punctuation.
      expect(s.replace(/\d:\d/g, '')).not.toContain(':');
    }
  });

  it('keeps to British English and plain words', () => {
    // The app's own names (a widget called Journey) are data, not my words.
    const names = new Set([...APP.widgets.map((w) => `${w.name} · Lock Screen`), ...APP.widgets.map((w) => w.name)]);
    const text = [...sets.flat(), ...coda]
      .filter((s) => !names.has(s))
      .join(' ')
      .toLowerCase();
    for (const w of ['seamless', 'journey', 'leverage', 'robust', 'color', 'center', 'organize', 'gotten', 'utilize'])
      expect(text).not.toMatch(new RegExp(`\\b${w}\\b`));
    expect(text).not.toMatch(/it'?’?s not just/);
  });

  it('writes no digit that the data did not supply', () => {
    // With every figure missing, the only digits left are the fixed rules
    // (themselves data) and the app's manifest counts.
    const text = [...sets[1], coda[1]].join(' ');
    const allowed = new Set(
      [
        ...Object.values(RULES).flatMap((v) => (typeof v === 'object' ? Object.values(v) : [v])),
        ...[APP.nativeEndpoints, APP.nativeAreas, APP.pairCodeMinutes, APP.deviceTokenDays],
        STEP_GOAL,
        // Today's slots, counted off the clock rather than written down.
        ...(() => {
          const t = thinkSchedule(NOW, RULES.cadenceMinutes, RULES.activeHours);
          return [t.length, t.filter((x) => x.state === 'earlier').length];
        })(),
      ].map(String),
    );
    const found = (text.replace(/\b\d{2}:\d{2}\b/g, '').match(/\d[\d,.]*/g) ?? []).map((d) => d.replace(/[,.]$/, '').replace(/,/g, ''));
    for (const d of found) expect(allowed, `digit "${d}" in copy`).toContain(d);
  });

  it('prints every number en-GB', () => {
    const text = sets[0].join(' ');
    expect(text).toContain('1,720,172');
    expect(text).toContain('1,650.4');
    // Four or more digits ungrouped, years aside ("19 March 2026").
    expect(text).not.toMatch(/\b(?!(?:19|20)\d\d\b)\d{4,}\b/);
  });

  it('never names a person, a place or a note title', () => {
    const text = [...sets.flat(), ...coda].join(' ');
    expect(text).not.toContain('Secret title');
    expect(text).not.toMatch(/Darlington|Elton|bedroom|asleep at home|out walking/i);
  });
});

describe('the margin, the seam and the dates', () => {
  const cs = sentenceChapters(full());

  it('sets one exact chart in each chapter’s margin', () => {
    expect(cs.map((c) => c.margin?.visual.kind)).toEqual(['verdicts', 'bands', 'quotes', 'deploys']);
    expect(cs.map((c) => c.margin?.label)).toEqual(['Verdicts · 12 weeks', 'Recovery · the last 30 days', 'Things I say to Siri', 'Deploys · the last 40 days']);
    const bands = cs[1].margin!.visual;
    expect(bands.kind === 'bands' && bands.marks.length).toBe(30);
  });

  it('numbers the chapters for a screen reader', () => {
    expect(cs.map((c) => c.nth)).toEqual([1, 2, 3, 4]);
  });

  it('builds the deploy row from the day counts alone', () => {
    const p = full();
    p.build = { ...p.build, releases: null, days: null, deploysPerDay: null, linesWritten: null, deploysToday: 1 };
    const b = buildChapter(ctx(p));
    expect(b.figure.value).toBeNull();
    expect(b.margin?.visual.kind).toBe('deploys');
    expect(plainText(b.p1)).toContain('Today it has shipped 1 change so far, and three of the ideas it built came from Daydream.');
    p.build = { ...p.build, deploysToday: 0, fromDaydream: 0 };
    expect(plainText(buildChapter(ctx(p)).p1)).toMatch(/Nothing has shipped yet today\.$/);
  });

  it('counts the essay’s footnotes in the standfirst', () => {
    const notes = cs.flatMap((c) => allWords(c).filter((w) => w.note)).length;
    expect(standfirst(cs)).toBe(`That’s the short version. The long one runs to four chapters and ${notes} more footnotes.`);
  });

  it('names a date in full, and a Live Activity plainly', () => {
    expect(longDay('2026-06-15')).toBe('Monday 15 June');
    expect(widgetName({ name: 'Journey Live Activity', surface: 'live-activity' })).toBe('Live Activity');
    expect(widgetName({ name: 'Family steps', surface: 'home-screen' })).toBe('Family steps');
  });
});

describe('numberNotes', () => {
  it('starts wherever it is told', () => {
    const cs = numberNotes([daydreamChapter(ctx(full()))], 1);
    expect(allWords(cs[0]).find((w) => w.note)?.n).toBe(1);
  });
});

describe('with Wildmind as a fifth chapter', () => {
  const wm = wildmindChapter(wildmindFixture(NOW));
  const cs = sentenceChapters(full(), [wm]);
  const numbers = (c: ChapterCopy) => [...c.p1, ...(c.p2?.segs ?? [])].flatMap((s) => (s.t === 'word' && s.n != null ? [s.n] : []));

  it('follows the builder, and its notes number on from the builder’s', () => {
    expect(cs.map((c) => c.id)).toEqual(['daydream', 'health', 'app', 'build', 'wildmind']);
    const before = cs.slice(0, 4).flatMap(numbers);
    const own = numbers(cs[4]);
    expect(own[0]).toBe(Math.max(...before) + 1);
    expect(own).toEqual(own.map((_, i) => own[0] + i));
  });

  it('makes the standfirst say five chapters, and the other four unchanged', () => {
    expect(standfirst(cs)).toMatch(/^That’s the short version\. The long one runs to five chapters and /);
    expect(cs.slice(0, 4)).toEqual(sentenceChapters(full()));
  });
});
