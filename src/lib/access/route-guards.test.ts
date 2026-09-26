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
};

function fileFor(routeId: string): string {
  const dir = `src/routes${routeId}`;
  return existsSync(`${dir}/+server.ts`) ? `${dir}/+server.ts` : `${dir}/+page.server.ts`;
}

describe('each open area guards every route it opens', () => {
  for (const [area, guard] of Object.entries(GUARDS)) {
    it(area, () => {
      const ids = routeIdsFor(area as AreaId);
      expect(ids.length, `${area} opens no routes`).toBeGreaterThan(0);
      const unguarded = ids.filter((id) => !guard.test(readFileSync(fileFor(id), 'utf8')));
      expect(unguarded).toEqual([]);
    });
  }
});
