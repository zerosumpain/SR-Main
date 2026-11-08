import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { offlineShowcase, type WildmindShowcase } from './wildmind';
import { wildmindFixture } from './wildmind.fixture';
import { andList, causeWord, daysWord, doingWord, habitWord, mapSummary, modelsLine, ordinalWord, stateLine } from './wildmind-words';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const live = (): WildmindShowcase => wildmindFixture(NOW);

describe('wildmind words', () => {
  it('counts ordinals in words, then figures', () => {
    expect([1, 2, 3, 12].map(ordinalWord)).toEqual(['first', 'second', 'third', 'twelfth']);
    expect([13, 21, 22, 23, 111, 102].map(ordinalWord)).toEqual(['13th', '21st', '22nd', '23rd', '111th', '102nd']);
  });

  it('says how long a life lasted', () => {
    expect(daysWord(0.4)).toBe('less than a day');
    expect(daysWord(1.2)).toBe('a day');
    expect(daysWord(2.9)).toBe('three days');
    expect(daysWord(32.3)).toBe('32 days');
  });

  it('names the cause, or nothing', () => {
    expect(causeWord('cold')).toBe('the cold');
    expect(causeWord('starvation')).toBe('hunger');
    expect(causeWord(null)).toBeNull();
  });

  it('always starts a doing line with the name', () => {
    expect(doingWord({ name: 'JKai', doing: 'asleep', alive: true, near: 'Mirror Mere' })).toBe('JKai is asleep near Mirror Mere');
    expect(doingWord({ name: 'Wren', doing: 'at work', alive: true, near: null })).toBe('Wren is at work');
    expect(doingWord({ name: 'JKai', doing: 'asleep', alive: true, near: 'Mirror Mere' }, false)).toBe('JKai is asleep');
    expect(doingWord({ name: 'JKai', doing: 'dead', alive: false, near: 'Mirror Mere' })).toBe('JKai is dead');
  });

  it('bands habit and names the models', () => {
    expect(habitWord('most')).toBe('Most');
    expect(habitWord(null)).toBeNull();
    expect(modelsLine({ mind: 'Haiku', designer: 'Sonnet' })).toBe('thinks with Haiku and invents with Sonnet');
    expect(modelsLine({ mind: 'a Claude model', designer: 'a Claude model' })).toBe('thinks and invents with a Claude model');
    expect(modelsLine(null)).toBeNull();
  });

  it('joins names in prose', () => {
    expect(andList([])).toBe('');
    expect(andList(['JKai'])).toBe('JKai');
    expect(andList(['JKai', 'Wren'])).toBe('JKai and Wren');
    expect(andList(['A', 'B', 'C'])).toBe('A, B and C');
  });

  it('says each state in game time only', () => {
    const w = live();
    expect(stateLine(w)).toBeNull();
    expect(stateLine({ ...w, state: 'resting' })).toBe("Their minds are resting till tomorrow, so they're getting by on habit.");
    expect(stateLine({ ...w, state: 'paused' })).toBe("The valley's paused just now.");
    expect(stateLine({ ...w, state: 'stale', day: 16 })).toBe("This is how the valley stood on day 16. It isn't answering just now.");
    expect(stateLine(offlineShowcase())).toBe("The valley isn't answering just now.");
    const ended = wildmindFixture(NOW, 'between-lives');
    expect(stateLine(ended)).toMatch(/^JKai died of the cold on day \S+\. The next of the line wakes up in a fresh valley shortly\.$/);
    expect(stateLine({ ...ended, earlierLives: [{ days: 3, cause: null }] })).toMatch(/^JKai died on day /);
    for (const s of ['live', 'resting', 'paused', 'stale', 'between-lives', 'offline'] as const)
      expect(stateLine({ ...w, state: s }) ?? '').not.toMatch(/\d{1,2}:\d{2}|ago|since|hours?\b|minutes?\b|!|:/);
  });

  it('sums the map up in a sentence or two', () => {
    const w = live();
    const s = mapSummary(w);
    expect(s).toMatch(/^A map of the land JKai and Wren have seen so far, where they’ve named 19 places\. JKai is walking near .+ and Wren is at work near Bittern Beds\.$/);
    expect(mapSummary(offlineShowcase())).toBe("The valley isn't answering just now, so there's no map of it.");
    expect(mapSummary({ ...w, map: null }, true)).toMatch(/^A map of the land JKai and Wren have seen so far\./);
  });
});

/** The string literals in a source file (comments skipped), template holes removed. */
function literals(src: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') i = src.indexOf('\n', i) + 1 || src.length;
    else if (c === '/' && src[i + 1] === '*') i = src.indexOf('*/', i) + 2;
    else if (c === '/' && /[=(,|&!:?]\s*$/.test(src.slice(Math.max(0, i - 3), i))) {
      // A regex literal: skip to its closing slash.
      i++;
      while (i < src.length && src[i] !== '/') i += src[i] === '\\' ? 2 : 1;
      i++;
    } else if (c === "'" || c === '"' || c === '`') {
      let s = '';
      i++;
      let depth = 0;
      while (i < src.length && (src[i] !== c || depth > 0)) {
        if (src[i] === '\\') {
          s += src[i + 1];
          i += 2;
          continue;
        }
        if (c === '`' && src[i] === '$' && src[i + 1] === '{') depth++;
        else if (c === '`' && src[i] === '}' && depth > 0) {
          depth--;
          i++;
          continue;
        }
        if (depth === 0) s += src[i];
        i++;
      }
      out.push(s);
      i++;
    } else i++;
  }
  return out;
}

describe('wildmind copy rules', () => {
  it('has no digit, colon or exclamation mark in any literal', () => {
    const src = readFileSync(new URL('./wildmind-words.ts', import.meta.url), 'utf8');
    const found = literals(src);
    expect(found).toContain("The valley's paused just now.");
    for (const s of found) expect(s, s).not.toMatch(/[0-9:!]/);
  });
});
