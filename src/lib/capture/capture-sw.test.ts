import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// static/capture-sw.js is plain worker script, not a module; evaluate it with
// just enough of a worker global to read its two predicates back out.
function loadWorker() {
  const module = { exports: {} as Record<string, (r: unknown) => boolean> };
  const self = { addEventListener: () => {}, skipWaiting: () => {}, clients: { claim: () => {} } };
  runInNewContext(readFileSync('static/capture-sw.js', 'utf8'), { module, self, caches: {}, fetch: () => {}, URL });
  return module.exports;
}

const res = (status: number, redirected = false, url = 'https://site.test/capture', type = 'basic') =>
  ({ status, redirected, url, type });

describe('capture service worker', () => {
  const { isCacheable, isSignedOut } = loadWorker();

  it('caches only a direct 200 from this origin', () => {
    expect(isCacheable(res(200))).toBe(true);
    expect(isCacheable(res(200, true, 'https://site.test/login?callbackUrl=%2Fcapture'))).toBe(false);
    expect(isCacheable(res(500))).toBe(false);
    expect(isCacheable(res(401))).toBe(false);
    expect(isCacheable(res(200, false, 'https://cdn.test/x', 'opaque'))).toBe(false);
  });

  it('treats the gate turning the request away as signed out', () => {
    expect(isSignedOut(res(200, true, 'https://site.test/login?callbackUrl=%2Fcapture'))).toBe(true);
    expect(isSignedOut(res(401))).toBe(true);
    expect(isSignedOut(res(200))).toBe(false);
    expect(isSignedOut(res(503))).toBe(false);
  });
});
