// Emits the site's route inventory as a virtual module, computed at BUILD time.
//
// Why a build-time manifest and not a runtime scan: `src/` is NOT deployed.
// /opt/strange-rambling-svelte does contain a `src/` directory, but it is a
// leftover from 2026-07-24 — ci-deploy rsyncs exactly one file out of it
// (schema.ts, for drizzle push). A runtime `readdirSync` therefore succeeds on
// the VPS and returns a month-old tree: 359 routes instead of 598, missing the
// page doing the reading. It does not error, it lies quietly, which is the one
// failure mode /admin/estate exists to prevent. Presence is not freshness.
//
// Baking it here means the inventory travels inside the build that serves it,
// so it cannot disagree with the running code. It also removes ~100ms of
// synchronous filesystem work from the request path.
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const VIRTUAL_ID = 'virtual:sr-route-manifest';
const RESOLVED_ID = '\0' + VIRTUAL_ID;
const VERBS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

/**
 * `src/routes/api/agent/foo/+server.ts` → `/api/agent/foo`
 * @param {string} routesDir
 * @param {string} file
 * @returns {string}
 */
function routePath(routesDir, file) {
  const rel = relative(routesDir, file).split('\\').join('/');
  // The leading slash is optional: src/routes/+page.svelte has no parent
  // directory, and anchoring to `/+` renders the site root as "/+page.svelte".
  const dir = rel.replace(/(^|\/)\+(server\.ts|page\.svelte|page\.server\.ts)$/, '');
  const cleaned = dir
    .split('/')
    .filter((seg) => seg && !/^\(.*\)$/.test(seg)) // drop (route groups)
    .join('/');
  return '/' + cleaned;
}

/**
 * @param {string} dir
 * @param {string[]} acc
 * @returns {string[]}
 */
function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (/^\+(server\.ts|page\.svelte)$/.test(entry)) acc.push(full);
  }
  return acc;
}

/**
 * @param {string} routesDir
 * @returns {Array<{ path: string, kind: 'api' | 'page', methods: string[] }>}
 */
function build(routesDir) {
  return walk(routesDir)
    .map((file) => {
      /** @type {'api' | 'page'} */
      const kind = file.endsWith('+server.ts') ? 'api' : 'page';
      /** @type {string[]} */
      let methods = [];
      if (kind === 'api') {
        try {
          const src = readFileSync(file, 'utf8');
          methods = VERBS.filter((v) => new RegExp(`export\\s+const\\s+${v}\\b`).test(src));
        } catch {
          /* an unreadable handler still belongs in the inventory */
        }
      }
      return { path: routePath(routesDir, file), kind, methods };
    })
    .filter((r, i, a) => a.findIndex((x) => x.path === r.path && x.kind === r.kind) === i)
    .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * @param {{ routesDir?: string }} [options]
 * @returns {import('vite').Plugin}
 */
export function routeManifest({ routesDir = 'src/routes' } = {}) {
  return {
    name: 'sr-route-manifest',
    /** @param {string} id */
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : null;
    },
    /** @param {string} id */
    load(id) {
      if (id !== RESOLVED_ID) return null;
      // Recomputed on every load, so a dev-server restart or an invalidation
      // picks up new routes without a rebuild of anything else.
      return `export const ROUTE_MANIFEST = ${JSON.stringify(build(routesDir))};`;
    },
    /** @param {import('vite').ViteDevServer} server */
    configureServer(server) {
      // In dev, adding or deleting a route file should refresh the inventory.
      /** @param {string} file */
      const invalidate = (file) => {
        if (!/\+(server\.ts|page\.svelte)$/.test(file)) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
        if (mod) server.moduleGraph.invalidateModule(mod);
      };
      server.watcher.on('add', invalidate);
      server.watcher.on('unlink', invalidate);
    },
  };
}
