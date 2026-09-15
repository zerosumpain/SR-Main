import { describe, it, expect } from 'vitest';
import { canonicalUrl } from './canonical';

describe('canonicalUrl', () => {
  it('drops the scheme so http and https are one article', () => {
    expect(canonicalUrl('http://example.com/a')).toBe(canonicalUrl('https://example.com/a'));
  });

  it('drops www and lowercases the host', () => {
    expect(canonicalUrl('https://WWW.Example.COM/Path')).toBe('example.com/Path');
  });

  it('keeps the path case — a path is case significant', () => {
    expect(canonicalUrl('https://example.com/Foo')).not.toBe(canonicalUrl('https://example.com/foo'));
  });

  it('strips the fragment', () => {
    expect(canonicalUrl('https://example.com/a#comments')).toBe('example.com/a');
  });

  it('strips a trailing slash but keeps the root', () => {
    expect(canonicalUrl('https://example.com/a/')).toBe('example.com/a');
    expect(canonicalUrl('https://example.com/')).toBe('example.com/');
  });

  it('strips utm and the known click identifiers', () => {
    expect(canonicalUrl('https://example.com/a?utm_source=hn&utm_medium=social')).toBe('example.com/a');
    expect(canonicalUrl('https://example.com/a?fbclid=xyz&gclid=abc&ref=lobsters')).toBe('example.com/a');
  });

  it('keeps parameters that identify the article, sorted', () => {
    expect(canonicalUrl('https://example.com/view?page=2&id=7&utm_source=hn')).toBe(
      'example.com/view?id=7&page=2',
    );
  });

  // The failure that matters: a parameter wrongly stripped MERGES two different
  // stories into one row, which is worse than leaving a duplicate on the desk.
  it('does not strip ambiguous single-letter parameters', () => {
    expect(canonicalUrl('https://example.com/search?s=rust')).toBe('example.com/search?s=rust');
    expect(canonicalUrl('https://example.com/?p=1234')).toBe('example.com/?p=1234');
  });

  it('returns a non-http input untouched rather than throwing', () => {
    expect(canonicalUrl('not a url')).toBe('not a url');
    expect(canonicalUrl('mailto:someone@example.com')).toBe('mailto:someone@example.com');
  });

  it('gives each Hacker News self-post its own key', () => {
    expect(canonicalUrl('https://news.ycombinator.com/item?id=1')).not.toBe(
      canonicalUrl('https://news.ycombinator.com/item?id=2'),
    );
  });
});
