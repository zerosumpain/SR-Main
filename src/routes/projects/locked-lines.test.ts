import { afterEach, describe, expect, it, vi } from 'vitest';
import { LOCKED_LINES, MOOD_STYLE, countLockedClick, moodFor, pickLockedLine, type Mood } from './locked-lines';

const MOODS = Object.keys(LOCKED_LINES) as Mood[];

describe('the rambler at a locked card', () => {
  it('keeps to the voice card: lower case, no exclamation marks, no colons', () => {
    for (const mood of MOODS)
      for (const text of LOCKED_LINES[mood]) {
        expect(text).not.toMatch(/[!:]/);
        expect(text).toBe(text.toLowerCase());
      }
  });

  it('says something short enough to read in under two seconds', () => {
    for (const mood of MOODS) for (const text of LOCKED_LINES[mood]) expect(text.split(' ').length).toBeLessThanOrEqual(13);
  });

  it('has plenty to say in every mood, and never says the same line twice in one', () => {
    for (const mood of MOODS) {
      expect(LOCKED_LINES[mood].length).toBeGreaterThanOrEqual(12);
      expect(new Set(LOCKED_LINES[mood]).size).toBe(LOCKED_LINES[mood].length);
    }
  });

  it('wears thinner with every click: polite, sassy, fed up, then mad', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 30].map(moodFor)).toEqual(['polite', 'polite', 'sassy', 'sassy', 'fed-up', 'fed-up', 'mad', 'mad']);
    expect(pickLockedLine(9, [], () => 0)).toMatchObject({ mood: 'mad', mode: 'mad', face: 'mad' });
    expect(pickLockedLine(5, [], () => 0)).toMatchObject({ mode: MOOD_STYLE['fed-up'].mode });
  });

  it('says the count the way he would', () => {
    const at = LOCKED_LINES.mad.indexOf('{n} times. {n}. go away');
    const roll = () => (at + 0.5) / LOCKED_LINES.mad.length;
    expect(pickLockedLine(8, [], roll).text).toBe('eight times. eight. go away');
  });

  it('does not repeat itself until he has run out of lines', () => {
    const recent: string[] = [];
    const said = Array.from({ length: 10 }, () => pickLockedLine(1, recent, () => 0).text);
    expect(new Set(said).size).toBe(10);
  });
});

describe('counting a visitor\'s clicks', () => {
  const store = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
  });
  afterEach(() => store.clear());

  it('counts up across the tab, and forgives after five quiet minutes', () => {
    expect(countLockedClick(0)).toBe(1);
    expect(countLockedClick(1000)).toBe(2);
    expect(countLockedClick(2000)).toBe(3);
    expect(countLockedClick(2000 + 5 * 60_000)).toBe(1);
  });
});
