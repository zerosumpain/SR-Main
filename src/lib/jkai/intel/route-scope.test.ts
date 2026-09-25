import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { memberRouteIds } from '$lib/auth';

/**
 * Every intel route resolves its scope — the PR B precondition.
 *
 * `scripts/check-intel-scope.mjs` finds files that NAME an intel table. A route
 * that reads only through a library function names none: it calls
 * `getGraphAnalysis()` or `searchIntel(q)`, the library's owner default fills
 * in the scope, and the guard never sees it. Once members exist that route
 * would hand the owner's graph to anyone who reached it. So this asserts the
 * route-level property directly: a route that imports the intel library must
 * say whose intel it reads, either through `resolveRequestScope` (a request a
 * member could make) or `OWNER_INTEL_SCOPE` (an owner-only surface, e.g. a
 * canvas that also runs unattended), rather than trusting the next person who
 * adds a route to remember.
 */

/** Trees whose every handler and page load is checked. */
const ROOTS = ['src/routes/api/jkai/intel', 'src/routes/jkai/intel', 'src/routes/api/canvas/[slug]/intel'];

/**
 * Routes OUTSIDE those trees that read intel through the library, found by
 * grepping `src/routes` for importers of intel readers (Task 12). Listed so a
 * refactor that drops their scope fails here too.
 */
const ELSEWHERE = [
  'src/routes/api/jkai/memory/+server.ts',
  'src/routes/api/workflows/orchestrator/chat/+server.ts',
  'src/routes/api/jkai/conversations/[id]/graph/+server.ts',
  'src/routes/api/research/[id]/network/+server.ts',
  'src/routes/jkai/+page.server.ts',
];

/**
 * Files that import the intel library but need no scope, each with the reason.
 * Keep this short: an entry is a claim a reviewer should be able to check.
 */
const ALLOWED: Record<string, string> = {
  'src/routes/api/research/[id]/network/+server.ts':
    "Runs the PURE analytics functions (model, centrality, community) over one research " +
    "session's own facts; it imports the intel library for the maths and reads no intel table.",
};

/** A route or page load reads intel if it imports the library or runs the analysis. */
const READS_INTEL = /from\s+'\$lib\/jkai\/intel|import\(\s*'\$lib\/jkai\/intel|\bgetGraphAnalysis\b/;
const SCOPED = /\bresolveRequestScope\b|\bOWNER_INTEL_SCOPE\b/;
const ENTRY = /^\+(server|page\.server|layout\.server)\.ts$/;

function entries(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(join(process.cwd(), dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(process.cwd(), rel)).isDirectory()) found.push(...entries(rel));
    else if (ENTRY.test(name)) found.push(rel);
  }
  return found;
}

describe('every intel route resolves its scope', () => {
  const files = [...ROOTS.flatMap((r) => entries(r)), ...ELSEWHERE].sort();
  const readers = files.filter((f) => READS_INTEL.test(readFileSync(f, 'utf8')));

  it('finds the routes at all', () => {
    // A traversal that silently found nothing would make the check below pass.
    expect(readers.length).toBeGreaterThan(40);
    for (const f of ELSEWHERE) expect(existsSync(f), f).toBe(true);
  });

  it('passes a scope from every route that reads intel', () => {
    const unscoped = readers.filter((f) => !(f in ALLOWED) && !SCOPED.test(readFileSync(f, 'utf8')));
    expect(unscoped).toEqual([]);
  });

  it('keeps the allow-list honest', () => {
    // An allow-listed file that now scopes itself, or no longer reads intel, is
    // a stale exemption: drop it so the list stays a list of real exceptions.
    for (const [f, reason] of Object.entries(ALLOWED)) {
      expect(reason.length, f).toBeGreaterThan(20);
      expect(readers, f).toContain(f);
      expect(SCOPED.test(readFileSync(f, 'utf8')), f).toBe(false);
    }
  });
});

/**
 * A member can reach these (isMemberAllowedRoute), so every one must read
 * through `resolveRequestScope` itself — `OWNER_INTEL_SCOPE` is not good enough
 * here, it is exactly what a member must never be handed. Stronger than the
 * rule above, which accepts either.
 *
 * Still a file-level check: members.integration.test.ts is what proves a member
 * session sees none of the owner's rows through these.
 */
describe('every route a member can reach resolves the request scope', () => {
  const intelRoutes = memberRouteIds().filter((id) => id.includes('/intel'));

  it('covers the intel member routes', () => {
    expect(intelRoutes.length).toBeGreaterThan(10);
  });

  it('calls resolveRequestScope in each route file, and never names the owner scope', () => {
    for (const id of intelRoutes) {
      const file = id.startsWith('/api/') ? `src/routes${id}/+server.ts` : `src/routes${id}/+page.server.ts`;
      expect(existsSync(file), `${id} has no server load to scope`).toBe(true);
      const source = readFileSync(file, 'utf8');
      expect(source, file).toMatch(/\bresolveRequestScope\b/);
      expect(source, file).not.toMatch(/\bOWNER_INTEL_SCOPE\b/);
    }
  });

  it('and the intel layout every page renders under does too', () => {
    expect(readFileSync('src/routes/jkai/intel/+layout.server.ts', 'utf8')).toMatch(/\bresolveRequestScope\b/);
  });
});
