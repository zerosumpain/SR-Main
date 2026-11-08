import { describe, expect, it } from 'vitest';
import { anchorFor, cueBeats, figure, quoted, TOPICS, valleyMood, valleyNews, visitBeats, type Cue, type ExhibitFacts, type ValleyFacts } from './exhibits';
import { wrap } from './talk';
import { buildWorld } from './world';

const VALLEY: ValleyFacts = {
  state: 'live',
  day: 14,
  season: 'autumn',
  weather: 'rain',
  people: [
    { name: 'JKai', doing: 'at work', alive: true, thinking: false },
    { name: 'Wren', doing: 'thinking it over', alive: true, thinking: true },
  ],
  invented: 23,
  latest: ['Reed Basket'],
  generation: 4,
  lastCause: 'starvation',
  met: false,
};

const FULL: ExhibitFacts = {
  bpm: 72,
  stepsToday: 8412,
  deploysToday: 3,
  daydream: { questions: 61, hours: 12.5, struckOut: 7, hitRate: 0.62, shipped: 9 },
  health: { stepsYear: 2_431_009, kmYear: 1704.2, daysOver10k: 121, sleep: 'low', recovery: 'high' },
  app: { tabs: 5, watchPages: 4, widgets: 6, games: ['Word Ladder', 'Snap'] },
  build: { releases: 1172, linesWritten: 2_300_118, deploysPerDay: 4.2, fromDaydream: 9 },
  valley: VALLEY,
  posts: ['A much bigger bucket than the one I had before: notes on storage', 'Short one'],
};

const EMPTY: ExhibitFacts = {};

const ROLLS = [0, 0.3, 0.6, 0.99];
const CUES: Cue[] = ['view', 'fair', 'unfair', 'hold', 'unhold', 'tuck', 'explain', 'back'];

function lines(facts: ExhibitFacts): string[] {
  const out: string[] = [];
  for (const roll of ROLLS)
    for (const t of TOPICS)
      for (const b of visitBeats(t, () => facts, () => roll)) {
        const l = b.say?.();
        if (l) out.push(l.text);
      }
  return out;
}

describe('exhibits', () => {
  it('has a visit for every section, each beat a real pose for a real while', () => {
    for (const t of TOPICS)
      for (const f of [FULL, EMPTY]) {
        const beats = visitBeats(t, () => f, () => 0.5);
        expect(beats.length).toBeGreaterThan(0);
        for (const b of beats) {
          expect(b.dur).toBeGreaterThan(0.5);
          expect(b.dur).toBeLessThan(10);
        }
      }
  });

  it('keeps to the voice card in every line: lower case, no exclamation marks, no colons', () => {
    const all = [...lines(FULL), ...lines(EMPTY), ...CUES.flatMap((c) => ROLLS.flatMap((r) => cueBeats(c, () => r).map((b) => b.say?.()?.text ?? '')))];
    expect(all.length).toBeGreaterThan(40);
    for (const text of all) {
      expect(text).not.toMatch(/[!:]/);
      expect(text).toBe(text.toLowerCase());
      expect(text).not.toMatch(/undefined|null|nan/);
      expect(wrap(text).length).toBeLessThanOrEqual(3);
    }
  });

  it('never says a missing figure as a number', () => {
    for (const text of lines(EMPTY)) expect(text).not.toMatch(/\d/);
  });

  it('talks about what the section shows', () => {
    const health = lines({ health: { kmYear: 1704.2 } });
    expect(health.some((t) => t.includes('1,704 km'))).toBe(true);
    const build = lines({ build: { releases: 1172 } });
    expect(build.some((t) => t.includes('1,172 releases'))).toBe(true);
    const hero = visitBeats('hero', () => ({ bpm: 112 }), () => 0);
    expect(hero[0].mode).toBe('pulse');
    expect(hero[0].say?.()?.text).toMatch(/^112 a minute/);
  });

  it('only feels for a pulse when there is a fresh one', () => {
    expect(visitBeats('hero', () => ({}), () => 0).some((b) => b.mode === 'pulse')).toBe(false);
    expect(visitBeats('hero', () => ({ bpm: 64 }), () => 0).some((b) => b.mode === 'pulse')).toBe(true);
  });

  it('reads a figure as the beat starts, not when the visit is planned', () => {
    let valley: ValleyFacts = { ...VALLEY, people: [{ ...VALLEY.people[0], doing: 'asleep' }] };
    const beats = visitBeats('wildmind', () => ({ valley }), () => 0);
    valley = { ...valley, people: [{ ...valley.people[0], doing: 'eating' }] };
    expect(beats[1].say?.()?.text).toBe('jkai is eating. now i am hungry');
  });

  it('watches the valley and judges how it is going', () => {
    expect(valleyMood(VALLEY)).toBe('good');
    expect(valleyMood({ ...VALLEY, people: [{ ...VALLEY.people[0], alive: false }] })).toBe('bad');
    expect(valleyMood({ ...VALLEY, state: 'resting' })).toBe('quiet');
    const last = (v: ValleyFacts) => visitBeats('wildmind', () => ({ valley: v }), () => 0).at(-1)!;
    expect(last(VALLEY).mode).toBe('clap');
    expect(last({ ...VALLEY, people: [{ ...VALLEY.people[0], alive: false }] }).mode).toBe('stressed');
  });

  it('reacts to news from the valley while he watches', () => {
    expect(valleyNews(VALLEY, VALLEY)).toBeNull();
    const invented = valleyNews(VALLEY, { ...VALLEY, invented: 24, latest: ['Clay Pot'] })!;
    expect(invented[0].mode).toBe('celebrate');
    expect(invented[0].say?.()?.text).toBe('a clay pot. get in');
    const died = valleyNews(VALLEY, { ...VALLEY, people: [{ ...VALLEY.people[0], alive: false }, VALLEY.people[1]] })!;
    expect(died[0].say?.()?.text).toBe('oh no. jkai');
    expect(valleyNews(VALLEY, { ...VALLEY, met: true })![0].mode).toBe('clap');
    // Nothing is news when the valley was not running.
    expect(valleyNews({ ...VALLEY, state: 'stale' }, { ...VALLEY, invented: 30 })).toBeNull();
  });

  it('says figures the way he would and quotes titles short', () => {
    expect(figure(8412)).toBe('8,412');
    expect(figure(24_310)).toBe('24k');
    expect(figure(2_431_009)).toBe('2.4m');
    expect(quoted('Short one')).toBe('"short one"');
    expect(quoted('A much bigger bucket than the one I had before: notes')).toBe('"a much bigger bucket than..."');
  });

  it('stands above the interesting part of a section, facing it', () => {
    const w = buildWorld(
      [
        { key: 1, x1: 0, x2: 1200, y: 100 },
        { key: 2, x1: 100, x2: 500, y: 300 },
        { key: 3, x1: 100, x2: 900, y: 700 },
      ],
      { margin: 8, standOff: 8, jump: 52, drop: 160 },
    );
    const box = { x1: 100, x2: 900, top: 280, bottom: 800 };
    const a = anchorFor(w, box, { x: 400, y: 450 })!;
    expect(a.floor.y).toBe(300);
    expect(a.x).toBe(400);
    expect(a.face).toBe(0);
    // Off the end of the floor: he stands at its end and faces it.
    const b = anchorFor(w, box, { x: 800, y: 350 })!;
    expect(b.floor.y).toBe(300);
    expect(b.face).toBe(1);
    // Nothing runs through a box below everything.
    expect(anchorFor(w, { x1: 0, x2: 1200, top: 900, bottom: 1000 }, { x: 600, y: 950 })).toBeNull();
  });
});
