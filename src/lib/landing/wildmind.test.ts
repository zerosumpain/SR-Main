import { describe, expect, it } from 'vitest';
import recorded from './fixtures/wildmind-day16.json';
import {
  CAPS,
  MODEL_FALLBACK,
  OFFLINE_MS,
  STALE_MS,
  boundName,
  deniedName,
  habitShare,
  modelName,
  offlineShowcase,
  parseSnapshot,
  project,
  stateOf,
  toMap,
  type WildmindShowcase,
} from './wildmind';
import { traceGrid } from './wildmind-trace.server';

const clone = () => structuredClone(recorded) as Record<string, any>;
const NOW = Date.parse('2026-10-10T12:00:00Z');

describe('parseSnapshot', () => {
  it('reads the recorded day-16 snapshot', () => {
    const s = parseSnapshot(recorded);
    expect(s).not.toBeNull();
    expect(s!.time.day).toBe(16);
    expect(s!.people.map((p) => p.name)).toEqual(['JKai', 'Wren']);
    expect(s!.terrain?.w).toBe(141);
    expect(s!.stats.latest.map((l) => l.name)).toContain('Reed basket');
  });

  it.each([
    ['a wrong version', (o: any) => (o.v = 2)],
    ['no version', (o: any) => delete o.v],
    ['an unknown status', (o: any) => (o.status = 'sulking')],
    ['an unknown season', (o: any) => (o.time.season = 'monsoon')],
    ['an unknown weather', (o: any) => (o.time.weather = 'hail')],
    ['daylight out of range', (o: any) => (o.time.daylight = 2)],
    ['a person with an unknown id', (o: any) => (o.people[0].id = 'stranger')],
    ['too many people', (o: any) => (o.people = Array(CAPS.people + 1).fill(o.people[0]))],
    ['too many animals', (o: any) => (o.animals = Array(CAPS.animals + 1).fill(o.animals[0]))],
    ['too many earlier lives', (o: any) => (o.stats.earlierLives = Array(CAPS.earlierLives + 1).fill({ days: 1, cause: 'cold' }))],
    ['too many latest inventions', (o: any) => (o.stats.latest = Array(CAPS.latest + 1).fill(o.stats.latest[0]))],
    ['a long trail', (o: any) => (o.people[0].trail = Array(CAPS.trail + 1).fill([1, 1]))],
    ['a negative count', (o: any) => (o.stats.invented = -1)],
    ['a count that is not a number', (o: any) => (o.stats.refused = '3')],
    ['an infinite coordinate', (o: any) => (o.people[0].x = Infinity)],
    ['a grid of the wrong size', (o: any) => (o.terrain.w = 140)],
    ['a grid that is not base64', (o: any) => (o.terrain.t = '%%%%')],
    ['an animal of an unknown species index', (o: any) => (o.animals[0][0] = 99)],
    ['a malformed version', (o: any) => (o.terrainVersion = 'a b')],
    ['not an object', () => null],
  ])('rejects %s', (_, change) => {
    const o = clone();
    const out = change(o);
    expect(parseSnapshot(out === null ? null : o)).toBeNull();
  });

  it('degrades unknown activities, causes and structure classes instead of failing', () => {
    const o = clone();
    o.people[0].activity = 'juggling';
    o.stats.earlierLives[0].cause = 'boredom';
    o.structures[0][4] = 'castle';
    const s = parseSnapshot(o)!;
    expect(s.people[0].activity).toBeNull();
    expect(s.stats.earlierLives[0].cause).toBeNull();
    expect(s.structures[0][4]).toBe('other');
  });

  it('drops unknown keys everywhere, and never carries free text', () => {
    const o = clone();
    const SECRET = 'I am thinking about the wolves again';
    Object.assign(o, { lastThought: SECRET, speech: SECRET, extra: { nested: SECRET } });
    Object.assign(o.people[0], { lastThought: SECRET, activityLabel: `Exploring ${SECRET}`, mood: SECRET, speech: { text: SECRET }, plan: [SECRET] });
    Object.assign(o.stats, { analysis: SECRET, description: SECRET });
    Object.assign(o.stats.latest[0], { description: SECRET, rationale: SECRET, refereeNotes: SECRET });
    Object.assign(o.time, { story: SECRET });
    Object.assign(o.terrain, { notes: SECRET });
    Object.assign(o.terrain.regions[0], { description: SECRET });
    const s = parseSnapshot(o)!;
    const sOut = JSON.stringify(s);
    for (const k of ['lastThought', 'activityLabel', 'mood', 'speech', 'plan', 'analysis', 'description', 'rationale', 'refereeNotes', 'story', 'notes', 'extra'])
      expect(sOut).not.toContain(`"${k}"`);
    expect(sOut).not.toContain('wolves again');
    const traced = traceGrid(s.terrain!, s.terrainVersion);
    expect(JSON.stringify(project(s, NOW, NOW, traced))).not.toContain('wolves again');
  });

  it('bounds names, dropping an invention whose name will not print', () => {
    const o = clone();
    o.stats.latest[0].name = 'Visit evil.example/x for 100 baskets';
    o.terrain.regions[0].n = 'Mirror Mere 2';
    o.people[1].name = '<script>';
    const s = parseSnapshot(o)!;
    expect(s.stats.latest.map((l) => l.name)).not.toContain(o.stats.latest[0].name);
    expect(s.stats.latest).toHaveLength(2);
    expect(s.terrain!.regions.map((r) => r.n)).not.toContain('Mirror Mere 2');
    expect(s.people[1].name).toBe('their companion');
  });
});

describe('earlier lives with their generation numbers', () => {
  /** The production shape on 2026-10-10: the sixth life, with only the first's death listed. */
  const production = (lives: unknown[]) => {
    const o = clone();
    o.stats.generation = 6;
    o.stats.earlierLives = lives;
    return o;
  };

  it('keeps each life’s own n when every life has a valid one, strictly descending', () => {
    const s = parseSnapshot(production([{ n: 1, days: 32, cause: 'cold' }]))!;
    expect(s.stats.earlierLives).toEqual([{ n: 1, days: 32, cause: 'cold' }]);
    const gaps = parseSnapshot(
      production([
        { n: 5, days: 3, cause: null },
        { n: 3, days: 8, cause: 'thirst' },
        { n: 1, days: 32, cause: 'cold' },
      ]),
    )!;
    expect(gaps.stats.earlierLives.map((l) => l.n)).toEqual([5, 3, 1]);
  });

  it('carries n through to the showcase', () => {
    const s = parseSnapshot(production([{ n: 1, days: 32, cause: 'cold' }]))!;
    const w = project(s, NOW, NOW, traceGrid(s.terrain!, s.terrainVersion));
    expect(w.generation).toBe(6);
    expect(w.earlierLives).toEqual([{ n: 1, days: 32, cause: 'cold' }]);
  });

  it.each([
    ['absent', [{ days: 32, cause: 'cold' }]],
    ['absent on one life', [{ n: 3, days: 3, cause: null }, { days: 32, cause: 'cold' }]],
    ['zero', [{ n: 0, days: 32, cause: 'cold' }]],
    ['over the generation', [{ n: 7, days: 32, cause: 'cold' }]],
    ['not a whole number', [{ n: 1.5, days: 32, cause: 'cold' }]],
    ['a string', [{ n: '1', days: 32, cause: 'cold' }]],
    ['repeated', [{ n: 2, days: 3, cause: null }, { n: 2, days: 32, cause: 'cold' }]],
    ['ascending', [{ n: 1, days: 32, cause: 'cold' }, { n: 3, days: 3, cause: null }]],
  ])('reads the whole list as unnumbered when n is %s, without failing the read', (_, lives) => {
    const s = parseSnapshot(production(lives));
    expect(s).not.toBeNull();
    expect(s!.stats.earlierLives.map((l) => l.n)).toEqual(lives.map(() => null));
    expect(s!.stats.earlierLives.map((l) => l.days)).toEqual(lives.map((l) => l.days));
  });
});

describe('boundName', () => {
  it.each([
    ['Reed basket', 'Reed basket'],
    ["Dabbler's Pool", "Dabbler's Pool"],
    ['  Woven   fibre  mat ', 'Woven fibre mat'],
    ['Fire-hardened spear', 'Fire-hardened spear'],
  ])('keeps %j', (raw, want) => expect(boundName(raw)).toBe(want));

  it.each([
    ['digits', 'Basket 2'],
    ['a link', 'https://example.com'],
    ['a dotted name', 'evil.example'],
    ['more than forty characters', 'A very long name for a rather ordinary basket'],
    ['more than five words', 'one two three four five six'],
    ['a word on the deny list', 'Nazi hut'],
    ['punctuation only', "' - '"],
    ['angle brackets', '<b>Basket</b>'],
    ['not a string', 42],
    ['an empty string', ''],
  ])('refuses %s', (_, raw) => expect(boundName(raw)).toBeNull());

  // The same cases as Wildmind's scripts/public-check.ts (NAME_DENY_CASES there):
  // the deny list matches whole words, so ordinary names that merely contain one pass.
  const NAME_DENY_CASES: Array<[string, boolean]> = [
    ['Flint scraper', true],
    ['Hide Scraper', true],
    ['Grape press', true],
    ['Rapeseed oil', true],
    ['Trapeze', true],
    ['Drapery', true],
    ['Shitake', true],
    ['Scunthorpe', true],
    ['Cockle rake', true],
    ['Titmouse trap', true],
    ['Bass drum', true],
    ['Grass mat', true],
    ['Essex Fen', true],
    ['Fire retardant', true],
    ['Retarded hut', false],
    ['Cunt hook', false],
    ['Shit basket', false],
    ['Bullshit', false],
    ['Rape stone', false],
    ['Tit mat', false],
    ['Nazi hut', false],
    ["Wanker's hut", false],
    ['Fucking axe', false],
    ['Hitler-tooth', false],
  ];
  it.each(NAME_DENY_CASES)('the deny list on %j: kept %s', (name, kept) => {
    expect(boundName(name)).toBe(kept ? name : null);
    expect(deniedName(name)).toBe(!kept);
  });

  it('applies the same deny list to a slug, word by word', () => {
    expect(boundName('Basket 2', 'grape_press')).toBe('grape press');
    expect(boundName('Basket 2', 'flint_scraper')).toBe('flint scraper');
    expect(boundName('Basket 2', 'rape_stone')).toBeNull();
  });

  it('falls back to a clean slug, and refuses a slug with digits', () => {
    expect(boundName('Basket №9', 'reed_basket')).toBe('reed basket');
    expect(boundName('Basket №9', 'reed_basket_2')).toBeNull();
  });
});

describe('stateOf', () => {
  it('is offline with no read', () => {
    expect(stateOf(null, null, NOW)).toBe('offline');
    expect(stateOf('running', null, NOW)).toBe('offline');
  });
  it('follows the status while fresh', () => {
    expect(stateOf('running', NOW, NOW)).toBe('live');
    expect(stateOf('resting', NOW, NOW)).toBe('resting');
    expect(stateOf('paused', NOW, NOW)).toBe('paused');
    expect(stateOf('halted', NOW, NOW)).toBe('paused');
    expect(stateOf('between-lives', NOW, NOW)).toBe('between-lives');
  });
  it('goes stale after two minutes and offline after a day', () => {
    expect(stateOf('running', NOW - STALE_MS, NOW)).toBe('live');
    expect(stateOf('running', NOW - STALE_MS - 1, NOW)).toBe('stale');
    expect(stateOf('between-lives', NOW - OFFLINE_MS, NOW)).toBe('stale');
    expect(stateOf('running', NOW - OFFLINE_MS - 1, NOW)).toBe('offline');
  });
});

describe('habitShare and models', () => {
  it('bands the share of choices made by habit', () => {
    expect(habitShare({ thought: 30, habit: 70 })).toBe('most');
    expect(habitShare({ thought: 40, habit: 60 })).toBe('about-half');
    expect(habitShare({ thought: 60, habit: 40 })).toBe('about-half');
    expect(habitShare({ thought: 70, habit: 30 })).toBe('some');
    expect(habitShare({ thought: 0, habit: 0 })).toBeNull();
    expect(habitShare(null)).toBeNull();
  });
  it('names only the models it knows', () => {
    expect(modelName('claude-haiku-5-5')).toBe('Haiku');
    expect(modelName('claude-sonnet-5-5')).toBe('Sonnet');
    expect(modelName('claude-opus-5-5')).toBe('Opus');
    expect(modelName('gpt-something')).toBe(MODEL_FALLBACK);
    expect(modelName('constructor')).toBe(MODEL_FALLBACK);
  });
});

describe('project', () => {
  const snap = parseSnapshot(recorded)!;
  const traced = traceGrid(snap.terrain!, snap.terrainVersion)!;

  it('projects the live valley to map units', () => {
    const w = project(snap, NOW, NOW, traced);
    expect(w.state).toBe('live');
    expect(w.mapVersion).toBe(snap.terrainVersion);
    expect(w.people[0]).toMatchObject({ id: 'main', name: 'JKai', doing: 'asleep', near: 'Tusker Wood' });
    const [x, y] = toMap(traced.frame, snap.people[0].x, snap.people[0].z);
    expect(w.people[0].x).toBe(x);
    expect(w.people[0].y).toBe(y);
    for (const [ax, ay] of w.animals) {
      expect(ax).toBeGreaterThanOrEqual(0);
      expect(ax).toBeLessThanOrEqual(traced.map.w);
      expect(ay).toBeLessThanOrEqual(traced.map.h);
    }
    expect(w.invented).toBe(7);
    expect(w.latest).toEqual(['Reed basket', 'Woven fibre basket', 'Woven fibre storage cache']);
    expect(w.habitShare).toBe('about-half');
    expect(w.models).toEqual({ mind: 'Haiku', designer: 'Sonnet' });
    expect(w.night).toBe(1);
  });

  it('carries no clock time and no fetch time', () => {
    const out = JSON.stringify(project(snap, NOW - 5000, NOW, traced));
    expect(out).not.toMatch(/fetchedAt|\d{4}-\d{2}-\d{2}T|seenAt|"at"/);
  });

  it('reads an unknown activity as busy and a dead person as dead', () => {
    const s = structuredClone(snap);
    s.people[0].activity = null;
    s.people[1].alive = false;
    const w = project(s, NOW, NOW, traced);
    expect(w.people[0].doing).toBe('busy');
    expect(w.people[1].doing).toBe('dead');
  });

  it('leaves the old figures but says stale after two minutes, and shows nothing after a day', () => {
    expect(project(snap, NOW - STALE_MS - 1, NOW, traced)).toMatchObject({ state: 'stale', day: 16, invented: 7 });
    expect(project(snap, NOW - OFFLINE_MS - 1, NOW, traced)).toEqual(offlineShowcase());
  });

  it('never turns a missing figure into a zero', () => {
    const off: WildmindShowcase = offlineShowcase();
    for (const k of ['day', 'season', 'weather', 'night', 'invented', 'refused', 'placesFound', 'exploredTiles', 'generation', 'habitShare', 'models', 'map', 'mapVersion'] as const)
      expect(off[k]).toBeNull();
    expect(JSON.stringify(off)).not.toMatch(/:0\b/);
  });

  it('says whether they have met only when the snapshot does', () => {
    expect(project(snap, NOW, NOW, traced).met).toBe(false);
    const o = clone();
    o.stats.milestones.met = true;
    expect(project(parseSnapshot(o)!, NOW, NOW, traced).met).toBe(true);
    delete o.stats.milestones.met;
    expect(project(parseSnapshot(o)!, NOW, NOW, traced).met).toBeNull();
    delete o.stats.milestones;
    expect(project(parseSnapshot(o)!, NOW, NOW, traced).met).toBeNull();
    expect(offlineShowcase().met).toBeNull();
  });

  it('draws no one and nothing without a map', () => {
    const w = project(snap, NOW, NOW, null);
    expect(w.map).toBeNull();
    expect(w.people).toEqual([]);
    expect(w.animals).toEqual([]);
    expect(w.invented).toBe(7);
  });
});
