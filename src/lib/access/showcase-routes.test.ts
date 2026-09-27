import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { catalogueRouteIds, requiredFor } from './catalogue';

// The admin showcase opens admin pages to a non-owner. Everything a load returns
// is serialised into __data.json, so a page is only safe to open when its LOAD
// strips what is personal or secret ($lib/server/showcase) — or when it was
// reviewed and returns nothing of the kind. This is the ratchet: an admin route
// in the catalogue must be one or the other, and never opened for a write.

/** Reviewed 2026-09-27: nothing personal or secret in the load's return. */
const SAFE_AS_IS = new Set([
  '/admin/content/voice', // voice card + already-public posts
  '/admin/connections/catalog', // provider list; env NAMES and booleans only
  '/admin/ai/keys', // which keys are configured (booleans) and where from
  '/admin/ai/model-routing', // assignments and aggregate stats
  '/admin/ai/approvals', // approval UI settings
  '/api/admin/models/openrouter', // OpenRouter's public model catalogue
]);

const adminRoutes = catalogueRouteIds().filter((id) => id === '/admin' || id.startsWith('/admin/') || id.startsWith('/api/admin/'));

function loadFile(id: string): string {
  const base = `src/routes${id}`;
  for (const f of ['+page.server.ts', '+server.ts']) if (existsSync(`${base}/${f}`)) return readFileSync(`${base}/${f}`, 'utf8');
  throw new Error(`no route file for ${id}`);
}

describe('admin showcase routes', () => {
  it('opens some pages', () => {
    expect(adminRoutes.length).toBeGreaterThan(5);
  });

  it.each(adminRoutes)('%s is GET-only', (id) => {
    for (const verb of ['POST', 'PUT', 'PATCH', 'DELETE']) expect(requiredFor(id, verb)).toBeNull();
    expect(requiredFor(id, 'GET')).toBe('admin:self');
  });

  it.each(adminRoutes)('%s redacts in its load, or was reviewed as safe', (id) => {
    if (SAFE_AS_IS.has(id)) return;
    expect(loadFile(id)).toMatch(/isShowcase\(event\)/);
  });

  it('never opens the owner-only tree', () => {
    for (const id of ['/admin/access', '/admin/access/security', '/admin/estate', '/admin/ops/costs', '/admin/ops/live',
      '/admin/connections', '/admin/connections/credentials', '/admin/ai/apis', '/admin/ai/datastore/[slug]', '/api/admin/access']) {
      expect(requiredFor(id, 'GET')).toBeNull();
    }
  });
});
