// The site's own HTTP surface: every route, and what the auth gate does with it.
//
// The inventory is baked into the build by vite-plugins/route-manifest.mjs, NOT
// read from disk at request time. The first version scanned `src/routes` at
// runtime and was wrong in production: /opt/strange-rambling-svelte has a `src/`
// directory, but it is a leftover from 2026-07-24 — ci-deploy rsyncs exactly one
// file out of it (schema.ts). So the scan succeeded and returned a month-old
// tree, 359 routes instead of 598, missing the page doing the reading. It never
// errored; it lied quietly, which is precisely what this page exists to catch.
// Presence is not freshness.
//
// Classification does not reimplement the gate. `isPublicPath` is imported from
// $lib/auth — the actual function hooks.server.ts calls — and the hook bypasses
// come from $lib/server/gate-bypasses, the same list the CI public-surface
// lockfile reads. If this page and the gate ever disagree, it is because the
// gate changed and CI has already failed.
import { ROUTE_MANIFEST } from 'virtual:sr-route-manifest';
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
  /** How the inventory got here — shown so the numbers can be trusted. */
  source: string;
}

export interface ApiSurfaceUnavailable {
  available: false;
  reason: string;
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

export function readApiSurface(): ApiSurface | ApiSurfaceUnavailable {
  const manifest = ROUTE_MANIFEST;
  if (!Array.isArray(manifest) || manifest.length === 0) {
    // Fail loud rather than rendering an empty table, which would read as
    // "nothing is exposed" — the most dangerous thing this page could say.
    return {
      available: false,
      reason:
        'The route manifest is empty. It is generated at build time by ' +
        'vite-plugins/route-manifest.mjs, so this means the build produced no ' +
        'inventory — the surface is not empty, it is unread.',
    };
  }

  const routes: RouteEntry[] = manifest.map((r) => ({
    path: r.path,
    kind: r.kind,
    methods: r.methods,
    ...classify(r.path),
  }));

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
    source: 'baked into this build at compile time',
  };
}
