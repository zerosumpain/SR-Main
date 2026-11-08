// The copy file (WP8, spec §13.2): complete at both levels for everything
// the registries name, kid text readable at about 7–8 (§9.14), no fear lines
// (§9.7), no player free text in kid text, and a template grammar every
// renderer (engine, page, app) can follow. The cross-checks read the other
// packages' sources so a new want, Deputy note or lens shows up here as
// missing copy rather than as a raw key on a child's screen.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ADVISOR_RULES, advisorCopyKeys } from './advisors';
import { NAME_FIRST, NAME_SECOND } from './content';
import {
  AVATARS,
  CARD_SLOTS,
  COPY,
  DEPUTY_NOTES,
  LENS_IDS,
  WANT_KEYS,
  advisorText,
  fill,
  orderText,
  quantityKey,
  quantityLabel,
  requiredCopyKeys,
  say,
  templateSlots,
  wantText,
  whyLine,
  whyTermText,
  type CopyEntry,
} from './copy';
import { QUANTITIES, TERMS, termFits } from './why';

const ENGINE = new URL('.', import.meta.url).pathname;
const REPO = join(ENGINE, '../../../../..');
const read = (rel: string) => readFileSync(join(REPO, rel), 'utf8');

const LEVELS = ['kid', 'adult'] as const;
const texts = (e: CopyEntry, level: 'kid' | 'adult'): string[] =>
  (level === 'kid' ? [e.kid, e.kidLess] : [e.adult, e.adultLess]).filter((s): s is string => typeof s === 'string');
const allKid = (): [string, string][] => Object.entries(COPY).flatMap(([k, e]) => texts(e, 'kid').map((s) => [k, s] as [string, string]));
const allText = (): [string, string][] => Object.entries(COPY).flatMap(([k, e]) => [...texts(e, 'kid'), ...texts(e, 'adult')].map((s) => [k, s] as [string, string]));

// ---- The readability lint (§9.14: sentence length and a word list) -----------------------------

/** Template text as a reader meets it: each slot becomes one short word. */
const plain = (s: string) => s.replace(/\{[^}]*\}/g, 'six');
const sentences = (s: string) => plain(s).split(/(?<=[.!?…])\s+/).map((x) => x.trim()).filter(Boolean);
const words = (s: string) => plain(s).split(/[\s/–-]+/).map((w) => w.replace(/^[^\p{L}\p{N}£]+|[^\p{L}\p{N}]+$/gu, '')).filter(Boolean);

/** A rough syllable count: vowel groups, less a silent final e. */
function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 1;
  let n = (w.match(/[aeiouy]+/g) ?? []).length;
  if (w.length > 2 && w.endsWith('e') && !w.endsWith('le') && !w.endsWith('ee') && n > 1) n--;
  return Math.max(1, n);
}

/** Words of more than 10 letters a 7–8-year-old meets in the game anyway (names of things on screen). */
const KID_LONG_OK = new Set(['professionals', 'comfortable', 'neighbourhood', 'firefighters', 'constables', 'everything', 'everywhere', 'playground', 'together', 'businesses', 'university']);

/**
 * Grown-up words a child's copy says another way (§9.14: "money", not
 * "revenue"; "draw residents", "Safety" and "repairs"; never "steal",
 * "attack" or "crime wave").
 */
const KID_BANNED = [
  'revenue', 'expenditure', 'deficit', 'surplus', 'upkeep', 'debt', 'interest', 'margin', 'margins', 'reserves', 'ledger',
  'migration', 'migrate', 'cohort', 'cohorts', 'utility', 'utilities', 'infrastructure', 'ratio', 'capacity', 'coverage',
  'desirability', 'congestion', 'congested', 'pollution', 'unemployment', 'unemployed', 'employment', 'approval', 'zoning',
  'gentrification', 'demolish', 'demolished', 'crime', 'criminal', 'criminals', 'steal', 'stealing', 'stolen', 'attack',
  'poach', 'rival', 'rivals', 'enemy', 'beat', 'lose', 'loser', 'losing', 'tax base', 'percent',
];

/** No fear lines at either level (§9.7: problems are always phrased as wants). */
const FEAR = ['dying', 'die', 'dies', 'dead', 'death', 'doomed', 'disaster', 'collapse', 'collapsing', 'ruin', 'ruined', 'bankrupt', 'bankruptcy', 'game over', 'failing', 'failure', 'hate', 'riot', 'panic', 'hurry', 'streak'];

const hasWord = (s: string, w: string) => new RegExp(`(^|[^\\p{L}])${w.replace(/ /g, '\\s+')}($|[^\\p{L}])`, 'iu').test(plain(s));

const NUMERIC_FORMATS = new Set(['n', 'signed', 'money', 'signedMoney', 'pct', 'bp', 'stars', 'time', 'ms', 'count']);

// ---- Completeness ---------------------------------------------------------------------------------

describe('copy completeness (every key has both levels)', () => {
  const required = requiredCopyKeys();

  it('has a kid and an adult line for every key the registries need', () => {
    const missing: string[] = [];
    for (const k of required) {
      const e = COPY[k];
      if (!e) missing.push(`${k} (no entry)`);
      else for (const lv of LEVELS) if (typeof e[lv] !== 'string' || !e[lv].trim()) missing.push(`${k}.${lv}`);
    }
    expect(missing).toEqual([]);
    expect(required.length).toBeGreaterThan(600);
  });

  it('has no orphan entries, and every entry is a well-formed pair', () => {
    const need = new Set(required);
    expect(Object.keys(COPY).filter((k) => !need.has(k))).toEqual([]);
    for (const [k, e] of Object.entries(COPY)) {
      expect(Object.keys(e).every((f) => ['kid', 'adult', 'kidLess', 'adultLess'].includes(f)), k).toBe(true);
      // A turned-around wording comes in pairs, so no level falls back alone.
      expect(e.kidLess === undefined, k).toBe(e.adultLess === undefined);
    }
  });

  it('covers every Why term and names every quantity (§5.19)', () => {
    for (const t of TERMS) expect(COPY[`why.${t.key}`], t.key).toBeDefined();
    for (const q of QUANTITIES) {
      expect(quantityKey(q.id), q.id).not.toBeNull();
      for (const lv of LEVELS) {
        const label = quantityLabel(q.id, lv);
        expect(label, q.id).not.toMatch(/[{}]|something/);
        expect(label).not.toBe(q.id);
      }
    }
  });

  it('words every term for a fitting quantity, both ways round', () => {
    for (const t of TERMS) {
      const q = QUANTITIES.find((x) => termFits(t, x.id))!;
      expect(q, t.key).toBeDefined();
      for (const lv of LEVELS)
        for (const amount of [12, -12]) {
          const s = whyTermText(t.key, amount, q.id, lv);
          expect(s, `${t.key} ${lv} ${amount}`).not.toMatch(/[{}]|^why\.|something/);
        }
    }
  });

  it('words every advisor rule (advisors.ts copy keys) with a button for its action', () => {
    for (const k of advisorCopyKeys()) expect(say(k, 'kid'), k).not.toBe(k);
    for (const r of ADVISOR_RULES)
      for (const lv of LEVELS) {
        const card = advisorText(r.id, lv);
        expect(card.advisor, r.id).toMatch(/^(Bramble|Penny|Mo|Zia) the /);
        expect(card.line).not.toBe(`advisor.${r.id}`);
        expect(card.button).not.toBe(`action.${r.action}`);
      }
  });

  it('words every want bubble mood.ts can raise', () => {
    const src = read('src/lib/games/hometowns/engine/mood.ts');
    const raised = new Set<string>();
    for (const m of src.matchAll(/want\('([\w.]+)'/g)) raised.add(m[1]);
    for (const m of src.matchAll(/cand\.push\(\{ key: '([\w.]+)'/g)) raised.add(m[1]);
    expect(raised.size).toBeGreaterThanOrEqual(7);
    for (const k of raised) expect(WANT_KEYS, k).toContain(k);
    for (const k of WANT_KEYS) for (const lv of LEVELS) expect(wantText(k, lv)).not.toMatch(/^want\./);
  });

  it('words every Deputy note orders.ts writes (§5.18: every action shows in welcome back)', () => {
    const src = read('src/lib/games/hometowns/engine/orders.ts');
    const notes = [...src.matchAll(/deputyNote\(t, m, '([\w.]+)'/g)].map((m) => m[1]);
    expect(notes.length).toBeGreaterThanOrEqual(5);
    expect([...new Set(notes)].sort()).toEqual([...DEPUTY_NOTES].sort());
  });

  it('words every welcome-back card the wire builds', () => {
    const src = read('src/lib/games/hometowns/wire.ts');
    const keys = [...src.matchAll(/key: '(welcomeBack\.\w+)'/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThanOrEqual(3);
    for (const k of keys) expect(CARD_SLOTS[k], k).toBeDefined();
  });

  it('names the same lenses as the map page', () => {
    const src = read('games/hometowns-view/src/lenses.ts');
    const m = src.match(/LENS_IDS\s*=\s*\[([^\]]*)\]/);
    expect(m).not.toBeNull();
    const ids = [...m![1].matchAll(/'(\w+)'/g)].map((x) => x[1]);
    expect(ids).toEqual([...LENS_IDS]);
  });
});

// ---- The template grammar ---------------------------------------------------------------------------

describe('templates', () => {
  it('use only known formats, and every reference resolves to a copy list', () => {
    const prefixes = new Set(Object.keys(COPY).map((k) => k.slice(0, k.lastIndexOf('.'))));
    for (const [k, s] of allText()) {
      expect((s.match(/\{/g) ?? []).length, k).toBe((s.match(/\}/g) ?? []).length);
      for (const slot of templateSlots(s)) {
        expect(['', 'ref', ...NUMERIC_FORMATS], `${k}: ${slot.fmt}`).toContain(slot.fmt);
        if (slot.fmt === 'ref') expect(prefixes.has(slot.arg1), `${k}: ref:${slot.arg1}`).toBe(true);
        if (slot.fmt === 'count') expect(slot.arg1 && slot.arg2, `${k}: count needs two words`).toBeTruthy();
      }
    }
  });

  it('never show a child a player’s own words: a kid slot is a number or a reference', () => {
    const bad: string[] = [];
    for (const [k, s] of allKid()) for (const slot of templateSlots(s)) if (slot.fmt !== 'ref' && !NUMERIC_FORMATS.has(slot.fmt)) bad.push(`${k}: {${slot.name}}`);
    expect(bad).toEqual([]);
    // And at render time a string in a kid slot never prints, whatever is passed.
    expect(fill('Hi {x:n} and {y:ref:face}', 'kid', { x: 'Mayor Typed-Name', y: 'not-a-face' })).toBe('Hi something and something');
    expect(fill('Hi {x}', 'adult', { x: 'Sunnyvale' })).toBe('Hi Sunnyvale');
  });

  it('send each card exactly the data fields its writer declares', () => {
    for (const [k, fields] of Object.entries(CARD_SLOTS))
      for (const lv of LEVELS) for (const s of texts(COPY[k], lv)) for (const slot of templateSlots(s)) expect(fields, `${k}.${lv}`).toContain(slot.name);
    for (const lv of LEVELS) for (const k of Object.keys(COPY).filter((x) => x.startsWith('order.'))) expect(orderText(k.slice(6), [2, 200, 3], lv)).not.toMatch(/[{}]/);
  });

  it('format numbers by our own arithmetic, the same everywhere (A25)', () => {
    const d = { a: 1234567, b: -300, c: 0.384, bp: 250, s: 72, one: 1, many: 12, t: 2, m: 9, y: 96 };
    expect(fill('{a:money} {b:signedMoney} {a:signed} {b:n}', 'adult', d)).toBe('£1,234,567 −£300 +1,234,567 −300');
    expect(fill('{c:pct} {bp:bp} {s:stars}', 'adult', d)).toBe('38% 2.5% ★3.5');
    expect(fill('{one:count:home:homes}, {many:count:home:homes}', 'kid', d)).toBe('1 home, 12 homes');
    expect(fill('{t:time} · {m:time} · {y:time}', 'kid', d)).toBe('2 weeks · 2 months · 2 years');
    expect(fill('{y:time}', 'adult', { y: 60 })).toBe('1.3 years');
    expect([20_000, 60_000, 25 * 60_000, 2 * 3_600_000, 3 * 86_400_000].map((ms) => fill('{ms:ms}', 'kid', { ms }))).toEqual([
      'a moment',
      'about a minute',
      'about 25 minutes',
      'about 2 hours',
      'about 3 days',
    ]);
    expect(say('welcomeBack.away', 'kid', { ticks: 96 })).toBe('Welcome back! While you were away, 2 years went by in your town.');
    expect(say('inbox.promotion', 'kid', { tier: 1, parcels: 2 })).toBe("We're a Village now! Pick 2 new patches of land.");
    expect(say('bulletin.opened', 'adult', { building: 'library' })).toBe('Library opened.');
  });

  it('turn the wording around for a negative amount where it reads differently', () => {
    expect(whyTermText('mig.in.schools', 40, 'arrive.fM', 'kid')).toBe('Good schools brought Families');
    expect(whyTermText('mig.in.schools', -40, 'arrive.fM', 'kid')).toBe('Busy schools kept Families away');
    expect(whyTermText('mig.in.schools', 40, 'arrive.fM', 'adult')).toBe('Schools star vs the county');
    expect(whyTermText('pop.births', -5, 'pop', 'kid')).toBe('Babies were born');
    expect(quantityLabel('happy.wH', 'adult')).toBe('£££ Professionals happiness');
    expect(whyLine('money.homesTax', 4200, 'revenue', 'adult')).toBe('+£4,200 homes tax');
    expect(whyLine('lv.pollution', -22, 'lv', 'adult')).toBe('−22 pollution');
    expect(whyLine('lv.pollution', -22, 'lv', 'kid')).toBe('↓ Smoke');
    expect(whyLine('mig.out.jobs', 9, 'depart.wL', 'kid')).toBe('↑ Some Workers left to find jobs');
  });
});

// ---- Readability and wording rules (§9.7, §9.14) ------------------------------------------------------

describe('kid text reads at about 7–8', () => {
  it('keeps every kid sentence short and every kid line brief', () => {
    const long: string[] = [];
    for (const [k, s] of allKid()) {
      if (s.length > 130) long.push(`${k}: ${s.length} chars`);
      for (const sen of sentences(s)) if (words(sen).length > 16) long.push(`${k}: "${sen}"`);
      if (sentences(s).length > 2) long.push(`${k}: ${sentences(s).length} sentences`);
    }
    expect(long).toEqual([]);
  });

  it('uses short everyday words (names on screen excepted)', () => {
    const hard: string[] = [];
    for (const [k, s] of allKid())
      for (const w of words(s)) {
        const name = /^\p{Lu}/u.test(w);
        if (!name && w.length > 10 && !KID_LONG_OK.has(w.toLowerCase())) hard.push(`${k}: ${w}`);
        if (!name && syllables(w) >= 4 && !KID_LONG_OK.has(w.toLowerCase())) hard.push(`${k}: ${w} (${syllables(w)} syllables)`);
      }
    expect(hard).toEqual([]);
  });

  it('scores as early-primary prose overall (Flesch–Kincaid grade ≤ 3)', () => {
    let nw = 0;
    let ns = 0;
    let nsyl = 0;
    for (const [, s] of allKid()) {
      ns += sentences(s).length;
      for (const w of words(s)) {
        nw++;
        nsyl += syllables(w);
      }
    }
    const grade = 0.39 * (nw / ns) + 11.8 * (nsyl / nw) - 15.59;
    expect(grade).toBeLessThanOrEqual(3);
  });

  it('says grown-up and unkind words another way', () => {
    const hits: string[] = [];
    for (const [k, s] of allKid()) for (const w of KID_BANNED) if (hasWord(s, w)) hits.push(`${k}: ${w}`);
    expect(hits).toEqual([]);
  });

  it('keeps each advisor card to one or two sentences at both levels (§9.7)', () => {
    for (const r of ADVISOR_RULES)
      for (const lv of LEVELS) {
        const n = sentences(say(`advisor.${r.id}`, lv)).length;
        expect(n, `${r.id}.${lv}`).toBeGreaterThanOrEqual(1);
        expect(n, `${r.id}.${lv}`).toBeLessThanOrEqual(2);
      }
  });
});

describe('no fear lines, at either level', () => {
  it('never uses fear or loss words', () => {
    const hits: string[] = [];
    for (const [k, s] of allText()) for (const w of FEAR) if (hasWord(s, w)) hits.push(`${k}: ${w}`);
    expect(hits).toEqual([]);
  });

  it('keeps the town-name halves and avatars short, kind and pronounceable', () => {
    for (const p of [...NAME_FIRST, ...NAME_SECOND, ...AVATARS]) {
      expect(p).toMatch(/^[A-Za-z]{2,8}$/);
      for (const w of [...FEAR, ...KID_BANNED]) expect(p.toLowerCase()).not.toBe(w);
    }
  });
});

describe('the file', () => {
  it('stays small enough to bundle in the page and the app', () => {
    const bytes = readFileSync(join(ENGINE, 'copy/en-GB.json')).length;
    expect(bytes).toBeLessThan(140_000);
  });
});
