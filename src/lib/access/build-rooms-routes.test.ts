import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { requiredFor, routeIdsFor, type AreaId } from './catalogue';

// jkai · develop, codegraph and daydreams open the owner's build machinery to a
// member. Everything a load or handler returns reaches the browser, so a route
// is only safe to open when it branches on the owner check and redacts for
// everyone else ($lib/member-view) — or when it was reviewed and returns
// nothing personal. The showcase-routes.test ratchet, for these rooms.

const AREAS: AreaId[] = ['jkai.develop', 'jkai.codegraph', 'jkai.daydreams'];

/** Reviewed 2026-09-30: nothing personal or secret in what these return. */
const SAFE_AS_IS = new Set([
  '/jkai/codegraph', // no page load; its layout returns eight counts, the map comes from the two APIs below
  '/api/jkai/development/models', // the builder's model list and default
]);

const routes = AREAS.flatMap((a) => routeIdsFor(a));

function sourceOf(id: string): string {
  const base = `src/routes${id}`;
  for (const f of ['+page.server.ts', '+server.ts']) if (existsSync(`${base}/${f}`)) return readFileSync(`${base}/${f}`, 'utf8');
  throw new Error(`no server file for ${id}`);
}

describe('build-room routes', () => {
  it('each area opens something', () => {
    for (const a of AREAS) expect(routeIdsFor(a).length, a).toBeGreaterThan(0);
  });

  it.each(routes)('%s is GET-only', (id) => {
    for (const verb of ['POST', 'PUT', 'PATCH', 'DELETE']) expect(requiredFor(id, verb)).toBeNull();
    expect(requiredFor(id, 'GET')).not.toBeNull();
  });

  it.each(routes)('%s redacts on the owner check, or was reviewed as safe', (id) => {
    if (SAFE_AS_IS.has(id)) return;
    expect(sourceOf(id)).toMatch(/isOwnerRequest\(event\)/);
  });

  it('never opens the rooms that are personal, or show lesson text', () => {
    for (const id of [
      '/jkai/develop/[id]',
      '/api/jkai/development/[id]',
      '/jkai/codegraph/ask',
      '/jkai/codegraph/review',
      '/api/jkai/codegraph/query',
      '/api/jkai/codegraph/ingest',
      '/jkai/daydreams',
      '/jkai/daydreams/watches',
      '/jkai/daydreams/briefing',
      '/jkai/daydreams/briefing/[day]',
      '/jkai/activity',
      '/jkai/activity/[id]',
    ]) {
      expect(requiredFor(id, 'GET'), id).toBeNull();
    }
  });

  it('the backlog never grooms on a page view, for a member or the owner', () => {
    // `autoGroomBacklog` writes; it runs on the heartbeat (`backlog-grooming`).
    const src = sourceOf('/jkai/develop/backlog');
    expect(src.indexOf('readBacklogRoom()')).toBeGreaterThan(-1);
    expect(src).not.toContain('autoGroomBacklog');
  });
});
