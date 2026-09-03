/**
 * "It must have a common way of going back to the parent page."
 *
 * A back link that 404s is worse than no back link, so this walks the REAL
 * route tree and asserts that the parent `site-nav` computes for every page is
 * a route that actually exists.
 *
 * It is here because the naive version of `parentHref` — chop the last path
 * segment — was wrong for twenty routes. `/admin/ops/costs` chopped to
 * `/admin/ops`, which is a directory with no `+page` in it; so did
 * `/blog/tag/[tag]`, `/jkai/trace/[traceId]` and `/news/[source]/[id]`. Every
 * one of those back links pointed at a 404, and nothing would have caught it
 * before someone clicked one.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parentHref, wearsSharedChrome } from '../../../src/lib/nav/site-nav';

const ROUTES = resolve(__dirname, '../../../src/routes');

function walk(dir: string, match: RegExp, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, match, out);
    else if (match.test(entry)) out.push(full);
  }
  return out;
}

function routeOf(file: string): string {
  const rel = file
    .slice(ROUTES.length + 1)
    .replace(/\/?\+page(@[^.]*)?\.svelte$/, '')
    .replace(/\/?\+page\.server\.ts$/, '');
  return '/' + rel.split('/').filter((s) => s && !/^\(.*\)$/.test(s)).join('/');
}

/** Every addressable page, including the redirect stubs that only have a load. */
const ROUTE_SET = new Set<string>([
  ...walk(ROUTES, /^\+page(@[^.]*)?\.svelte$/).map(routeOf),
  ...walk(ROUTES, /^\+page\.server\.ts$/).map(routeOf),
]);

describe('every back link points at a page that exists', () => {
  it('found the route tree', () => {
    expect(ROUTE_SET.size).toBeGreaterThan(150);
  });

  it('resolves the parent of every page that wears the bar', () => {
    const broken: string[] = [];
    for (const route of [...ROUTE_SET].sort()) {
      if (!wearsSharedChrome(route)) continue;
      const parent = parentHref(route);
      if (parent === null || parent === '/') continue;
      if (!ROUTE_SET.has(parent)) broken.push(`${route} -> ${parent}`);
    }
    expect(
      broken,
      `these back links point at a route that does not exist:\n  ${broken.join('\n  ')}`,
    ).toEqual([]);
  });

  it('never walks up into a page that has no way out', () => {
    // The deck editor sits under the deck PLAYER, which is carved out of shared
    // chrome — full-viewport, no bar. Walking up into it would strand the
    // reader with only the browser's back button.
    expect(parentHref('/decks/my-deck/edit')).toBe('/decks');
    for (const route of ROUTE_SET) {
      const parent = parentHref(route);
      if (parent === null || parent === '/') continue;
      expect(
        wearsSharedChrome(parent),
        `${route} walks up into ${parent}, which has no nav bar to leave by`,
      ).toBe(true);
    }
  });

  it('never lets a page be its own parent', () => {
    for (const route of ROUTE_SET) {
      expect(parentHref(route), `${route} is its own parent`).not.toBe(route);
    }
  });

  it('terminates — no path walks up forever', () => {
    for (const route of ROUTE_SET) {
      let cur: string | null = route;
      const seen = new Set<string>();
      let hops = 0;
      while (cur && hops++ < 20) {
        if (seen.has(cur)) throw new Error(`cycle in parent chain from ${route} at ${cur}`);
        seen.add(cur);
        cur = parentHref(cur);
      }
      expect(hops, `${route} took ${hops} hops to reach the top`).toBeLessThan(20);
    }
  });
});
