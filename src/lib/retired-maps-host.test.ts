import { describe, it, expect } from 'vitest';

// The mapping is duplicated here rather than exported from hooks.server.ts:
// importing that module pulls in Auth.js, the database and the whole workflow
// engine for the sake of one pure function. Keep the two in step — the table
// below is the contract.
function retiredMapsTarget(pathname: string): string {
  const path = pathname.replace(/\/+$/, '').toLowerCase();
  if (path === '/create' || path === '/discover') return '/trails/plan';
  if (path === '/record' || path.endsWith('/record')) return '/trails/record';
  if (path.startsWith('/route')) return '/trails/routes';
  if (path.startsWith('/history')) return '/trails';
  return '/trails';
}

describe('retired maps host redirect', () => {
  it.each([
    ['/', '/trails'],
    ['', '/trails'],
    ['/create', '/trails/plan'],
    ['/discover', '/trails/plan'],
    ['/record', '/trails/record'],
    ['/history', '/trails'],
    ['/history/abc-123', '/trails'],
    ['/settings', '/trails'],
    ['/anything-else', '/trails'],
  ])('sends %s to %s', (from, to) => {
    expect(retiredMapsTarget(from)).toBe(to);
  });

  it('sends a saved route to the routes list', () => {
    expect(retiredMapsTarget('/route/abc-123')).toBe('/trails/routes');
    expect(retiredMapsTarget('/route/abc-123/edit')).toBe('/trails/routes');
  });

  it('prefers the recorder for a route being recorded', () => {
    // JKAImaps nested this under the route; the recorder is the useful landing.
    expect(retiredMapsTarget('/route/abc-123/record')).toBe('/trails/record');
  });

  it('ignores a trailing slash and case', () => {
    expect(retiredMapsTarget('/Create/')).toBe('/trails/plan');
    expect(retiredMapsTarget('/RECORD')).toBe('/trails/record');
  });

  it('never returns a path outside /trails', () => {
    for (const p of ['/', '/create', '/route/x', '/history', '/zzz', '/../etc']) {
      expect(retiredMapsTarget(p).startsWith('/trails')).toBe(true);
    }
  });
});
