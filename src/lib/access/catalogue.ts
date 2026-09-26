// The permission catalogue — every permission the site can grant, and the
// routes each one opens.
//
// Permissions live in CODE; who holds them lives in the database
// (`allowed_user.groups/grants` + `access_group`, see $lib/server/access).
// That split is the point: a string in a row that no code defines grants
// nothing (`parsePermissions` drops it), and a route no entry here names stays
// owner-only, so new code is closed until someone lists it.
//
// Pure: no server imports, so /admin/access renders its labels from the same
// source the hook enforces.
//
// Spec: docs/superpowers/specs/2026-09-26-access-groups-design.md

/** Ordered: holding a level grants everything below it. */
export const LEVELS = ['self', 'all', 'admin'] as const;
export type Level = (typeof LEVELS)[number];

export const AREA_IDS = [
  'news',
  'research',
  'drive',
  'home',
  'jkai.chat',
  'jkai.notes',
  'jkai.intel',
  'jkai.knowledge',
] as const;
export type AreaId = (typeof AREA_IDS)[number];

export const FAMILY_PERMISSIONS = ['family:circle', 'family:admin'] as const;
export type FamilyPermission = (typeof FAMILY_PERMISSIONS)[number];

export type AreaPermission = `${AreaId}:${Level}`;
export type Permission = AreaPermission | FamilyPermission;

export interface AreaInfo {
  id: AreaId;
  label: string;
  blurb: string;
  /**
   * False until the phase that scopes the area's data ships. The admin page
   * shows a closed area's grants disabled, so a tick never silently does
   * nothing; `requiredFor` names none of its routes either.
   */
  open: boolean;
  /** What each level means for this area, in the admin page's words. */
  levels: Record<Level, string>;
}

export const AREAS: readonly AreaInfo[] = [
  {
    id: 'news',
    label: 'News',
    blurb: 'The news desk.',
    open: false,
    levels: { self: 'Read the desk; own saved stories', all: 'Same as self', admin: 'Same as self' },
  },
  {
    id: 'research',
    label: 'Research',
    blurb: 'Deep research runs.',
    open: false,
    levels: { self: 'Run and read own research', all: "Also read everyone's", admin: "Also edit everyone's" },
  },
  {
    id: 'drive',
    label: 'Drive',
    blurb: 'The file store.',
    open: false,
    levels: { self: 'Own files', all: "Also read everyone's and household files", admin: 'Also edit them' },
  },
  {
    id: 'home',
    label: 'Home',
    blurb: 'The household dashboard, devices, echoes and voice.',
    open: false,
    levels: { self: 'Read', all: 'Same as self', admin: 'Same as self' },
  },
  {
    id: 'jkai.chat',
    label: 'jkai · chat',
    blurb: 'Chat with jkai on a restricted tool list.',
    open: false,
    levels: { self: 'Own threads', all: "Also read everyone's", admin: "Also manage everyone's" },
  },
  {
    id: 'jkai.notes',
    label: 'jkai · notes',
    blurb: 'The notebook.',
    open: false,
    levels: { self: 'Own notebook', all: "Also read everyone's", admin: "Also edit everyone's" },
  },
  {
    id: 'jkai.intel',
    label: 'jkai · intel',
    blurb: 'Their own intel graph, the household graph, and their own Gmail read-only.',
    open: true,
    levels: {
      self: 'Own space + household',
      all: "Also every other user's space",
      admin: 'Same as all',
    },
  },
  {
    id: 'jkai.knowledge',
    label: 'jkai · recall',
    blurb: 'Search across what they can already read.',
    open: false,
    levels: { self: 'Own material', all: 'Follows their other grants', admin: 'Same as all' },
  },
];

export const FAMILY: readonly { id: FamilyPermission; label: string; blurb: string; open: boolean }[] = [
  {
    id: 'family:circle',
    label: 'Family circle',
    blurb: "See their own and the family's live locations.",
    open: false,
  },
  {
    id: 'family:admin',
    label: 'Family admin',
    blurb: "See their own and their kids' location history.",
    open: false,
  },
];

/**
 * Seeded into `access_group` on first read; their label and grants are then
 * editable at /admin/access, but they cannot be deleted.
 */
export const BUILT_IN_GROUPS: readonly {
  id: string;
  label: string;
  description: string;
  grants: readonly Permission[];
}[] = [
  {
    id: 'family-circle',
    label: 'Family Circle',
    description: "Own and family members' live locations on a map.",
    grants: ['family:circle'],
  },
  {
    id: 'family-admin',
    label: 'Family Admin',
    description: "Own and their kids' location history, plus the family circle.",
    grants: ['family:circle', 'family:admin'],
  },
];

const AREA_SET: ReadonlySet<string> = new Set(AREA_IDS);
const LEVEL_SET: ReadonlySet<string> = new Set(LEVELS);
const FAMILY_SET: ReadonlySet<string> = new Set(FAMILY_PERMISSIONS);

export function isPermission(value: unknown): value is Permission {
  if (typeof value !== 'string') return false;
  if (FAMILY_SET.has(value)) return true;
  const at = value.lastIndexOf(':');
  if (at <= 0) return false;
  return AREA_SET.has(value.slice(0, at)) && LEVEL_SET.has(value.slice(at + 1));
}

/** Keep only permissions the code defines, once each, in first-seen order. */
export function parsePermissions(values: readonly unknown[] | null | undefined): Permission[] {
  const out: Permission[] = [];
  for (const v of values ?? []) if (isPermission(v) && !out.includes(v)) out.push(v);
  return out;
}

function split(p: Permission): { area: string; level: Level | null } {
  if (FAMILY_SET.has(p)) return { area: p, level: null };
  const at = p.lastIndexOf(':');
  return { area: p.slice(0, at), level: p.slice(at + 1) as Level };
}

/** The highest level held in an area, or null. */
export function levelOf(grants: Iterable<Permission>, area: AreaId): Level | null {
  let best = -1;
  for (const g of grants) {
    const { area: a, level } = split(g);
    if (a === area && level) best = Math.max(best, LEVELS.indexOf(level));
  }
  return best < 0 ? null : LEVELS[best];
}

/** True when `grants` holds `required`, or a higher level of the same area. */
export function satisfies(grants: Iterable<Permission>, required: Permission): boolean {
  const need = split(required);
  if (!need.level) {
    for (const g of grants) if (g === required) return true;
    return false;
  }
  const held = levelOf(grants, need.area as AreaId);
  return held !== null && LEVELS.indexOf(held) >= LEVELS.indexOf(need.level);
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Route id → verb → the least permission that opens it.
 *
 * Keyed on SvelteKit's ROUTE ID, not the pathname, and matched exactly. A
 * pathname pattern for `/jkai/intel/notes/[id]` would also match the static
 * sibling `/jkai/intel/notes/new`, and `/api/jkai/intel/entities/[id]` would
 * match `/api/jkai/intel/entities/split`; the route id cannot be confused that
 * way, and a directory added beside one of these is closed until listed here.
 * Per verb, too: most of these handlers also carry owner-only writes.
 *
 * Reaching a route decides nothing about WHICH ROWS come back: every route
 * here must resolve its data through its area's seam (intel:
 * `resolveRequestScope` — members.integration.test.ts and route-scope.test.ts).
 */
const ROUTES: Record<string, Partial<Record<Method, Permission>>> = {
  // ── jkai.intel — a user's own intel space, read-only, plus triage of their
  // own held mail and connecting their own Gmail (was MEMBER_ROUTES).
  // Pages. A page's `__data.json` carries the same route id.
  '/jkai/intel': { GET: 'jkai.intel:self' },
  '/jkai/intel/notes': { GET: 'jkai.intel:self' },
  '/jkai/intel/notes/[id]': { GET: 'jkai.intel:self' },
  '/jkai/intel/entities': { GET: 'jkai.intel:self' },
  '/jkai/intel/entities/[id]': { GET: 'jkai.intel:self' },
  '/jkai/intel/timeline': { GET: 'jkai.intel:self' },
  '/jkai/intel/mail': { GET: 'jkai.intel:self' },
  // Read APIs the pages above call.
  '/api/jkai/intel/network': { GET: 'jkai.intel:self' },
  '/api/jkai/intel/network/paths': { GET: 'jkai.intel:self' },
  '/api/jkai/intel/evidence-network': { GET: 'jkai.intel:self' },
  '/api/jkai/intel/entity-card': { GET: 'jkai.intel:self' },
  '/api/jkai/intel/entities': { GET: 'jkai.intel:self' },
  '/api/jkai/intel/entities/[id]': { GET: 'jkai.intel:self' },
  '/api/jkai/intel/notes': { GET: 'jkai.intel:self' },
  '/api/jkai/intel/notes/[id]': { GET: 'jkai.intel:self' },
  // Triage of their own held mail: admit / reject / requeue / similar /
  // score-relevance, each within the request's scope. The one owner-only
  // action on this handler (backfill-embeddings) refuses non-owner scopes.
  '/api/jkai/intel/mail': { GET: 'jkai.intel:self', POST: 'jkai.intel:self' },
  // Their own Gmail, read-only scopes; the callback stamps their principal.
  '/api/gmail/connect': { GET: 'jkai.intel:self' },
  '/api/gmail/callback': { GET: 'jkai.intel:self' },
};

/** The permission a route + verb needs, or null when only the owner may reach it. */
export function requiredFor(routeId: string | null | undefined, method: string): Permission | null {
  if (!routeId) return null;
  const verbs = ROUTES[routeId];
  if (!verbs) return null;
  const m = method.toUpperCase();
  return verbs[m as Method] ?? (m === 'HEAD' ? verbs.GET ?? null : null);
}

/** Route ids any verb of which an area (or one family permission) opens. */
export function routeIdsFor(area: AreaId | FamilyPermission): string[] {
  return Object.entries(ROUTES)
    .filter(([, verbs]) => Object.values(verbs).some((p) => p && split(p).area === area))
    .map(([id]) => id);
}

/** Every route id the catalogue opens to anyone. */
export function catalogueRouteIds(): string[] {
  return Object.keys(ROUTES);
}
