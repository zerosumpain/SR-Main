import { describe, it, expect } from 'vitest';
import { isPublicPath, isGuestAllowedPath } from './auth';

describe('isPublicPath', () => {
  it('allows known public pages and APIs', () => {
    for (const p of ['/', '/projects', '/projects/engine-room', '/blog', '/blog/x', '/api/landing/vitals', '/api/blog/images/9/x.png', '/jkai/shared', '/jkai/shared/tok_abc123']) {
      expect(isPublicPath(p)).toBe(true);
    }
  });

  it('does NOT treat authed surfaces as public', () => {
    for (const p of ['/releases', '/releases/', '/releases/__data.json', '/shipped', '/jkai', '/admin', '/admin/access', '/live', '/api/admin/access', '/api/jkai/chat', '/api/admin/blog/upload-image']) {
      expect(isPublicPath(p)).toBe(false);
    }
  });

  it('keeps the Mapbox token endpoint public, which is not a Main feature', () => {
    // SR-Health's shared activity pages draw a route for somebody with no
    // account, and their browser fetches `/api/maps/config` by absolute path —
    // which cloudflared sends HERE. #871 pruned it as part of Main's own map
    // code and every map on /health went dark. Nothing in either repository's
    // build could see the dependency, so it is pinned here instead.
    expect(isPublicPath('/api/maps/config')).toBe(true);
  });

  it("the '/' entry matches only the root, not every path", () => {
    expect(isPublicPath('/')).toBe(true);
    expect(isPublicPath('/jkai')).toBe(false);
  });
});

describe('isGuestAllowedPath — deny-by-default', () => {
  it('denies a guest every authed page and API by default', () => {
    for (const p of ['/jkai', '/jkai/develop', '/admin', '/admin/access', '/live', '/deepdive/abc', '/api/admin/access', '/api/jkai/chat', '/api/deepdive/x']) {
      expect(isGuestAllowedPath(p)).toBe(false);
    }
  });
});
