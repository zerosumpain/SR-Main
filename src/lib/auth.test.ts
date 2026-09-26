import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import {
  isPublicPath,
  isGuestAllowedPath,
  isMemberAllowedRoute,
  memberRouteIds,
} from './auth';
import { requiredFor, routeIdsFor } from './access/catalogue';

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
      '/jkai/canvas',
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

describe('family:circle — a Family Circle member reaches People and nothing else', () => {
  const circle = (id: string | null | undefined, m = 'GET') => requiredFor(id, m) === 'family:circle';

  it('opens /home/people and one person under it, GET and HEAD only', () => {
    expect(circle('/home/people')).toBe(true);
    expect(circle('/home/people/[subject]')).toBe(true);
    expect(circle('/home/people', 'HEAD')).toBe(true);
    expect(circle('/home/people', 'get')).toBe(true);
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(requiredFor('/home/people', m), m).toBeNull();
      expect(requiredFor('/home/people/[subject]', m), m).toBeNull();
    }
  });

  it("opens none of /home's other rooms, the owner's surfaces or intel to the circle", () => {
    for (const id of [
      '/home',
      '/home/voice',
      '/home/echoes',
      '/home/devices',
      '/home/people/[subject]/edit',
      '/jkai',
      '/jkai/intel',
      '/admin',
      '/admin/access',
      '/health/activities',
      '/api/home/people',
    ]) {
      expect(circle(id), id).toBe(false);
    }
    expect(circle(null)).toBe(false);
    expect(circle(undefined)).toBe(false);
  });

  it('matches route ids, not pathnames', () => {
    // A concrete path is not a route id: `/home/people/sam` only ever reaches
    // the gate as `/home/people/[subject]`.
    expect(requiredFor('/home/people/sam', 'GET')).toBeNull();
  });

  it('is kept apart from intel', () => {
    for (const id of routeIdsFor('family:circle')) expect(requiredFor(id, 'GET'), id).not.toMatch(/^jkai/);
    for (const id of memberRouteIds()) expect(circle(id), id).toBe(false);
  });

  it('opens none of it to guests or the public', () => {
    for (const p of ['/home/people', '/home/people/sam']) {
      expect(isPublicPath(p), p).toBe(false);
      expect(isGuestAllowedPath(p), p).toBe(false);
    }
  });

  it('lists only routes that exist', () => {
    // The pages, plus one API: "Your day", keyed on the session alone.
    expect(routeIdsFor('family:circle').sort()).toEqual([
      '/api/home/people/my-day',
      '/home/people',
      '/home/people/[subject]',
    ]);
    for (const id of routeIdsFor('family:circle')) {
      if (id.startsWith('/api/')) {
        expect(existsSync(`src/routes${id}/+server.ts`), id).toBe(true);
        continue;
      }
      expect(existsSync(`src/routes${id}/+page.svelte`), id).toBe(true);
      expect(existsSync(`src/routes${id}/+page.server.ts`), id).toBe(true);
    }
  });
});
