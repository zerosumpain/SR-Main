import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { routeIdsFor, type AreaId } from './catalogue';

/**
 * Every route the catalogue opens to members calls its area's guard.
 *
 * The hook deciding a member may REACH a route says nothing about which rows
 * come back. Each area has one seam that does, and a route file that reads the
 * area without calling it would hand whatever it reads to anyone the hook let
 * in. Intel and research have their own, stricter tests (route-scope.test,
 * route-access.test); this covers the areas that share `areaAccess`.
 */
const GUARDS: Partial<Record<AreaId, RegExp>> = {
  'jkai.notes': /\b(notesAccess|requireNote|requireRecording)\b/,
  home: /\bareaAccess\(\s*event,\s*'home'\s*\)/,
  news: /\bnewsCapabilities\b|\bnewsOwnerKey\b/,
  'jkai.knowledge': /\bareaAccess\(\s*event,\s*'jkai\.knowledge'\s*\)/,
};

/**
 * Pages with no server load of their own read nothing themselves; the layout
 * above them does, and must resolve scope. Each is listed with that layout.
 */
const LAYOUT_SCOPED: Record<string, string> = {
  '/jkai/intel/search': 'src/routes/jkai/intel/+layout.server.ts',
};

function fileFor(routeId: string): string {
  const dir = `src/routes${routeId}`;
  if (existsSync(`${dir}/+server.ts`)) return `${dir}/+server.ts`;
  if (existsSync(`${dir}/+page.server.ts`)) return `${dir}/+page.server.ts`;
  return LAYOUT_SCOPED[routeId] ?? `${dir}/+page.server.ts`;
}

describe('each open area guards every route it opens', () => {
  for (const [area, guard] of Object.entries(GUARDS)) {
    it(area, () => {
      const ids = routeIdsFor(area as AreaId);
      expect(ids.length, `${area} opens no routes`).toBeGreaterThan(0);
      const unguarded = ids.filter((id) => {
        const file = fileFor(id);
        const text = readFileSync(file, 'utf8');
        return id in LAYOUT_SCOPED ? !/\bresolveRequestScope\b/.test(text) : !guard.test(text);
      });
      expect(unguarded).toEqual([]);
    });
  }
});
