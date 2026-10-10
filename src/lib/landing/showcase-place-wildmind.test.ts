import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { column } from './showcase-city';
import { labelBox, type Box } from './showcase-place';
import {
  ANCHOR_GAP,
  CLAMP,
  GALLERY,
  GALLERY_LIGHT,
  HUT_CAP,
  WORDS_BAND,
  creamOn,
  dayWordsGround,
  figureTop,
  gatherHuts,
  leaderPath,
  onBoard,
  peopleAnchors,
  poolAlpha,
  wildmindPins,
  wildmindPlaceWords,
  wordsGround,
  type WmTag,
} from './showcase-place-wildmind';
import type { WildmindPerson, WildmindShowcase, WildmindState } from './wildmind';
import { BOARD } from './wildmind-glass';
import { fixtureGlass, wildmindFixture } from './wildmind.fixture';

const NOW = Date.parse('2026-10-10T13:30:00Z');
const STATES: WildmindState[] = ['live', 'resting', 'paused', 'between-lives', 'stale', 'offline'];
const hit = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** The fixture as the place view gets it: the model under glass, no flat map. */
function fixture(state: WildmindState | 'asleep' | 'young' = 'live'): WildmindShowcase {
  const w = wildmindFixture(NOW, state);
  return { ...w, map: null, glass: w.mapVersion ? fixtureGlass(state) : null };
}
function withPeople(w: WildmindShowcase, ids: Array<WildmindPerson['id']>): WildmindShowcase {
  return { ...w, people: w.people.filter((p) => ids.includes(p.id)) };
}
function allStrings(x: unknown): string[] {
  if (typeof x === 'string') return [x];
  if (Array.isArray(x)) return x.flatMap(allStrings);
  if (x && typeof x === 'object') return Object.values(x).flatMap(allStrings);
  return [];
}
function prose(w: WildmindShowcase): string[] {
  const words = wildmindPlaceWords(w);
  return allStrings({ ...words, head: { ...words.head, figure: undefined } });
}

/* -------------------------------------------------------------------- copy */

/** Every string literal's static text between the copy markers: none may hold a digit. */
function copyLiterals(): string[] {
  const src = readFileSync(fileURLToPath(new URL('./showcase-place-wildmind.ts', import.meta.url)), 'utf8');
  const from = src.indexOf('/* copy:start');
  const to = src.indexOf('/* copy:end */');
  expect(from).toBeGreaterThan(0);
  expect(to).toBeGreaterThan(from);
  const file = ts.createSourceFile('copy.ts', src, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const walk = (n: ts.Node) => {
    if (n.getStart() >= to || n.getEnd() <= from) return;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push(n.text);
    else if (ts.isTemplateExpression(n)) out.push(n.head.text, ...n.templateSpans.map((s) => s.literal.text));
    ts.forEachChild(n, walk);
  };
  walk(file);
  return out;
}

describe('the copy', () => {
  it('has no digits of its own: every figure comes from the data', () => {
    const lits = copyLiterals();
    expect(lits.length).toBeGreaterThan(60);
    for (const s of lits) expect(s, `literal ${JSON.stringify(s)}`).not.toMatch(/\d/);
  });

  it('keeps the house rules in every state, with two people, one or none', () => {
    for (const state of STATES)
      for (const ids of [['main', 'companion'], ['main'], ['companion'], []] as Array<Array<WildmindPerson['id']>>) {
        const w = withPeople(fixture(state), ids);
        for (const s of prose(w)) {
          const at = `${state}/${ids.join('+')}: ${s}`;
          expect(s, at).not.toMatch(/[:!]/);
          // They/them for JKai and Wren; no clock time, "ago", real date or last sync.
          expect(s, at).not.toMatch(/\b(he|she|him|his|her|hers)\b/i);
          expect(s, at).not.toMatch(/\b(ago|minutes?|hours?|o’clock|yesterday|today|am|pm|last seen|since)\b|\d{1,2}[.:]\d{2}/i);
          expect(s, at).not.toMatch(/undefined|null|NaN|\b0\b/);
          expect(s, at).toBe(s.trim());
          expect(s, at).not.toMatch(/ {2}|\s[.,]/);
        }
      }
  });

  it('says what the fixture shows, live', () => {
    const words = wildmindPlaceWords(fixture('live'));
    expect(words.head.kicker).toBe('Wildmind · a model under glass');
    expect(words.head.title).toBe('It makes things up to stay alive');
    expect(words.head.aside).toBe('Please don’t tap the glass.');
    expect(words.head.unit).toBe('things invented in this valley');
    expect(words.head.figure).toBe(7);
    expect(words.key).toMatch(/^A little world I’m building where two people have Claude for a mind\. They start in a valley with nothing/);
    expect(words.key).toMatch(
      /The model in the window is the land they’ve seen so far, a layer of card for every step of height, and it grows as they walk\.$/,
    );
    expect(words.rules).toBe(
      'It runs on a box in the house whether anyone’s watching or not. They think with Haiku and invent with Sonnet, and the referee in the code has turned down one of their ideas so far.',
    );
    expect(words.captions).toEqual({
      moving: 'The two of them move on the model as they do in the valley.',
      held: 'The model’s holding still where they were.',
      reduced: 'The model jumps to where they are each time it checks.',
    });
    expect(words.close).toBe('I’ll write up how it all works once it stops surprising me.');
    expect(words.tags.map((t) => t.id)).toEqual(['main', 'companion', 'latest']);
    const [main, mate, latest] = words.tags;
    expect(main.kicker).toBe('JKai');
    expect(main.value).toBe('walking');
    expect(main.note).toMatch(/^JKai’s the orange one, and the third of the line\. The first lasted /);
    expect(main.note).toMatch(/roughly how families work too\.$/);
    expect(mate.kicker).toBe('Wren');
    expect(mate.value).toBe('at work');
    expect(mate.note).toMatch(/^Wren’s the blue one\. They woke up in the same valley/);
    expect(mate.note).toContain('Between them they’ve named 15 places so far.');
    expect(latest.value).toBe('reed basket');
    expect(latest.sub).toBe('before that, woven fibre basket');
    expect(latest.long).toBe(true);
    expect(words.summary).toMatch(/^A card model in a gallery window of the land JKai and Wren have seen so far, a layer for every step of height\. JKai is walking/);
  });

  it('puts the valley’s day and night in the valley, never on the street', () => {
    const live = wildmindPlaceWords(fixture('live')).head.dateline!;
    expect(live).toMatch(/^day [\w,]+ · (spring|summer|autumn|winter) · in the valley, a (clear|cloudy|wet|stormy|snowy|foggy) (day|night)$/);
    const asleep = fixture('asleep');
    expect(wildmindPlaceWords(asleep).head.dateline).toMatch(/in the valley, a clear night$/);
    expect(wildmindPlaceWords({ ...asleep, weather: null }).head.dateline).toMatch(/· in the valley$/);
    expect(wildmindPlaceWords({ ...asleep, day: null }).head.dateline).toMatch(/^(spring|summer|autumn|winter) · in the valley/);
    // No other state names a time of day.
    for (const s of STATES.filter((x) => x !== 'live')) expect(wildmindPlaceWords(fixture(s)).head.dateline ?? '').not.toMatch(/\b(day|night)$/);
  });

  it('changes with each state, and says no more than it knows', () => {
    const at = (s: WildmindState) => wildmindPlaceWords(fixture(s));
    expect(at('resting').head.dateline).toMatch(/· minds resting till tomorrow$/);
    expect(at('resting').key).toMatch(/Their minds are resting till tomorrow, so they’re getting by on habit\.$/);
    expect(at('paused').head.dateline).toMatch(/· paused just now$/);
    expect(at('paused').captions).toBeNull();
    expect(at('paused').tags[0].sub).toMatch(/, paused$/);
    expect(at('paused').tags[1].sub).toMatch(/, paused$/);
    expect(at('paused').tags[0].note).toMatch(/^JKai was walking.* when it stopped\. They’re the orange one/);
    expect(at('paused').summary).toMatch(/When it paused, .* A card on the glass says back shortly\.$/);
    expect(at('stale').head.dateline).toMatch(/· as it stood$/);
    expect(at('stale').key).toMatch(/This is how their valley stood on day [\w,]+\. It isn’t answering just now, so the model shows it as it stood\.$/);
    expect(at('stale').tags[0].sub).toMatch(/, as it stood$/);
    expect(at('stale').captions).toBeNull();
    const ended = at('between-lives');
    expect(ended.head.dateline).toBe('between lives');
    expect(ended.head.unit).toBe('things invented in that valley');
    expect(ended.head.aside).toBeUndefined();
    expect(ended.tags[0].value).toBe('died');
    expect(ended.tags[0].sub).toMatch(/^of the cold, on day [\w,]+$/);
    expect(ended.tags[0].note).toMatch(/The empty base on the model is where they fell\./);
    expect(ended.key).toMatch(/^A little world I’m building where the people have Claude for a mind\. JKai died of the cold on day .+ Till then the model stays in the window as JKai left it\.$/);
    expect(ended.rules).toMatch(/They thought with Haiku and invented with Sonnet, and the referee in the code turned down one of their ideas\.$/);
    expect(ended.summary).toMatch(/as JKai left it\. JKai died and Wren was at work/);
    const off = at('offline');
    expect(off.head.figure).toBeNull();
    expect(off.head.dateline).toBeUndefined();
    expect(off.head.aside).toBeUndefined();
    expect(off.rules).toBe('It runs on a box in the house whether anyone’s watching or not.');
    expect(off.key).toBe(
      'A little world I’m building where the people have Claude for a mind. The sheet’s on because the valley isn’t answering just now, not because they’ve stopped.',
    );
    expect(off.tags.map((t) => [t.kicker, t.value, t.sub])).toEqual([['The model', 'under a sheet', 'not answering just now']]);
    expect(off.summary).toMatch(/under a dust sheet/);
  });

  it('writes the plaque from what they made, and leaves out what it doesn’t know', () => {
    const base = fixture('live');
    const plaque = (w: Partial<WildmindShowcase>) => wildmindPlaceWords({ ...base, ...w }).tags.find((t) => t.id === 'latest');
    expect(plaque({ invented: 1, latest: ['Bark-and-stick lean-to'] })).toMatchObject({ value: 'bark-and-stick lean-to', sub: 'the only thing so far' });
    expect(plaque({ invented: 1, latest: ['Bark-and-stick lean-to'], state: 'between-lives' })?.sub).toBe('the only thing they made');
    expect(plaque({ invented: 0, latest: [] })).toMatchObject({ value: 'nothing yet' });
    expect(plaque({ invented: 0, latest: [] })?.sub).toBeUndefined();
    expect(plaque({ invented: 4, latest: [] })).toMatchObject({ value: 'four', unit: 'things' });
    expect(plaque({ invented: null })).toBeUndefined();
    expect(wildmindPlaceWords({ ...base, invented: 1 }).head.unit).toBe('thing invented in this valley');
  });

  it('says the model is still being built before it arrives, and offers no hold-still caption then', () => {
    const w = { ...fixture('live'), glass: null };
    const words = wildmindPlaceWords(w);
    expect(words.summary).toBe('The model of the valley is still being built.');
    expect(words.captions).toBeNull();
    expect(wildmindPlaceWords(withPeople(fixture('live'), ['companion'])).captions?.moving).toBe('Wren moves on the model as they do in the valley.');
  });

  it('prints the dateline and the drawing’s text equivalent after the readings', () => {
    const words = wildmindPlaceWords(fixture('live'));
    expect(words.print.map((p) => p.dt)).toEqual(['The valley’s clock', 'In the window']);
    expect(words.print[1].dd).toBe(words.summary);
    expect(wildmindPlaceWords(fixture('offline')).print.map((p) => p.dt)).toEqual(['In the window']);
  });
});

/* ------------------------------------------------------------------ layout */

describe('the gallery', () => {
  it('nests board, vitrine, plinth and window, all clear of the copy column', () => {
    const G = GALLERY;
    const col = column('l');
    expect(G.building.x).toBeGreaterThan(col.to);
    expect(G.window.x).toBeGreaterThanOrEqual(col.to + col.fade - 30);
    expect(G.vitrine.x).toBeGreaterThan(G.window.x);
    expect(G.vitrine.x + G.vitrine.w).toBeLessThan(G.window.x + G.window.w);
    expect(G.board.x).toBeGreaterThan(G.vitrine.x);
    expect(G.board.x + BOARD.w).toBeLessThan(G.vitrine.x + G.vitrine.w);
    expect(G.board.y + BOARD.d).toBeLessThan(G.plinth.top);
    expect(G.vitrine.back).toBeLessThan(G.board.y);
    expect(G.labelY).toBeLessThan(G.vitrine.back);
    expect(G.jogY).toBeLessThan(G.vitrine.back);
    expect(G.plinth.top).toBeLessThan(G.window.y + G.window.h);
    expect(G.window.y + G.window.h).toBeLessThan(G.ground);
    for (const z of [G.zone, G.phoneZone]) {
      expect(z[0]).toBeLessThanOrEqual(G.window.x + 18);
      expect(z[1]).toBeGreaterThanOrEqual(G.window.x + G.window.w - 18);
    }
    expect(onBoard({ x: 0, y: 0 })).toEqual({ x: G.board.x, y: G.board.y });
  });

  it('keeps the people’s words on the back wall, apart, wherever they stand', () => {
    const xs = Array.from({ length: 22 }, (_, k) => GALLERY.board.x + (k / 21) * BOARD.w);
    for (const ppu of [1, 1.2, 1.6]) {
      for (const a of xs)
        for (const b of xs) {
          const anchors = peopleAnchors([
            { id: 'main', x: a, y: 400 },
            { id: 'companion', x: b, y: 420 },
          ]);
          expect(anchors.map((x) => x.hang).sort()).toEqual(['l', 'r']);
          const boxes = anchors.map((x) => labelBox({ x: x.at, y: GALLERY.labelY, lead: 0, dir: 'up', hang: x.hang }, 200, 70, ppu));
          for (const box of boxes) {
            expect(box.x).toBeGreaterThanOrEqual(GALLERY.window.x);
            expect(box.x + box.w).toBeLessThanOrEqual(GALLERY.window.x + GALLERY.window.w);
            expect(box.y).toBeGreaterThan(GALLERY.window.y + GALLERY.skyStrip);
          }
          expect(hit(boxes[0], boxes[1])).toBe(false);
          const [l, r] = anchors.sort((p, q) => p.at - q.at);
          expect(r.at - l.at).toBeGreaterThanOrEqual(ANCHOR_GAP - 0.01);
          expect(l.at).toBeGreaterThanOrEqual(CLAMP.l);
          expect(r.at).toBeLessThanOrEqual(CLAMP.r);
        }
      for (const a of xs) {
        const [lone] = peopleAnchors([{ id: 'companion', x: a, y: 400 }]);
        const box = labelBox({ x: lone.at, y: GALLERY.labelY, lead: 0, dir: 'up', hang: lone.hang }, 200, 70, ppu);
        expect(box.x).toBeGreaterThanOrEqual(GALLERY.window.x);
        expect(box.x + box.w).toBeLessThanOrEqual(GALLERY.window.x + GALLERY.window.w);
      }
    }
    expect(peopleAnchors([])).toEqual([]);
  });

  it('draws each leader from the figure to its words, jogging only when the anchor moved', () => {
    expect(leaderPath(700, 420, 700)).toBe(`M700,420V${GALLERY.labelY}`);
    expect(leaderPath(880.04, 420, 770)).toBe(`M880,420V${GALLERY.labelY}H770`);
    // The jog runs under the words, well clear of the vitrine's back edge (no doubled rule over the lid).
    expect(GALLERY.vitrine.back - GALLERY.jogY).toBeGreaterThanOrEqual(12);
    const [a] = peopleAnchors([{ id: 'main', x: 600, y: 410 }]);
    expect(a).toMatchObject({ hang: 'r', at: 600, lead: `M600,410V${GALLERY.labelY}` });
    expect(figureTop(false)).toBeGreaterThan(figureTop(true));
  });

  it('pins every label: the people on the back wall, the plaque on the plinth, the sheet’s over it', () => {
    const words = wildmindPlaceWords(fixture('live'));
    const pins = wildmindPins(words.tags, peopleAnchors([{ id: 'main', x: 600, y: 400 }, { id: 'companion', x: 820, y: 400 }]));
    const by = Object.fromEntries(pins.map((p) => [p.id, p]));
    expect(by.main).toMatchObject({ x: 650, y: GALLERY.labelY, dir: 'up', hang: 'l', bare: true, lead: 0 });
    expect(by.companion).toMatchObject({ x: 770, hang: 'r', bare: true });
    expect(by.latest).toMatchObject({ x: 710, dir: 'plate' });
    expect(by.latest.y).toBeGreaterThan(GALLERY.plinth.top);
    // With no model yet, the people still have somewhere to stand.
    const early = wildmindPins(words.tags, []);
    expect(early.filter((p) => p.id !== 'latest').every((p) => p.y === GALLERY.labelY)).toBe(true);
    const off = wildmindPins(wildmindPlaceWords(fixture('offline')).tags, []);
    expect(off).toHaveLength(1);
    expect((off[0] as WmTag).id).toBe('model');
    expect(off[0].y).toBeLessThan(GALLERY.vitrine.front);
  });

  it('gathers the huts: one a patch, the lit first, capped, the nearest in front, none hiding a figure', () => {
    const many = Array.from({ length: 60 }, (_, k) => ({ x: 520 + (k % 20) * 20, y: 350 + Math.floor(k / 20) * 30, lit: k % 7 === 0, done: k % 5 !== 0 }));
    const huts = gatherHuts(many);
    expect(huts.length).toBe(HUT_CAP);
    for (let k = 1; k < huts.length; k++) expect(huts[k].y).toBeGreaterThanOrEqual(huts[k - 1].y);
    expect(huts.filter((h) => h.lit).length).toBe(many.filter((h) => h.lit).length);
    const doubled = gatherHuts([
      { x: 600, y: 400, lit: false, done: true },
      { x: 604, y: 399, lit: true, done: true },
    ]);
    expect(doubled).toEqual([{ x: 604, y: 399, lit: true, done: true }]);
    const [moved] = gatherHuts([{ x: 600, y: 400, lit: false, done: true }], [{ x: 601, y: 401 }]);
    expect(moved.x).toBeLessThan(592);
  });
});

/* ------------------------------------------------------------------- light */

describe('the gallery’s light', () => {
  it('keeps the people’s words at 4.5:1 or better on the back wall, under the lamps at full night', () => {
    expect(creamOn(wordsGround())).toBeGreaterThanOrEqual(4.5);
    expect(creamOn(GALLERY_LIGHT.wallDay)).toBeGreaterThanOrEqual(7);
  });

  it('lights the room warm by day, and still keeps the words at 4.5:1 at its brightest', () => {
    // Daylit, not the night's navy: a warm wall well up from the night's.
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(GALLERY_LIGHT.wallDay.slice(i, i + 2), 16));
    expect(r).toBeGreaterThan(b);
    expect(r + g + b).toBeGreaterThan(150);
    expect(creamOn(dayWordsGround())).toBeGreaterThanOrEqual(4.5);
  });

  it('pools the lamplight below the words, fading out above them', () => {
    expect(poolAlpha(GALLERY_LIGHT.pool.cy)).toBe(GALLERY_LIGHT.pool.peak);
    expect(poolAlpha(WORDS_BAND.y)).toBeLessThan(poolAlpha(WORDS_BAND.y + WORDS_BAND.h));
    expect(poolAlpha(GALLERY_LIGHT.pool.cy - GALLERY_LIGHT.pool.ry)).toBe(0);
    // The sky's reflection along the top of the glass stays above the words.
    expect(WORDS_BAND.y).toBeGreaterThanOrEqual(GALLERY.window.y + GALLERY.skyStrip);
  });
});
