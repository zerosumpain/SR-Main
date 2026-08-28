import { describe, it, expect } from 'vitest';
import { requestHost } from './request-host';

describe('requestHost', () => {
  const event = (host: string | null, url = 'https://strangeramblings.com/create') => ({
    request: new Request(url, host ? { headers: { host } } : undefined),
    url: new URL(url),
  });

  it('reads the header, not the URL — the bug this exists for', () => {
    // Production sets ORIGIN, so event.url is ALWAYS the canonical host.
    // Testing against url.hostname is what let the redirect ship doing nothing.
    expect(requestHost(event('maps.strangeramblings.com'))).toBe('maps.strangeramblings.com');
  });

  it('falls back to the URL when there is no Host header', () => {
    const e = event(null);
    e.request.headers.delete('host');
    expect(requestHost(e)).toBe('strangeramblings.com');
  });

  it('strips a port', () => {
    expect(requestHost(event('maps.strangeramblings.com:443'))).toBe('maps.strangeramblings.com');
  });

  it('lowercases', () => {
    expect(requestHost(event('MAPS.StrangeRamblings.com'))).toBe('maps.strangeramblings.com');
  });

  it('leaves the canonical host alone', () => {
    expect(requestHost(event('strangeramblings.com'))).toBe('strangeramblings.com');
  });
});

// The mapping is duplicated here rather than exported from hooks.server.ts:
// importing that module pulls in Auth.js, the database and the whole workflow
// engine for the sake of one pure function. Keep the two in step — the table
// below is the contract.
function retiredMapsTarget(pathname: string): string {
  const path = pathname.replace(/\/+$/, '').toLowerCase();
  if (path === '/create' || path === '/discover') return '/health/plan';
  if (path === '/record' || path.endsWith('/record')) return '/health/record';
  if (path.startsWith('/route')) return '/health/routes';
  if (path.startsWith('/history')) return '/health/activities';
  return '/health/activities';
}

describe('retired maps host redirect', () => {
  it.each([
    ['/', '/health/activities'],
    ['', '/health/activities'],
    ['/create', '/health/plan'],
    ['/discover', '/health/plan'],
    ['/record', '/health/record'],
    ['/history', '/health/activities'],
    ['/history/abc-123', '/health/activities'],
    ['/settings', '/health/activities'],
    ['/anything-else', '/health/activities'],
  ])('sends %s to %s', (from, to) => {
    expect(retiredMapsTarget(from)).toBe(to);
  });

  it('sends a saved route to the routes list', () => {
    expect(retiredMapsTarget('/route/abc-123')).toBe('/health/routes');
    expect(retiredMapsTarget('/route/abc-123/edit')).toBe('/health/routes');
  });

  it('prefers the recorder for a route being recorded', () => {
    // JKAImaps nested this under the route; the recorder is the useful landing.
    expect(retiredMapsTarget('/route/abc-123/record')).toBe('/health/record');
  });

  it('ignores a trailing slash and case', () => {
    expect(retiredMapsTarget('/Create/')).toBe('/health/plan');
    expect(retiredMapsTarget('/RECORD')).toBe('/health/record');
  });

  it('never returns a path outside the /health hub', () => {
    for (const p of ['/', '/create', '/route/x', '/history', '/zzz', '/../etc']) {
      expect(retiredMapsTarget(p).startsWith('/health/')).toBe(true);
    }
  });
});
