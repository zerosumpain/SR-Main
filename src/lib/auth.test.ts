import { describe, it, expect } from 'vitest';
import { isPublicPath, isGuestAllowedPath } from './auth';

describe('isPublicPath', () => {
  it('allows known public pages and APIs', () => {
    for (const p of ['/', '/projects', '/projects/broads-pilot', '/blog', '/blog/x', '/api/landing/vitals', '/api/space-lander/scores']) {
      expect(isPublicPath(p)).toBe(true);
    }
  });

  it('does NOT treat authed surfaces as public', () => {
    for (const p of ['/jkai', '/admin', '/admin/access', '/live', '/api/admin/access', '/api/jkai/chat']) {
      expect(isPublicPath(p)).toBe(false);
    }
  });

  it("the '/' entry matches only the root, not every path", () => {
    expect(isPublicPath('/')).toBe(true);
    expect(isPublicPath('/jkai')).toBe(false);
  });
});

describe('isGuestAllowedPath — deny-by-default', () => {
  it('denies a guest every authed page and API by default', () => {
    for (const p of ['/jkai', '/jkai/builds', '/admin', '/admin/access', '/live', '/deepdive/abc', '/api/admin/access', '/api/jkai/chat', '/api/deepdive/x']) {
      expect(isGuestAllowedPath(p)).toBe(false);
    }
  });
});
