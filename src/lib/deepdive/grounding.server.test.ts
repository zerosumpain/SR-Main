/**
 * The two bits of `grounding.server` that decide what a reader sees in the
 * source list. Both exist because the first grounded runs produced a list of
 * six rows all labelled with the same host, which is no list at all.
 *
 * `resolveCitationUrl` and `recordCitations` are not covered here: they are
 * network and database respectively, and are verified by running a grounded
 * research run rather than by mocking both away.
 */
import { describe, it, expect } from 'vitest';
import { titleFromUrl, isHostLikeTitle } from './grounding.server';

describe('titleFromUrl', () => {
  it('turns a slug into something readable', () => {
    expect(titleFromUrl('https://nodejs.org/en/blog/release/v26.7.0')).toBe('Release v26.7.0');
    expect(titleFromUrl('https://www.herodevs.com/blog-posts/node-js-end-of-life-dates')).toBe(
      'Blog posts node js end of life dates',
    );
  });

  it('drops a file extension that is not part of the title', () => {
    expect(titleFromUrl('https://a.test/docs/getting-started.html')).toBe('Docs getting started');
    expect(titleFromUrl('https://a.test/reports/annual-review.pdf')).toBe('Reports annual review');
  });

  it('gives up on a bare host rather than inventing a title', () => {
    expect(titleFromUrl('https://nodejs.org')).toBeNull();
    expect(titleFromUrl('https://nodejs.org/')).toBeNull();
  });

  it('gives up on a path too short to mean anything', () => {
    expect(titleFromUrl('https://a.test/x')).toBeNull();
  });

  it('returns null for something that is not a URL, rather than throwing', () => {
    expect(titleFromUrl('not a url')).toBeNull();
    expect(titleFromUrl('')).toBeNull();
  });
});

describe('isHostLikeTitle', () => {
  it('rejects the exact domain', () => {
    expect(isHostLikeTitle('nodejs.org', 'nodejs.org')).toBe(true);
  });

  /** The case that shipped a list of rows all reading "python.org": the
   *  provider's title omits the `www.` the domain carries, so a plain
   *  inequality test called them different. */
  it('rejects the domain modulo www., which a plain comparison missed', () => {
    expect(isHostLikeTitle('python.org', 'www.python.org')).toBe(true);
    expect(isHostLikeTitle('www.python.org', 'python.org')).toBe(true);
  });

  it('rejects any bare hostname, even a different one', () => {
    expect(isHostLikeTitle('en.wikipedia.org', 'www.python.org')).toBe(true);
  });

  it('keeps a real headline', () => {
    expect(isHostLikeTitle('Node.js v26.7.0 released', 'nodejs.org')).toBe(false);
  });

  it('keeps a headline that happens to contain a domain', () => {
    expect(isHostLikeTitle('Why python.org moved to a new CDN', 'www.python.org')).toBe(false);
  });

  it('treats an empty title as no title', () => {
    expect(isHostLikeTitle('', 'a.test')).toBe(true);
    expect(isHostLikeTitle('   ', 'a.test')).toBe(true);
  });
});
