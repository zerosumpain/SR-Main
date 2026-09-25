import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { isPublicPath, isGuestAllowedPath, isMemberAllowedRoute, memberRouteIds } from './auth';

describe('isPublicPath', () => {
  it('allows known public pages and APIs', () => {
    for (const p of ['/', '/projects', '/projects/engine-room', '/blog', '/blog/x', '/api/landing/vitals', '/api/blog/images/9/x.png', '/jkai/shared', '/jkai/shared/tok_abc123', '/privacy', '/tos']) {
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

describe('isMemberAllowedRoute — a member reaches their own intel space and nothing else', () => {
  it('opens the read surfaces, by route id', () => {
    for (const id of [
      '/jkai/intel',
      '/jkai/intel/notes',
      '/jkai/intel/notes/[id]',
      '/jkai/intel/entities/[id]',
      '/jkai/intel/timeline',
      '/jkai/intel/mail',
      '/api/jkai/intel/network',
      '/api/jkai/intel/entity-card',
    ]) {
      expect(isMemberAllowedRoute(id, 'GET'), id).toBe(true);
    }
  });

  it('refuses a static sibling a pathname pattern would have let through', () => {
    // `/jkai/intel/notes/new` matches `/jkai/intel/notes/[id]` as a PATH; as a
    // route id it is its own route, and so is `entities/split`.
    expect(isMemberAllowedRoute('/jkai/intel/notes/new', 'GET')).toBe(false);
    expect(isMemberAllowedRoute('/api/jkai/intel/entities/split', 'GET')).toBe(false);
  });

  it('refuses the owner surfaces a member must never reach', () => {
    for (const id of [
      '/jkai',
      '/jkai/intel/search',
      '/api/jkai/knowledge/search',
      '/jkai/intel/review',
      '/jkai/intel/quality',
      '/jkai/intel/dossiers',
      '/api/jkai/intel/commission',
      '/api/jkai/intel/ingest',
      '/api/jkai/intel/insights',
      '/api/jkai/intel/clusters',
      '/api/jkai/intel/source-facets',
      '/api/jkai/intel/mail/rules',
      '/api/gmail/accounts',
      '/admin/access',
    ]) {
      expect(isMemberAllowedRoute(id, 'GET'), id).toBe(false);
    }
    expect(isMemberAllowedRoute(null, 'GET')).toBe(false);
  });

  it('is per verb: the read APIs are GET only, mail triage alone may POST', () => {
    expect(isMemberAllowedRoute('/api/jkai/intel/entities', 'POST')).toBe(false);
    expect(isMemberAllowedRoute('/api/jkai/intel/notes/[id]', 'DELETE')).toBe(false);
    expect(isMemberAllowedRoute('/api/jkai/intel/entities/[id]', 'PUT')).toBe(false);
    expect(isMemberAllowedRoute('/jkai/intel', 'POST')).toBe(false);
    expect(isMemberAllowedRoute('/api/jkai/intel/mail', 'POST')).toBe(true);
    expect(isMemberAllowedRoute('/api/jkai/intel/network', 'HEAD')).toBe(true);
  });

  it('lists only routes that exist', () => {
    for (const id of memberRouteIds()) {
      const file = id.startsWith('/api/') ? '+server.ts' : '+page.svelte';
      expect(existsSync(`src/routes${id}/${file}`), id).toBe(true);
    }
  });
});
