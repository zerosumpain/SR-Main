// Regression tests for the api_call host-pinning check (urlIsWithinBase).
// A raw string prefix (the previous `url.startsWith(baseUrl)`) let an attacker
// route a catalogued API's injected auth secret to their own host; these lock
// the parsed-origin comparison in place.

import { describe, it, expect, vi } from 'vitest';

// apis.ts self-registers tools and imports $lib/datastore on load — stub the
// datastore so importing the pure helper has no side effects.
vi.mock('$lib/datastore', () => ({
  DatastoreError: class DatastoreError extends Error { code = 'x'; },
  getRecordByKey: vi.fn(),
  queryRecords: vi.fn(),
  updateRecord: vi.fn(),
  upsertRecord: vi.fn(),
}));

import { urlIsWithinBase } from './apis';

describe('urlIsWithinBase — SSRF/exfiltration defence', () => {
  const base = 'https://api.example.com/v1';

  it('accepts URLs on the same origin at or below the base path', () => {
    expect(urlIsWithinBase('https://api.example.com/v1', base)).toBe(true);
    expect(urlIsWithinBase('https://api.example.com/v1/schools?x=1', base)).toBe(true);
  });

  it('rejects an attacker subdomain that merely has the base as a prefix', () => {
    expect(urlIsWithinBase('https://api.example.com.attacker.net/v1/x', base)).toBe(false);
  });

  it('rejects userinfo smuggling (@) that points at another host', () => {
    expect(urlIsWithinBase('https://api.example.com/v1@attacker.net/', base)).toBe(false);
    expect(urlIsWithinBase('https://api.example.com@attacker.net/v1', base)).toBe(false);
  });

  it('rejects a different scheme or port even on the same host', () => {
    expect(urlIsWithinBase('http://api.example.com/v1', base)).toBe(false);
    expect(urlIsWithinBase('https://api.example.com:8443/v1', base)).toBe(false);
  });

  it('rejects a sibling path outside the base path', () => {
    expect(urlIsWithinBase('https://api.example.com/v2/x', base)).toBe(false);
    expect(urlIsWithinBase('https://api.example.com/v1x', base)).toBe(false);
  });

  it('rejects malformed URLs', () => {
    expect(urlIsWithinBase('not a url', base)).toBe(false);
    expect(urlIsWithinBase('https://api.example.com/v1', 'not a url')).toBe(false);
  });
});
