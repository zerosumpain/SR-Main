import { describe, expect, it } from 'vitest';
import { parseNewsView, parseNewsSort, rankForYou } from './desk';

/**
 * The desk's URL contract, pinned.
 *
 * These three functions moved out of `/news/+page.server.ts` when the iPhone
 * became a second reader of the desk. They were inline ternaries before, so
 * nothing asserted them; now two surfaces depend on them agreeing, and a drift
 * here silently changes what both show.
 */
describe('URL contract', () => {
  it('defaults and accepts every view', () => {
    expect(parseNewsView(null)).toBe('top');
    expect(parseNewsView('nonsense')).toBe('top');
    for (const v of ['new','best','for-you','favourites']) expect(parseNewsView(v)).toBe(v);
  });
  it('defaults sort to heat for best and time otherwise', () => {
    expect(parseNewsSort(null, 'best')).toBe('heat');
    expect(parseNewsSort(null, 'top')).toBe('time');
    expect(parseNewsSort(null, 'favourites')).toBe('time');
    for (const s of ['points','time','heat']) expect(parseNewsSort(s, 'top')).toBe(s);
    expect(parseNewsSort('junk', 'best')).toBe('heat');
  });
  it('ranks correlated first, keeps the rest, never filters', () => {
    const s = (key: string, heat: number) => ({ key, heat } as any);
    const stories = [s('a', 0.1), s('b', 0.9), s('c', 0.5)];
    const out = rankForYou(stories, { c: { score: 9, names: [], why: '', evidence: null } });
    expect(out.map((x) => x.key)).toEqual(['c', 'b', 'a']);
    expect(out).toHaveLength(3);
  });
});
