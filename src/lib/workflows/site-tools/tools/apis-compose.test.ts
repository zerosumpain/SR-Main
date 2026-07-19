// Unit tests for composeApiUrl — the baseUrl + path/query joiner that powers the
// friendly `api-call` node. The result must always stay within the catalogued
// baseUrl (that containment is asserted downstream by urlIsWithinBase).
import { describe, it, expect } from 'vitest';
import { composeApiUrl, urlIsWithinBase } from './apis';

describe('composeApiUrl', () => {
  it('returns the baseUrl untouched for an empty path (no forced trailing slash)', () => {
    expect(composeApiUrl('https://api.example.com/v1', '')).toBe('https://api.example.com/v1');
    expect(composeApiUrl('https://api.example.com/v1', '  ')).toBe('https://api.example.com/v1');
  });

  it('resolves a relative path BELOW the base path (keeps the version segment)', () => {
    expect(composeApiUrl('https://api.example.com/v1', 'schools')).toBe(
      'https://api.example.com/v1/schools',
    );
    // A leading slash on the path must NOT jump to the host root.
    expect(composeApiUrl('https://api.example.com/v1', '/schools')).toBe(
      'https://api.example.com/v1/schools',
    );
    // A base that already ends in a slash behaves the same.
    expect(composeApiUrl('https://api.example.com/v1/', 'schools')).toBe(
      'https://api.example.com/v1/schools',
    );
  });

  it('keeps an inline query string in the path', () => {
    expect(composeApiUrl('https://api.example.com/v1', 'schools?limit=10')).toBe(
      'https://api.example.com/v1/schools?limit=10',
    );
  });

  it('appends query-object params (skipping blank/null values)', () => {
    const url = composeApiUrl('https://api.example.com/v1', 'schools', {
      limit: 10,
      page: 2,
      cursor: '',
      after: null,
    });
    const u = new URL(url);
    expect(u.pathname).toBe('/v1/schools');
    expect(u.searchParams.get('limit')).toBe('10');
    expect(u.searchParams.get('page')).toBe('2');
    expect(u.searchParams.has('cursor')).toBe(false);
    expect(u.searchParams.has('after')).toBe(false);
  });

  it('accepts an absolute path as-is (containment enforced separately)', () => {
    expect(composeApiUrl('https://api.example.com/v1', 'https://api.example.com/v1/x?a=1')).toBe(
      'https://api.example.com/v1/x?a=1',
    );
  });

  it('always produces a URL that stays within the catalogued base', () => {
    const base = 'https://api.example.com/v1';
    for (const p of ['schools', '/schools', 'schools?x=1', 'nested/deep/path']) {
      expect(urlIsWithinBase(composeApiUrl(base, p), base)).toBe(true);
    }
  });
});
