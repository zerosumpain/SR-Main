/**
 * The engine-room tour is the only place outside `admin-nav.ts` that hard-codes
 * admin URLs — and it is a PUBLIC page.
 *
 * Nothing 404s when one of them dies, which is worse than if it did: the tour
 * treats routes as provenance rather than links, so the public study goes on
 * naming a path that no longer exists, and the next screenshot capture navigates
 * into a 308 and shoots the wrong page under the old caption. Silent, and
 * visible to strangers.
 *
 * So: every route the tour cites must resolve to a real page — directly, or
 * after `resolveAdminRedirect` — and the capture script must visit the same
 * paths, or the screenshots drift from the captions they sit under.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SURFACES } from './tour';
import { resolveAdminRedirect } from '$lib/components/admin/admin-nav';
import registry from '$lib/estate/registry/apps.generated.json';

const ROOT = process.cwd();

/** Routes written to illustrate a shape rather than to be visited. */
const ILLUSTRATIVE = /[<\[]/;

/**
 * The extracted application that serves this path, if any.
 *
 * /drive, /health and /projects/policy-analysis are live pages with NO
 * +page.svelte in this repository, because cloudflared routes them to another
 * application entirely. Before the app registry was vendored there was no way to
 * ask that question from here, and a check like this one would have had to
 * hard-code its exceptions — which is exactly how such a list goes stale.
 */
function servedElsewhere(route: string): string | null {
  const hit = registry.apps
    .filter((a) => a.key !== 'main')
    .find((a) => (a.paths as string[]).some((p) => route === p || route.startsWith(`${p}/`)));
  return hit ? hit.key : null;
}

/** A route exists if the page file it resolves to exists. Checked on disk rather
 *  than against the Vite route manifest, which is not built under vitest. */
function pageFileFor(route: string): { resolved: string; file: string } {
  const resolved = resolveAdminRedirect(route) ?? route;
  const rel = resolved.replace(/^\//, '').split('?')[0];
  return { resolved, file: join(ROOT, 'src/routes', rel, '+page.svelte') };
}

describe('engine-room tour routes', () => {
  for (const surface of SURFACES) {
    it(`"${surface.label}" points at a page that exists (${surface.route})`, () => {
      if (ILLUSTRATIVE.test(surface.route)) return; // a shape, not an address
      const owner = servedElsewhere(surface.route);
      if (owner) return; // cloudflared routes it to another application

      const { resolved, file } = pageFileFor(surface.route);
      expect(
        existsSync(file),
        `${surface.route} resolves to ${resolved}, which has no +page.svelte here and no ` +
          'extracted application claims it. This is a PUBLIC page naming a path — move the tour ' +
          'in the same commit as the route.',
      ).toBe(true);
    });
  }

  it('the capture script visits every admin path the tour cites', () => {
    const script = readFileSync(join(ROOT, 'scripts/capture-engine-room-tour.ts'), 'utf8');
    const missing = SURFACES.filter((s) => s.route.startsWith('/admin')).filter(
      (s) => !script.includes(`'${s.route}'`),
    );
    expect(
      missing.map((s) => s.route),
      'the capture script does not visit these, so their screenshots drift from their captions',
    ).toEqual([]);
  });
});
