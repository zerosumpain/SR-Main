/**
 * Grounding is a relaxation of a deliberate lockdown, so the tests are about
 * where the relaxation can and cannot be reached from, and about reading
 * Codex's `web_search` items correctly — a shape the SDK's own typings do not
 * describe.
 */
import { describe, it, expect } from 'vitest';
import { toCapturedSearch, toAnnotations } from './web-search';

describe('toCapturedSearch', () => {
  it('reads a query the model ran', () => {
    expect(
      toCapturedSearch({
        id: 'exec-1',
        type: 'web_search',
        query: 'site:nodejs.org latest release',
        action: { type: 'search', query: 'site:nodejs.org latest release' },
      }),
    ).toEqual({ kind: 'search', value: 'site:nodejs.org latest release' });
  });

  /**
   * The case the typings hide: for a fetch, Codex puts the URL in `query` and
   * sets `action.type` to something other than 'search'. Treating that as a
   * query would put a URL where the UI prints a search string, and would throw
   * away the only citations this path produces.
   */
  it('reads a fetched URL, which arrives in the query field', () => {
    expect(
      toCapturedSearch({
        id: 'exec-2',
        type: 'web_search',
        query: 'https://nodejs.org/dist/index.json',
        action: { type: 'other' },
      }),
    ).toEqual({ kind: 'fetch', value: 'https://nodejs.org/dist/index.json' });
  });

  it('decides on the value, not the action type, so a new action kind is not misfiled', () => {
    expect(
      toCapturedSearch({ id: 'x', type: 'web_search', query: 'https://a.test/p', action: { type: 'browse' } }),
    ).toEqual({ kind: 'fetch', value: 'https://a.test/p' });
    expect(toCapturedSearch({ id: 'x', type: 'web_search', query: 'plain words' })).toEqual({
      kind: 'search',
      value: 'plain words',
    });
  });

  it('ignores anything that is not a web_search item', () => {
    expect(toCapturedSearch({ id: 'm1', type: 'agent_message', text: 'hello' })).toBeNull();
    expect(toCapturedSearch({ id: 'r1', type: 'reasoning', text: 'thinking' })).toBeNull();
    expect(toCapturedSearch(null)).toBeNull();
    expect(toCapturedSearch(undefined)).toBeNull();
  });

  it('ignores an empty or whitespace query rather than producing a blank source', () => {
    expect(toCapturedSearch({ id: 'x', type: 'web_search', query: '   ' })).toBeNull();
    expect(toCapturedSearch({ id: 'x', type: 'web_search' })).toBeNull();
  });
});

describe('toAnnotations', () => {
  const searches = [
    { kind: 'search' as const, value: 'site:nodejs.org latest release' },
    { kind: 'fetch' as const, value: 'https://nodejs.org/dist/index.json' },
    { kind: 'fetch' as const, value: 'https://nodejs.org/en/blog/release/v26.7.0/' },
  ];

  it('cites only the pages, never the queries', () => {
    expect(toAnnotations(searches)).toEqual([
      { type: 'url_citation', url_citation: { url: 'https://nodejs.org/dist/index.json' } },
      { type: 'url_citation', url_citation: { url: 'https://nodejs.org/en/blog/release/v26.7.0/' } },
    ]);
  });

  it('matches OpenRouter’s annotation shape, so one renderer serves both providers', () => {
    const [first] = toAnnotations(searches);
    expect(Object.keys(first)).toEqual(['type', 'url_citation']);
    expect(first.type).toBe('url_citation');
  });

  it('is empty rather than undefined when nothing was consulted', () => {
    expect(toAnnotations(undefined)).toEqual([]);
    expect(toAnnotations([])).toEqual([]);
    expect(toAnnotations([{ kind: 'search', value: 'only a query' }])).toEqual([]);
  });
});
