// The site's own HTTP surface: every route file, and what the auth gate does
// with it.
//
// Read from the route tree at request time rather than from a generated
// manifest, for one reason — a manifest is a second copy. The whole point of
// this panel is to answer "what is reachable RIGHT NOW", and a list that is
// refreshed by remembering to run a script answers "what was reachable when
// somebody last remembered".
//
// Classification does not reimplement the gate. `isPublicPath` is imported from
// $lib/auth — the actual function hooks.server.ts calls — and the hook bypasses
// come from $lib/server/gate-bypasses, the same list the CI public-surface
// lockfile reads. If this page and the gate ever disagree, it is because the
// gate changed and CI has already failed.
//
// Everything here is best-effort. `src/` ships to the VPS today, but a future
// deploy that stops shipping it must degrade to "unavailable", never to a page
// that 500s or, worse, to an empty list that reads as "nothing is exposed".
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { isPublicPath } from '$lib/auth';
import { PUBLIC_API_PATHS } from '$lib/server/public-api-paths';
import {
  HOOK_BYPASSES,
  HOOK_EXACT_BYPASSES,
  HOOK_PAGE_PREFIX_BYPASSES,
  BYPASS_GUARDS,
} from '$lib/server/gate-bypasses';

export type GateClass =
  /** No authentication at all. The world can read it. */
  | 'open'
  /** Past the Auth.js gate, but the handler enforces its own token/secret. */
  | 'self-gated'
  /** Owner session required — the default for everything not named above. */
  | 'owner';

export interface RouteEntry {
  path: string;
  kind: 'api' | 'page';
  methods: string[];
  gate: GateClass;
  /** What stands in front of it, when something does. */
  guard?: string;
}

export interface ApiSurface {
  available: true;
  routes: RouteEntry[];
  counts: { api: number; page: number; open: number; selfGated: number; owner: number };
  /** Where the tree was read from — shown so the numbers can be trusted. */
  root: string;
}

export interface ApiSurfaceUnavailable {
  available: false;
  reason: string;
}

/** `src/routes/api/agent/foo/+server.ts` → `/api/agent/foo` */
function routePath(routesDir: string, file: string): string {
  const rel = relative(routesDir, file).split('\\').join('/');
  // The leading slash is optional: src/routes/+page.svelte has no parent
  // directory, and anchoring to `/+` left it rendering as "/+page.svelte"
  // instead of "/" — the site root, missing from its own inventory.
  const dir = rel.replace(/(^|\/)\+(server\.ts|page\.svelte|page\.server\.ts)$/, '');
  const cleaned = dir
    .split('/')
    .filter((seg) => seg && !/^\(.*\)$/.test(seg)) // drop (route groups)
    .join('/');
  return '/' + cleaned;
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (/^\+(server\.ts|page\.svelte)$/.test(entry)) acc.push(full);
  }
  return acc;
}

const VERBS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

function methodsOf(file: string): string[] {
  if (!file.endsWith('+server.ts')) return [];
  try {
    const src = readFileSync(file, 'utf8');
    return VERBS.filter((v) => new RegExp(`export\\s+const\\s+${v}\\b`).test(src));
  } catch {
    return [];
  }
}

/** The longest bypass prefix covering a path, so the guard label is the specific one. */
function bypassPrefix(path: string): string | undefined {
  const all = [...HOOK_BYPASSES, ...HOOK_PAGE_PREFIX_BYPASSES];
  return all
    .filter((p) => path === p || path.startsWith(p + '/'))
    .sort((a, b) => b.length - a.length)[0];
}

function classify(path: string): { gate: GateClass; guard?: string } {
  // Genuinely unauthenticated — the one list the hook enforces verbatim.
  if ((PUBLIC_API_PATHS as readonly string[]).includes(path)) {
    return { gate: 'open', guard: 'none — world-readable by design' };
  }
  const prefix = bypassPrefix(path);
  if (prefix) {
    return { gate: 'self-gated', guard: BYPASS_GUARDS[prefix] ?? 'self-gated in the handler' };
  }
  if (HOOK_EXACT_BYPASSES.includes(path)) {
    return { gate: 'open', guard: BYPASS_GUARDS[path] ?? 'public page' };
  }
  // PUBLIC_PATHS is a PREFIX match, and several of its trees self-gate inside
  // the handler (share tokens, project visibility, agent keys). Anonymous
  // reachability is the honest claim; "open" would overstate it.
  if (isPublicPath(path)) {
    return { gate: 'self-gated', guard: 'anonymous prefix — handler decides what it returns' };
  }
  return { gate: 'owner' };
}

function findRoutesDir(): string | null {
  const candidates = [
    join(process.cwd(), 'src', 'routes'),
    join(process.cwd(), '..', 'src', 'routes'),
  ];
  for (const c of candidates) {
    try {
      if (existsSync(c) && statSync(c).isDirectory()) return resolve(c);
    } catch {
      /* keep looking */
    }
  }
  return null;
}

// Walking the tree and regexing ~600 route files costs ~100ms of SYNCHRONOUS
// work, which blocks the event loop for every other request the app is serving.
// Paying that once per page view is already the wrong trade, so memoise it.
//
// A short TTL rather than a permanent cache: in production the route tree
// cannot change without a deploy, which restarts the process and empties this
// anyway — but in dev a new route should appear without a restart, and a stale
// inventory is exactly the kind of quiet lie this page exists to prevent.
const CACHE_TTL_MS = 60_000;
let cached: { at: number; value: ApiSurface | ApiSurfaceUnavailable } | null = null;

export function readApiSurface(): ApiSurface | ApiSurfaceUnavailable {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;
  const value = scanApiSurface();
  cached = { at: Date.now(), value };
  return value;
}

function scanApiSurface(): ApiSurface | ApiSurfaceUnavailable {
  const routesDir = findRoutesDir();
  if (!routesDir) {
    return {
      available: false,
      reason:
        'The route tree is not on this host. src/ ships with the deploy today, so this means ' +
        'the layout changed — the surface is not empty, it is unread.',
    };
  }

  let files: string[];
  try {
    files = walk(routesDir);
  } catch (e) {
    return { available: false, reason: `Could not read ${routesDir}: ${(e as Error).message}` };
  }

  const routes: RouteEntry[] = files
    .map((f) => {
      const path = routePath(routesDir, f);
      const kind: 'api' | 'page' = f.endsWith('+server.ts') ? 'api' : 'page';
      return { path, kind, methods: methodsOf(f), ...classify(path) };
    })
    // A directory with both +page.svelte and +server.ts yields the path twice.
    .filter((r, i, a) => a.findIndex((x) => x.path === r.path && x.kind === r.kind) === i)
    .sort((a, b) => a.path.localeCompare(b.path));

  return {
    available: true,
    routes,
    counts: {
      api: routes.filter((r) => r.kind === 'api').length,
      page: routes.filter((r) => r.kind === 'page').length,
      open: routes.filter((r) => r.gate === 'open').length,
      selfGated: routes.filter((r) => r.gate === 'self-gated').length,
      owner: routes.filter((r) => r.gate === 'owner').length,
    },
    root: routesDir,
  };
}
