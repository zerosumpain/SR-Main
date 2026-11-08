import { describe, expect, it } from 'vitest';
import { chapterStrings, plainText, type ChapterCopy, type Seg } from './showcase-sentence';
import { builtMarks, CAMP_MIN, lifeRows, plateSummary, plateWords, sentenceCase, wildmindChapter, wildmindSide, WEATHER_ADJ } from './showcase-sentence-wildmind';
import { offlineShowcase, type WildmindShowcase } from './wildmind';
import { wildmindFixture } from './wildmind.fixture';

const NOW = Date.parse('2026-10-10T13:30:00Z');

/** A small valley on day eighteen of a third life, as the fixture's figures. */
function base(over: Partial<WildmindShowcase> = {}): WildmindShowcase {
  return {
    state: 'live',
    day: 18,
    season: 'summer',
    weather: 'cloudy',
    night: 0,
    map: {
      version: 'v1',
      w: 141,
      h: 93,
      metresPerUnit: 2,
      seen: 'M0 0h10v10h-10z',
      layers: [
        { cls: 'fresh', d: 'M1 1h2v2h-2z' },
        { cls: 'wood', d: 'M3 3h2v2h-2z' },
        { cls: 'wet', d: 'M5 5h1v1h-1z' },
        { cls: 'high', d: 'M6 6h1v1h-1z' },
      ],
      relief: null,
      labels: [
        { name: 'Mirror Mere', x: 60, y: 40, landmark: true },
        { name: 'Fawn Lea', x: 40, y: 20, landmark: false },
        { name: 'Upper Ford', x: 50, y: 30, landmark: false },
      ],
    },
    mapVersion: 'v1',
    people: [
      { id: 'companion', name: 'Wren', x: 120, y: 60, heading: 0, doing: 'at work', alive: true, thinking: false, near: 'Bittern Beds', trail: [] },
      { id: 'main', name: 'JKai', x: 50, y: 40, heading: 0, doing: 'walking', alive: true, thinking: false, near: 'Tusker Wood', trail: [] },
    ],
    species: ['deer'],
    animals: [[10, 10, 0, 0]],
    structures: [[120, 60, 1, 0, 'shelter']],
    fires: [],
    invented: 7,
    latest: ['Reed basket', 'Woven fibre basket', 'Woven fibre storage cache'],
    refused: 1,
    placesFound: 15,
    exploredTiles: 2000,
    generation: 3,
    earlierLives: [
      { days: 2.9, cause: 'starvation' },
      { days: 32.3, cause: 'cold' },
    ],
    habitShare: 'about-half',
    models: { mind: 'Haiku', designer: 'Sonnet' },
    ...over,
  };
}

const p1 = (c: ChapterCopy) => plainText(c.p1);
const p2 = (c: ChapterCopy) => (c.p2 ? plainText(c.p2.segs) : '');
const words = (segs: Seg[]) => segs.filter((s): s is Extract<Seg, { t: 'word' }> => s.t === 'word');
const noted = (c: ChapterCopy) => words([...c.p1, ...(c.p2?.segs ?? [])]).filter((s) => s.note);
const STATES = ['live', 'resting', 'paused', 'between-lives', 'stale', 'offline'] as const;

describe('the Wildmind chapter', () => {
  it('sits as chapter five, in orange on paper, with no way on', () => {
    const c = wildmindChapter(base());
    expect(c).toMatchObject({ id: 'wildmind', nth: 5, numeral: 'v.', label: 'Wildmind', tone: 'accent', ground: 'paper' });
    expect(c.head).toBe('It makes things up to stay alive');
    expect(c.link).toBeUndefined();
  });

  it('tells the live valley as the spec writes it', () => {
    const c = wildmindChapter(base());
    expect(p1(c)).toBe(
      'I’m also building a little world called Wildmind, where the two people in it have Claude for a mind. JKai and Wren start in a valley with nothing and have to think up anything they want, and a stubborn referee in the code throws out any idea the valley couldn’t actually supply. It runs on its own on a box in the house whether anyone’s watching or not, and the map below is the land they’ve seen so far. It’s day 18 of this life. So far they’ve named three places, the latest thing they’ve made up is the reed basket, and the referee has turned down one idea of theirs.',
    );
    expect(p2(c)).toBe(
      'This JKai is the third of the line. The first lasted 32 days and died of the cold, and the second lasted three days and died of hunger. Each time one dies Claude reads back over the life and leaves the next a few lessons, which is roughly how families work too. About half of what they do is habit by now, and the rest still needs thinking about. I’ll write up how it all works once it stops surprising me.',
    );
    expect(c.p2?.sub).toBe('The family tree');
    expect(c.side).toEqual([{ text: 'day 18 · summer', live: true }, { text: 'a cloudy day' }, { text: 'thinks with Haiku and invents with Sonnet' }]);
    expect(c.figure).toMatchObject({ value: 7, unit: 'things invented in this valley' });
  });

  it('colours the two names as their discs, with no note', () => {
    const c = wildmindChapter(base());
    const names = words(c.p1).filter((w) => w.word === 'JKai' || w.word === 'Wren');
    expect(names.map((w) => [w.word, w.tone, !!w.note])).toEqual([
      ['JKai', 'accent', false],
      ['Wren', 'ink', false],
    ]);
  });

  it('counts the places it lists, and takes the newest invention', () => {
    const c = wildmindChapter(base());
    const places = noted(c).find((w) => w.id === 'wm-places')!;
    expect(places.word).toBe('three places');
    expect(places.note?.visual).toEqual({ kind: 'list', items: ['Mirror Mere', 'Fawn Lea', 'Upper Ford'] });
    // With no map held, the count falls back to placesFound and lists nothing.
    const bare = wildmindChapter(base({ map: null, mapVersion: null }));
    expect(noted(bare).find((w) => w.id === 'wm-places')?.word).toBe('15 places');
    expect(noted(c).find((w) => w.id === 'wm-latest')?.word).toBe('the reed basket');
  });

  it('says each state in game time only', () => {
    const t = (s: (typeof STATES)[number]) => p1(wildmindChapter(base({ state: s })));
    expect(t('resting')).toContain('It’s day 18 of this life, and their minds are resting till tomorrow, so they’re getting by on habit.');
    expect(t('paused')).toContain('It’s day 18 of this life, and the valley’s paused just now.');
    expect(t('stale')).toContain('the map below is the last one it sent. This is how the valley stood on day 18, and it isn’t answering just now.');
    const quiet = { models: null };
    expect(wildmindSide(base({ state: 'resting', ...quiet }))).toEqual([{ text: 'day 18 · summer', live: true }, { text: 'minds resting till tomorrow' }]);
    expect(wildmindSide(base({ state: 'paused', ...quiet }))).toEqual([{ text: 'day 18 · summer' }, { text: 'paused just now' }]);
    expect(wildmindSide(base({ state: 'stale', ...quiet }))).toEqual([{ text: 'not answering just now' }]);
    expect(wildmindSide(base({ state: 'live', night: 0.8, weather: 'rain' }))[1]).toEqual({ text: 'a wet night' });
    expect(Object.values(WEATHER_ADJ)).toEqual(['clear', 'cloudy', 'wet', 'stormy', 'snowy', 'foggy']);
  });

  it('tells a life just ended in the past tense, from earlierLives[0]', () => {
    const w = base({
      state: 'between-lives',
      earlierLives: [
        { days: 18, cause: 'cold' },
        { days: 2.9, cause: 'starvation' },
        { days: 32.3, cause: 'cold' },
      ],
      people: base().people.map((p) => (p.id === 'main' ? { ...p, alive: false, doing: 'dead' } : p)),
    });
    const c = wildmindChapter(w);
    expect(p1(c)).toContain('the map below is the valley as JKai left it.');
    expect(p1(c)).toContain('JKai died of the cold on day 18, and the next of the line wakes up in a fresh valley shortly.');
    expect(p1(c)).toContain('Between them they’d named three places, the last thing they made up was the reed basket, and the referee turned down one idea of theirs.');
    expect(p2(c)).toMatch(/^That JKai was the third of the line\. The first lasted 32 days and died of the cold, and the second lasted three days and died of hunger\. Claude is reading back/);
    expect(p2(c)).toContain('About half of what they did was habit, and the rest still needed thinking about.');
    expect(p2(wildmindChapter({ ...w, habitShare: 'most' }))).toContain('Most of what they did was habit, so the model only got woken when something was new.');
    expect(c.figure.unit).toBe('things invented in that valley');
    expect(c.side.map((s) => s.text)).toEqual(['between lives', 'the next wakes up shortly', 'thinks with Haiku and invents with Sonnet']);
    const pw = plateWords(w)!;
    expect(pw.label).toBe('The valley · as JKai left it');
    expect(pw.who).toEqual([
      { id: 'main', text: 'JKai died', hollow: true },
      { id: 'companion', text: 'Wren was at work near Bittern Beds', hollow: true },
    ]);
    expect(plateSummary(w)).toBe('A map of the land JKai and Wren had seen, as JKai left it, where they’d named three places. JKai died and Wren was at work near Bittern Beds.');
    expect(plateSummary(base())).toMatch(/^A map of the land .* have seen so far/);
    // Stale and paused maps are stills too, so they are told in the past tense.
    const stale = base({ state: 'stale' });
    expect(plateWords(stale)!.who.map((p) => p.text)).toEqual(['JKai was walking near Tusker Wood', 'Wren was at work near Bittern Beds']);
    expect(plateSummary(stale)).toBe(
      'A map of the land JKai and Wren had seen by day 18, where they’d named three places. JKai was walking near Tusker Wood and Wren was at work near Bittern Beds.',
    );
    const paused = base({ state: 'paused' });
    expect(plateWords(paused)!.who[0].text).toBe('JKai was walking near Tusker Wood');
    expect(plateSummary(paused)).toBe(
      'A map of the land JKai and Wren have seen so far, where they’ve named three places. When it paused, JKai was walking near Tusker Wood and Wren was at work near Bittern Beds.',
    );
    // No open row: the ended life is the last bar.
    expect(lifeRows(w)!.rows.map((r) => r.open)).toEqual([false, false, false]);
  });

  it('is honest when the valley is not answering', () => {
    const c = wildmindChapter(offlineShowcase());
    expect(c.figure.value).toBeNull();
    expect(c.figure.spoken).toBe('not answering just now');
    expect(c.margin).toBeNull();
    expect(c.p2).toBeNull();
    expect(c.side).toEqual([{ text: 'not answering just now' }]);
    expect(p1(c)).toMatch(/where the people in it have Claude for a mind\. They start in a valley/);
    expect(p1(c)).toMatch(/whether anyone’s watching or not\. The valley isn’t answering just now, so there’s no map of it\. I’ll write up how it all works once it stops surprising me\.$/);
    expect(noted(c)).toEqual([]);
    expect(plateWords(offlineShowcase())).toBeNull();
  });

  it('never prints a zero for a missing figure, and says a real nothing in words', () => {
    const none = wildmindChapter(base({ invented: 0, refused: 0, latest: [] }));
    expect(p1(none)).toContain('So far they’ve named three places, they haven’t made anything up yet, and the referee hasn’t turned anything down yet.');
    expect(none.figure.value).toBe(0);
    const gone = wildmindChapter(base({ invented: null, refused: null, map: null, placesFound: null, day: null }));
    expect(p1(gone)).not.toMatch(/So far|It’s day/);
    expect(gone.figure.value).toBeNull();
  });

  it('starts a line at its first life, and summarises a long one', () => {
    const first = wildmindChapter(base({ generation: 1, earlierLives: [] }));
    expect(p2(first)).toMatch(/^This JKai is the first of the line, so nobody’s had to pass anything on yet\. About half/);
    expect(first.margin).toBeNull();
    const long = base({
      generation: 9,
      earlierLives: [5, 40, 3, 12, 0.5, 8, 22, 1].map((days) => ({ days, cause: 'cold' as const })),
    });
    expect(p2(wildmindChapter(long))).toContain('The eight before them lasted anything from less than a day to 40 days.');
    const rows = lifeRows(long)!;
    expect(rows.rows).toHaveLength(6);
    expect(rows.more).toBe(3);
    expect(rows.rows[0].label).toMatch(/^fourth · /);
    expect(rows.rows.at(-1)).toMatchObject({ open: true, label: 'ninth · day 18 · this one' });
    // One life off the top is "is", not "are".
    const seven = lifeRows(base({ generation: 7, earlierLives: [5, 40, 3, 12, 0.5, 8].map((days) => ({ days, cause: null })) }))!;
    expect(seven.more).toBe(1);
    expect(seven.summary).toMatch(/^Seven lives so far\. The one before is left off\. /);
  });

  it('never says resting minds still need to think', () => {
    const t = (habitShare: 'some' | 'about-half' | 'most') => p2(wildmindChapter(base({ state: 'resting', habitShare })));
    expect(t('about-half')).toContain('About half of what they do is habit by now, and the rest waits till their minds are back.');
    expect(t('some')).toContain('Some of what they do is habit already, and the rest waits till their minds are back.');
    expect(t('most')).toContain('Most of what they do is habit by now, which is as well with their minds resting.');
    for (const h of ['some', 'about-half', 'most'] as const) expect(t(h)).not.toMatch(/needs thinking|gets woken/);
  });

  it('draws the line oldest first, the longest life full length', () => {
    const v = lifeRows(base())!;
    expect(v.rows).toEqual([
      { label: 'first · 32 days · the cold', share: 1, open: false },
      { label: 'second · three days · hunger', share: 0.09, open: false },
      { label: 'third · day 18 · this one', share: 0.557, open: true },
    ]);
    expect(v.more).toBe(0);
    expect(v.summary).toBe(
      'Three lives so far. The first lasted 32 days and died of the cold, the second lasted three days and died of hunger, and this one is on day 18.',
    );
    expect(wildmindChapter(base()).margin?.label).toBe('The line · three lives');
  });

  it('names the models in the margin only, and only through the allow-list', () => {
    expect(p1(wildmindChapter(base()))).not.toMatch(/Haiku|Sonnet/);
    expect(wildmindSide(base({ models: { mind: 'Haiku', designer: 'Haiku' } })).at(-1)).toEqual({ text: 'thinks and invents with Haiku' });
    for (const models of [{ mind: 'a Claude model', designer: 'Sonnet' }, null]) {
      const c = wildmindChapter(base({ models }));
      expect([p1(c), ...c.side.map((s) => s.text)].join(' ')).not.toMatch(/Haiku|Sonnet|Claude model/);
    }
    expect(wildmindSide(offlineShowcase())).toEqual([{ text: 'not answering just now' }]);
  });

  it('gathers a crowd of built things into a camp and keeps the rest as squares', () => {
    const crowd = Array.from({ length: CAMP_MIN }, (_, i) => [100 + (i % 4) * 2, 50 + Math.floor(i / 4) * 2, 1, 0, 'shelter'] as [number, number, 0 | 1, 0 | 1, 'shelter']);
    const m = builtMarks([...crowd, [20, 20, 0, 0, 'store'], [24, 20, 1, 0, 'store']]);
    expect(m.camps).toHaveLength(1);
    expect(m.camps[0].count).toBe(CAMP_MIN);
    expect(m.camps[0].d).toMatch(/^M[\d. L-]+z$/);
    expect(m.singles).toEqual([
      { x: 20, y: 20, complete: false },
      { x: 24, y: 20, complete: true },
    ]);
    expect(m.clear).toHaveLength(CAMP_MIN);
    expect(m.soft).toEqual([
      [19, 19, 21, 21],
      [23, 19, 25, 21],
    ]);
    expect(m.camps[0].members).toHaveLength(CAMP_MIN);
    // One fewer than a camp stays as squares.
    expect(builtMarks(crowd.slice(1)).camps).toEqual([]);
    // The real valley: Wren's shelters read as camps, JKai's store stays a square.
    const real = builtMarks(wildmindFixture(NOW).structures);
    expect(real.camps.length).toBeGreaterThan(0);
    expect(real.singles.length).toBeLessThan(4);
  });

  it('captions the plate: label, people, scale and key', () => {
    const pw = plateWords(base())!;
    expect(pw.label).toBe('The valley · as they’ve seen it');
    expect(pw.who.map((p) => p.text)).toEqual(['JKai is walking near Tusker Wood', 'Wren is at work near Bittern Beds']);
    expect(pw.who.every((p) => !p.hollow)).toBe(true);
    expect(pw.scale).toEqual({ metres: 50, word: 'fifty metres' });
    expect(pw.grid).toBe(25);
    expect(pw.keys).toEqual(['wood', 'water', 'wet', 'high', 'built', 'animals']);
    expect(plateWords(base({ state: 'paused' }))!.who.every((p) => p.hollow)).toBe(true);
    expect(plateWords(base({ state: 'stale' }))!.label).toBe('The valley · as it stood');
    // A much bigger valley takes a longer bar and a coarser grid.
    const big = plateWords(base({ map: { ...base().map!, w: 240, h: 160, metresPerUnit: 8 } }))!;
    expect(big.scale.word).toBe('half a kilometre');
    expect(240 / big.grid).toBeLessThanOrEqual(8);
  });

  it('lowers an invention name only when it is plainly a phrase', () => {
    expect(sentenceCase('Reed basket')).toBe('reed basket');
    expect(sentenceCase('Woven Fibre Storage Cache With Lid And Strap')).toBe('woven fibre storage cache with lid and strap');
    expect(sentenceCase('UV Drying Rack')).toBe('UV drying rack');
  });

  it('keeps every state free of digits in its words, colons and exclamations', () => {
    const digits = /\d/;
    for (const s of STATES) {
      const c = wildmindChapter(s === 'offline' ? offlineShowcase() : base({ state: s }));
      for (const str of chapterStrings(c)) {
        expect(str).not.toContain('!');
        expect(str).not.toContain(':');
      }
      // Figures come only from data: blank every one out and nothing numeric is left.
      const scrubbed = chapterStrings(wildmindChapter(s === 'offline' ? offlineShowcase() : base({ state: s, day: 1, refused: 2, generation: 2, earlierLives: [{ days: 3, cause: null }] }))).join(' ');
      expect(scrubbed).not.toMatch(digits);
    }
  });

  it('reads the real fixture without surprise', () => {
    const w = wildmindFixture(NOW);
    const c = wildmindChapter(w);
    expect(noted(c).map((s) => s.id)).toEqual(['wm-day', 'wm-places', 'wm-latest', 'wm-refused', 'wm-line', 'wm-habit']);
    expect(noted(c).find((s) => s.id === 'wm-places')?.word).toBe(`${w.map!.labels.length} places`);
    expect(noted(c).find((s) => s.id === 'wm-latest')?.word).toBe('the reed basket');
  });
});

describe('the line with lives left out', () => {
  // Wildmind leaves some lives out of earlierLives, so it can have gaps. The
  // copy names each life by its own n, counts only the lives listed, and
  // without numbers names none of the earlier ones and counts none before.
  const day1 = { day: 1, generation: 6 };
  /** Production on 2026-10-10: the sixth life on day one, only the first's death listed. */
  const numbered = base({ ...day1, earlierLives: [{ n: 1, days: 32, cause: 'cold' }] });
  const unnumbered = base({ ...day1, earlierLives: [{ days: 32, cause: 'cold' }] });
  const deadMain = base().people.map((p) => (p.id === 'main' ? { ...p, alive: false, doing: 'dead' } : p));

  it('names the production line by its own numbers', () => {
    const v = lifeRows(numbered)!;
    expect(v.rows.map((r) => r.label)).toEqual(['first · 32 days · the cold', 'sixth · day one · this one']);
    expect(v.more).toBe(0);
    expect(v.before).toBeNull();
    expect(v.summary).toBe('Six lives so far. The first lasted 32 days and died of the cold, and this one is on day one.');
    expect(p2(wildmindChapter(numbered))).toMatch(
      /^This JKai is the sixth of the line\. The first lasted 32 days and died of the cold\. Each time one dies/,
    );
  });

  it('names no earlier life in the production line without numbers', () => {
    const v = lifeRows(unnumbered)!;
    expect(v.rows.map((r) => r.label)).toEqual(['32 days · the cold', 'sixth · day one · this one']);
    expect(v.before).toBeNull();
    expect(v.summary).toBe('Six lives so far. One lasted 32 days and died of the cold, and this one is on day one.');
    expect(p2(wildmindChapter(unnumbered))).toMatch(
      /^This JKai is the sixth of the line\. One before them lasted 32 days and died of the cold\. Each time one dies/,
    );
  });

  it('never counts the lives left out, nor says anything is missing', () => {
    for (const w of [numbered, unnumbered]) {
      const all = [...chapterStrings(wildmindChapter(w)), lifeRows(w)!.summary].join(' ');
      expect(all).not.toMatch(/fifth|four before|five before|left off|anything from|missing|hidden|bug|void/);
    }
  });

  it('names a gap in the middle by each life’s own number, and counts only those listed', () => {
    const w = base({
      generation: 9,
      earlierLives: [
        { n: 8, days: 10, cause: 'cold' },
        { n: 7, days: 20, cause: null },
        { n: 5, days: 30, cause: 'thirst' },
        { n: 2, days: 40, cause: 'starvation' },
      ],
    });
    const v = lifeRows(w)!;
    expect(v.rows.map((r) => r.label)).toEqual([
      'second · 40 days · hunger',
      'fifth · 30 days · thirst',
      'seventh · 20 days',
      'eighth · ten days · the cold',
      'ninth · day 18 · this one',
    ]);
    expect(v.more).toBe(0);
    expect(v.summary).toMatch(/^Nine lives so far\. The second lasted 40 days and died of hunger, the fifth lasted 30 days/);
    expect(p2(wildmindChapter(w))).toContain('This JKai is the ninth of the line. The four before them lasted anything from ten days to 40 days.');
    const three = base({ generation: 9, earlierLives: w.earlierLives.slice(0, 2) });
    expect(p2(wildmindChapter(three))).toContain(
      'This JKai is the ninth of the line. The seventh lasted 20 days, and the eighth lasted ten days and died of the cold.',
    );
    // More listed than six bars: the ghost line counts the listed ones left off the top.
    const many = base({ generation: 20, earlierLives: [19, 17, 16, 15, 14, 12, 11, 3].map((n) => ({ n, days: n, cause: null })) });
    expect(lifeRows(many)!.more).toBe(3);
    expect(lifeRows(many)!.before).toBe('and three before them');
    expect(lifeRows(many)!.summary).toMatch(/^20 lives so far\. The three before are left off\. The 14th lasted 14 days, /);
    expect(p2(wildmindChapter(many))).toContain('The eight before them lasted anything from three days to 19 days.');
  });

  it('never gives a range from one length to the same length', () => {
    const same = base({ generation: 9, earlierLives: [8, 6, 4, 2].map((n) => ({ n, days: 32, cause: 'cold' as const })) });
    expect(p2(wildmindChapter(same))).toContain('The four before them each lasted 32 days.');
    const loose = base({ generation: 9, earlierLives: [1, 2, 3, 4].map(() => ({ days: 32, cause: 'cold' as const })) });
    expect(p2(wildmindChapter(loose))).toContain('This JKai is the ninth of the line. Earlier ones each lasted 32 days.');
  });

  it('without numbers, names none of several earlier lives and counts none before', () => {
    const w = base({ generation: 9, earlierLives: [{ days: 3, cause: null }, { days: 32, cause: 'cold' }] });
    expect(lifeRows(w)!.summary).toBe(
      'Nine lives so far. One lasted 32 days and died of the cold, a later one lasted three days, and this one is on day 18.',
    );
    expect(p2(wildmindChapter(w))).toContain('This JKai is the ninth of the line. One before them lasted 32 days and died of the cold, and a later one lasted three days.');
    const long = base({ generation: 12, earlierLives: [1, 2, 3, 4, 5, 6, 7].map((d) => ({ days: d * 3, cause: null })) });
    expect(lifeRows(long)!.before).toBe('and others before them');
    expect(lifeRows(long)!.summary).toMatch(/^12 lives so far\. Earlier ones are left off\. One lasted 15 days, a later one lasted 12 days, another lasted nine days/);
    expect(p2(wildmindChapter(long))).toContain('Earlier ones lasted anything from three days to 21 days.');
  });

  it('between lives, ends on the life just ended, with or without numbers', () => {
    const ended = { state: 'between-lives' as const, generation: 6, day: 5, people: deadMain };
    const n = base({ ...ended, earlierLives: [{ n: 6, days: 5, cause: 'thirst' }, { n: 1, days: 32, cause: 'cold' }] });
    const u = base({ ...ended, earlierLives: [{ days: 5, cause: 'thirst' }, { days: 32, cause: 'cold' }] });
    expect(lifeRows(n)!.rows.map((r) => r.label)).toEqual(['first · 32 days · the cold', 'sixth · five days · thirst']);
    expect(lifeRows(u)!.rows.map((r) => r.label)).toEqual(['32 days · the cold', 'sixth · five days · thirst']);
    expect(lifeRows(u)!.summary).toBe('Six lives so far. One lasted 32 days and died of the cold, and the sixth lasted five days and died of thirst.');
    expect(p1(wildmindChapter(n))).toContain('JKai died of thirst on day five');
    expect(p1(wildmindChapter(u))).toContain('JKai died of thirst on day five');
    expect(p2(wildmindChapter(n))).toMatch(/^That JKai was the sixth of the line\. The first lasted 32 days and died of the cold\. Claude is reading back/);
    expect(p2(wildmindChapter(u))).toMatch(/^That JKai was the sixth of the line\. One before them lasted 32 days and died of the cold\. Claude is reading back/);
    // The life just ended left out of the list: no cause is borrowed from an older one.
    const gone = base({ ...ended, earlierLives: [{ n: 1, days: 32, cause: 'cold' }] });
    expect(p1(wildmindChapter(gone))).toContain('JKai died on day five');
    expect(p2(wildmindChapter(gone))).toMatch(/^That JKai was the sixth of the line\. The first lasted 32 days and died of the cold\./);
    expect(lifeRows(gone)!.rows.map((r) => r.label)).toEqual(['first · 32 days · the cold']);
  });

  it('reads an unbroken numbered line exactly as an unnumbered one', () => {
    const number = (w: WildmindShowcase): WildmindShowcase => {
      const top = w.state === 'between-lives' ? w.generation! : w.generation! - 1;
      return { ...w, earlierLives: w.earlierLives.map((l, j) => ({ ...l, n: top - j })) };
    };
    const lines = [
      base(),
      base({ generation: 1, earlierLives: [] }),
      base({ generation: 9, earlierLives: [5, 40, 3, 12, 0.5, 8, 22, 1].map((days) => ({ days, cause: 'cold' as const })) }),
      base({ generation: 7, earlierLives: [5, 40, 3, 12, 0.5, 8].map((days) => ({ days, cause: null })) }),
      base({ state: 'between-lives', people: deadMain, earlierLives: [{ days: 18, cause: 'cold' }, ...base().earlierLives] }),
    ];
    for (const w of lines) {
      expect(lifeRows(number(w))).toEqual(lifeRows(w));
      expect(chapterStrings(wildmindChapter(number(w)))).toEqual(chapterStrings(wildmindChapter(w)));
    }
    expect(lifeRows(number(base()))!.summary).toBe(
      'Three lives so far. The first lasted 32 days and died of the cold, the second lasted three days and died of hunger, and this one is on day 18.',
    );
  });

  it('keeps the gapped lines free of digits in their words', () => {
    const cases = [
      numbered,
      unnumbered,
      base({ generation: 9, day: 1, refused: 2, earlierLives: [{ n: 7, days: 3, cause: null }, { n: 2, days: 1, cause: 'cold' }] }),
      base({ generation: 9, day: 1, refused: 2, earlierLives: [3, 4, 5, 6, 7, 8, 9].map((d) => ({ days: d, cause: null })) }),
    ];
    for (const w of cases) {
      const figs = [w.day, w.generation, w.refused, w.invented, ...w.earlierLives.map((l) => Math.round(l.days))].map(String).sort((a, b) => b.length - a.length);
      let s = [...chapterStrings(wildmindChapter(w)), lifeRows(w)!.summary, lifeRows(w)!.before ?? ''].join(' ');
      for (const f of figs) s = s.split(f).join('');
      expect(s).not.toMatch(/\d/);
    }
  });
});
