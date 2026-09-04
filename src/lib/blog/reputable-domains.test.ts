import { describe, it, expect } from 'vitest';
import { hostnameOf, isReputable, isUkSource, rateSource, UK_BONUS, REPUTABLE_BONUS } from './reputable-domains';

describe('isUkSource', () => {
  it.each([
    'https://www.ons.gov.uk/economy/inflation',
    'https://bbc.co.uk/news/1',
    'https://www.theguardian.com/uk-news/x',
    'https://www.ft.com/content/abc',
    'https://www.bankofengland.co.uk/statistics',
    'https://www.legislation.gov.uk/ukpga/2018/12',
    'https://www.turing.ac.uk/research',
    'https://www.gov.scot/publications/x',
  ])('recognises %s', (url) => {
    expect(isUkSource(url)).toBe(true);
  });

  it.each([
    'https://www.washingtonpost.com/x',
    'https://www.cdc.gov/y',
    'https://www.nytimes.com/z',
    'https://ec.europa.eu/eurostat',
    'https://example.com/',
  ])('does not claim %s', (url) => {
    expect(isUkSource(url)).toBe(false);
  });

  it('is not fooled by a lookalike host', () => {
    // `.uk` must be a suffix of a LABEL, not a substring. A domain ending
    // "...uk" without the dot is somebody else's.
    expect(isUkSource('https://notuk.com/')).toBe(false);
    expect(isUkSource('https://www.gov.uk.evil.com/')).toBe(false);
  });

  it('returns false rather than throwing on a non-URL', () => {
    expect(isUkSource('not a url')).toBe(false);
    expect(hostnameOf('not a url')).toBe('');
  });
});

// The behaviour John asked for: given two sources that could both be cited,
// the British one wins. Given a reputable non-UK source against an unvetted UK
// one, reputation still wins — a preference, not an allow-list.
describe('rateSource ranking', () => {
  const score = (url: string, relevance: number) => relevance + rateSource(url).bonus;

  it('prefers a UK source over an equally relevant US one', () => {
    expect(score('https://www.ons.gov.uk/a', 0.8)).toBeGreaterThan(score('https://www.cdc.gov/a', 0.8));
  });

  it('still ranks a reputable non-UK source above an unvetted UK blog', () => {
    expect(score('https://www.reuters.com/a', 0.5)).toBeGreaterThan(score('https://someones-blog.uk/a', 0.5));
  });

  it('lets a clearly more relevant source win anyway', () => {
    // The bonus decides ties; it does not override the search engine. A US
    // source that is genuinely the better match for an American subject still
    // comes first, which is the point of ranking rather than filtering.
    expect(score('https://www.washingtonpost.com/a', 0.95)).toBeGreaterThan(score('https://www.bbc.co.uk/a', 0.4));
  });

  it('keeps the UK bonus smaller than the reputable one', () => {
    expect(UK_BONUS).toBeLessThan(REPUTABLE_BONUS);
  });

  it('reports both flags so the panel can explain the order', () => {
    expect(rateSource('https://www.ons.gov.uk/a')).toEqual({ reputable: true, uk: true, bonus: REPUTABLE_BONUS + UK_BONUS });
    expect(rateSource('https://www.cdc.gov/a')).toEqual({ reputable: true, uk: false, bonus: REPUTABLE_BONUS });
    expect(rateSource('https://someones-blog.uk/a')).toEqual({ reputable: false, uk: true, bonus: UK_BONUS });
    expect(rateSource('https://example.com/a')).toEqual({ reputable: false, uk: false, bonus: 0 });
  });

  it('leaves the reputable set unchanged', () => {
    expect(isReputable('https://www.nature.com/articles/x')).toBe(true);
    expect(isReputable('https://random-seo-farm.biz/x')).toBe(false);
  });
});
