/**
 * "I want every page to follow the same top nav-bar pattern."
 *
 * That sentence is the acceptance criterion, so it gets a test rather than a
 * one-off audit. This walks the real route tree and asserts that every page
 * either renders the shared header — itself, or through a layout above it — or
 * is named in `CHROME_EXCLUSIONS` with a reason.
 *
 * The point is the ratchet: a new page added without chrome fails here, which
 * is the only thing that stops the site drifting back into six dialects.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { wearsSharedChrome } from '../../../src/lib/nav/site-nav';

const ROUTES = resolve(__dirname, '../../../src/routes');

/** Anything that puts the shared bar on screen, directly or as a shell. */
const CHROME_MARKERS = [
  'SiteHeader',
  'PageHeader',
  'HealthShell',
  'HubHeader',
  'AdminShell',
  'AdminTopNav',
  'FieldStudyNav',
];

/**
 * `site-nav-bar` is deliberately NOT a marker. The root layout owns the class's
 * CSS but renders no header, so matching on the string made every page in the
 * repo look like it inherited chrome and the test passed while /research had
 * none. Match on the COMPONENTS that actually render a bar.
 */

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/^\+page(@[^.]*)?\.svelte$/.test(entry)) out.push(full);
  }
  return out;
}

/** `src/routes/jkai/intel/notes/+page.svelte` -> `/jkai/intel/notes` */
function routeOf(file: string): string {
  const rel = file.slice(ROUTES.length).replace(/\/\+page(@[^.]*)?\.svelte$/, '');
  const path = rel
    .split('/')
    .filter((s) => s && !/^\(.*\)$/.test(s))
    .join('/');
  return '/' + path;
}

/**
 * A component is "rendered here" only if it is both imported and used. Matching
 * the bare name matched PROSE: the root layout's own comment says "see SiteNav
 * / PageHeader", which made every page in the repo look covered and the test
 * pass while /research had no header at all.
 */
function rendersDirectly(src: string): boolean {
  return CHROME_MARKERS.some(
    (m) => new RegExp(`import\\s+${m}\\s+from`).test(src) && new RegExp(`<${m}[\\s/>]`).test(src),
  );
}

const LIB = resolve(__dirname, '../../../src/lib');

/**
 * One hop through the page's own view components.
 *
 * /health does not render HealthShell itself — it renders HealthDashboard,
 * which renders HealthShell. Four of the seven HealthShell pages are shaped
 * that way, so a direct-render-only check calls them naked when they are not.
 * One hop covers every case in this repo; it deliberately does not recurse,
 * because a chrome component three levels down a render tree is a design
 * problem this test should surface rather than absorb.
 */
/**
 * A `+page.svelte` that renders nothing. `/projects/jkai` is one: its whole
 * body is a comment explaining that the redirect lives in `+page.server.ts` and
 * the file exists only so SvelteKit does not 404 the bare route. Demanding a
 * nav bar from a page with no markup is demanding it from a redirect.
 */
function rendersNothing(file: string): boolean {
  const body = readFileSync(file, 'utf8')
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();
  return body === '';
}

function hasMarker(file: string): boolean {
  const src = readFileSync(file, 'utf8');
  if (rendersDirectly(src)) return true;
  for (const m of src.matchAll(/import\s+(\w+)\s+from\s+'\$lib\/([^']+\.svelte)'/g)) {
    const [, name, rel] = m;
    if (!new RegExp(`<${name}[\\s/>]`).test(src)) continue;
    const child = join(LIB, rel);
    if (existsSync(child) && rendersDirectly(readFileSync(child, 'utf8'))) return true;
  }
  return false;
}

/**
 * Chrome from a layout above. A `+page@.svelte` resets to the ROOT layout, so
 * it inherits nothing from its own directory chain — which is exactly why
 * /jkai/run and /jkai/shared use that form to escape the hub shell.
 */
function inheritsChrome(file: string): boolean {
  const isReset = /\+page@[^.]*\.svelte$/.test(file);
  if (isReset) return false;
  let dir = join(file, '..');
  while (dir.startsWith(ROUTES)) {
    const layout = join(dir, '+layout.svelte');
    if (existsSync(layout) && hasMarker(layout)) return true;
    if (dir === ROUTES) break;
    dir = join(dir, '..');
  }
  return false;
}

describe('every page wears the shared top nav', () => {
  const pages = walk(ROUTES);

  it('finds the route tree', () => {
    expect(pages.length).toBeGreaterThan(150);
  });

  it('leaves no page without chrome and without a documented reason', () => {
    const naked: string[] = [];
    for (const file of pages) {
      const route = routeOf(file);
      if (!wearsSharedChrome(route)) continue; // carved out, with a reason
      if (rendersNothing(file)) continue; // a redirect stub, not a page
      if (hasMarker(file) || inheritsChrome(file)) continue;
      naked.push(route);
    }
    expect(
      naked,
      `these pages have no top nav and are not in CHROME_EXCLUSIONS:\n  ${naked.join('\n  ')}`,
    ).toEqual([]);
  });

  it('keeps chrome off every route that cannot hold it', () => {
    for (const file of pages) {
      const route = routeOf(file);
      if (wearsSharedChrome(route)) continue;
      expect(
        hasMarker(file),
        `${route} is carved out of shared chrome but still renders some`,
      ).toBe(false);
    }
  });
});
