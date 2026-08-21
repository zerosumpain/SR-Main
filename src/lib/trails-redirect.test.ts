import { describe, it, expect } from 'vitest';

// A VERBATIM copy of trailsRedirectTarget from src/hooks.server.ts — importing
// that module pulls in Auth.js, the database and the whole workflow engine for
// the sake of one pure function, the same reason retired-maps-host.test.ts
// carries its own copy. Keep the two in step; the table below is the contract.
function trailsRedirectTarget(pathname: string): string | null {
  if (pathname !== '/trails' && !pathname.startsWith('/trails/')) return null;
  const rest = pathname.slice('/trails'.length).replace(/^\//, '').replace(/\/+$/, '');
  if (!rest) return '/health/activities';
  const [head, ...tail] = rest.split('/');
  if (head === 'dashboard') return '/health';
  if (head === 'segments' || head === 'plan' || head === 'routes' || head === 'record') {
    return ['/health', head, ...tail].join('/');
  }
  return ['/health/activities', head, ...tail].join('/');
}

describe('trails → health redirects', () => {
  it.each([
    ['/trails', '/health/activities'],
    ['/trails/', '/health/activities'],
    ['/trails/dashboard', '/health'],
    ['/trails/segments', '/health/segments'],
    ['/trails/segments/42', '/health/segments/42'],
    ['/trails/plan', '/health/plan'],
    ['/trails/routes', '/health/routes'],
    ['/trails/routes/abc-123', '/health/routes/abc-123'],
    ['/trails/record', '/health/record'],
  ])('%s → %s', (from, to) => {
    expect(trailsRedirectTarget(from)).toBe(to);
  });

  it('treats anything else under /trails as an activity id', () => {
    expect(trailsRedirectTarget('/trails/apple:ABC-123')).toBe('/health/activities/apple:ABC-123');
  });

  it('leaves every other path alone', () => {
    // /projects/engine-room/reach/trails is a PUBLIC field study about trails,
    // and a prefix match that swallowed it would 308 a live public page into an
    // owner-gated one.
    for (const p of [
      '/',
      '/health',
      '/health/activities',
      '/projects/engine-room/reach/trails',
      '/trailsomething',
    ]) {
      expect(trailsRedirectTarget(p)).toBeNull();
    }
  });
});
