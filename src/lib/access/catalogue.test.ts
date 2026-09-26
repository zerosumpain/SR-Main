import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EXTRACTED_ROUTE_IDS } from './extracted-route-ids';
import {
  AREAS,
  AREA_IDS,
  BUILT_IN_GROUPS,
  catalogueRouteIds,
  isPermission,
  levelOf,
  parsePermissions,
  requiredFor,
  routeIdsFor,
  satisfies,
  type Permission,
} from './catalogue';

describe('permissions are the ones the code defines', () => {
  it('accepts area:level and the two family permissions', () => {
    for (const p of ['news:self', 'jkai.intel:all', 'jkai.knowledge:admin', 'family:circle', 'family:admin']) {
      expect(isPermission(p), p).toBe(true);
    }
  });

  it('refuses anything else — a string in a row grants nothing unless code defines it', () => {
    for (const p of ['news', 'news:owner', 'jkai:self', 'jkai.canvas:self', 'family:all', 'owner', '', ':self', 'news:self ', 42, null]) {
      expect(isPermission(p), String(p)).toBe(false);
    }
  });

  it('parses a stored list: junk dropped, duplicates collapsed, order kept', () => {
    expect(parsePermissions(['research:all', 'bogus', 'research:all', 'family:circle', 7])).toEqual([
      'research:all',
      'family:circle',
    ]);
    expect(parsePermissions(null)).toEqual([]);
  });
});

describe('levels are ordered and never cross areas', () => {
  const has = (...g: Permission[]) => g;

  it('a higher level satisfies a lower one', () => {
    expect(satisfies(has('jkai.intel:all'), 'jkai.intel:self')).toBe(true);
    expect(satisfies(has('research:admin'), 'research:all')).toBe(true);
    expect(satisfies(has('research:self'), 'research:self')).toBe(true);
  });

  it('a lower level does not satisfy a higher one', () => {
    expect(satisfies(has('jkai.intel:self'), 'jkai.intel:all')).toBe(false);
    expect(satisfies(has('research:all'), 'research:admin')).toBe(false);
  });

  it('never across areas — jkai.intel is not jkai.notes', () => {
    expect(satisfies(has('jkai.intel:admin'), 'jkai.notes:self')).toBe(false);
    expect(satisfies(has('news:admin'), 'research:self')).toBe(false);
  });

  it('family permissions satisfy only themselves', () => {
    expect(satisfies(has('family:admin'), 'family:circle')).toBe(false);
    expect(satisfies(has('family:circle'), 'family:circle')).toBe(true);
    expect(satisfies(has('family:circle'), 'home:self')).toBe(false);
  });

  it('levelOf reports the highest held', () => {
    expect(levelOf(has('research:self', 'research:admin', 'news:all'), 'research')).toBe('admin');
    expect(levelOf(has('family:circle'), 'home')).toBeNull();
  });
});

describe('the route map', () => {
  it('names a permission per verb, with HEAD following GET', () => {
    expect(requiredFor('/jkai/intel', 'GET')).toBe('jkai.intel:self');
    expect(requiredFor('/api/jkai/intel/network', 'HEAD')).toBe('jkai.intel:self');
    expect(requiredFor('/api/jkai/intel/mail', 'POST')).toBe('jkai.intel:self');
    expect(requiredFor('/api/jkai/intel/entities', 'POST')).toBeNull();
    expect(requiredFor('/jkai/intel', 'post')).toBeNull();
  });

  it('closes every route it does not name', () => {
    expect(requiredFor(null, 'GET')).toBeNull();
    expect(requiredFor('/jkai/canvas', 'GET')).toBeNull();
    expect(requiredFor('/admin/access', 'GET')).toBeNull();
    expect(requiredFor('/jkai/intel/notes/new', 'GET')).toBeNull();
  });

  it('opens routes only for areas that are open', () => {
    const closed = AREAS.filter((a) => !a.open).map((a) => a.id);
    for (const area of closed) expect(routeIdsFor(area), area).toEqual([]);
    expect(routeIdsFor('jkai.intel').length).toBeGreaterThan(10);
  });

  it('lists only routes that exist', () => {
    const missingFromMain: string[] = [];
    for (const id of catalogueRouteIds()) {
      const file = id.startsWith('/api/') ? '+server.ts' : '+page.svelte';
      if (!existsSync(`src/routes${id}/${file}`)) missingFromMain.push(id);
    }
    expect(missingFromMain.sort()).toEqual([...EXTRACTED_ROUTE_IDS].sort());
  });
});

describe('the catalogue itself', () => {
  it('describes every area once', () => {
    expect(AREAS.map((a) => a.id).sort()).toEqual([...AREA_IDS].sort());
  });

  it('seeds Family Circle and Family Admin, admin holding the circle too', () => {
    const byId = Object.fromEntries(BUILT_IN_GROUPS.map((g) => [g.id, g.grants]));
    expect(byId['family-circle']).toEqual(['family:circle']);
    expect(byId['family-admin']).toEqual(['family:circle', 'family:admin']);
    for (const g of BUILT_IN_GROUPS) expect(parsePermissions(g.grants)).toEqual([...g.grants]);
  });
});

describe('reachablePages — what the nav offers a member', () => {
  it('lists the pages their grants open, never an API or a [param] route', async () => {
    const { reachablePages } = await import('./catalogue');
    const pages = reachablePages(['research:self', 'family:circle']);
    expect(pages).toContain('/research');
    expect(pages).toContain('/home/people');
    expect(pages.some((p) => p.startsWith('/api/') || p.includes('['))).toBe(false);
    expect(pages).not.toContain('/news');
  });

  it('respects levels: home:self does not reach the voice log', async () => {
    const { reachablePages } = await import('./catalogue');
    expect(reachablePages(['home:self'])).toEqual(['/home', '/home/devices']);
    expect(reachablePages(['home:all'])).toEqual(['/home', '/home/devices', '/home/echoes', '/home/voice']);
  });

  it("offers another application's page, but never names it as a route here", async () => {
    const { reachablePages, EXTERNAL_PAGES } = await import('./catalogue');
    expect(EXTERNAL_PAGES['/drive']).toBe('drive:self');
    expect(reachablePages(['drive:self'])).toContain('/drive');
    expect(reachablePages(['drive:admin'])).toContain('/drive');
    expect(reachablePages(['research:self'])).not.toContain('/drive');
    expect(catalogueRouteIds()).not.toContain('/drive');
    expect(requiredFor('/drive', 'GET')).toBeNull();
  });
});

describe('"Your day" — the one family:circle API', () => {
  it('opens GET to family:circle and no other verb', () => {
    expect(requiredFor('/api/home/people/my-day', 'GET')).toBe('family:circle');
    expect(requiredFor('/api/home/people/my-day', 'HEAD')).toBe('family:circle');
    expect(requiredFor('/api/home/people/my-day', 'POST')).toBeNull();
    expect(requiredFor('/api/home/people/my-day', 'DELETE')).toBeNull();
    expect(routeIdsFor('family:circle')).toContain('/api/home/people/my-day');
  });

  it('the route exists in this repository', () => {
    expect(existsSync('src/routes/api/home/people/my-day/+server.ts')).toBe(true);
  });
});
