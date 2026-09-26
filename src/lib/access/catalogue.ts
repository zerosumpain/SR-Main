// The permission catalogue — every permission the site can grant, and the
// routes each one opens.
//
// Permissions live in CODE; who holds them lives in the database
// (`allowed_user.groups/grants` jsonb + `access_group`, see $lib/server/access).
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
    open: true,
    levels: { self: 'Read the desk; own saved stories', all: 'Same as self', admin: 'Same as self' },
  },
  {
    id: 'research',
    label: 'Research',
    blurb: 'Deep research runs, up to brief depth and 5 a day.',
    open: true,
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
    blurb: 'The household dashboard and devices; Echo readings and the voice log at all.',
    open: true,
    levels: {
      self: 'The house: dashboard and devices',
      all: "Also the Echo readings and voice log — the household's routine and speech",
      admin: 'Same as all',
    },
  },
  {
    id: 'jkai.chat',
    label: 'jkai · chat',
    blurb: 'Chat with jkai: web search, news and charts only — none of your data or tools. 50 messages a day.',
    open: true,
    levels: { self: 'Own threads', all: "Also read everyone's", admin: "Also manage everyone's" },
  },
  {
    id: 'jkai.notes',
    label: 'jkai · notes',
    blurb: 'The notebook, with voice notes. Reviews and weaving stay yours.',
    open: true,
    levels: { self: 'Own notebook', all: "Also read everyone's", admin: "Also edit everyone's" },
  },
  {
    id: 'jkai.intel',
    label: 'jkai · intel',
    blurb: 'Their own intel graph, the household graph, and their own Gmail read-only.',
    open: true,
    levels: {
      self: 'Own space + household',
      all: "Also read every other user's graph (not their held mail)",
      admin: "Also see and triage everyone's held mail",
    },
  },
  {
    id: 'jkai.knowledge',
    label: 'jkai · recall',
    blurb: 'One search across their intel and research. The page lives in the intel workbench, so give intel too.',
    open: true,
    levels: { self: 'What their other grants let them read', all: 'Same as self', admin: 'Same as self' },
  },
];

export const FAMILY: readonly { id: FamilyPermission; label: string; blurb: string; open: boolean }[] = [
  {
    id: 'family:circle',
    label: 'Family circle',
    blurb: "See their own and the family's live locations.",
    open: true,
  },
  {
    id: 'family:admin',
    label: 'Family admin',
    blurb: "See their own and their kids' location history. Set who their kids are on /home/people/settings.",
    open: true,
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

/**
 * True when the permission's area (or family permission) is open. A grant for
 * an area that has not opened yet is stored but never held: code that checks a
 * capability — "may this reader file a note?" — must not find a door the
 * catalogue has not opened (see `effectivePermissions`).
 */
export function isOpenPermission(p: Permission): boolean {
  const family = FAMILY.find((f) => f.id === p);
  if (family) return family.open;
  const area = AREAS.find((a) => p.startsWith(`${a.id}:`));
  return area?.open ?? false;
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

  // ── family:circle — the People room and a person page under it. Nothing else
  // under /home (voice, echoes and devices are the `home` area) and no API.
  // Reaching the route is not seeing everything on it: both loads scope their
  // payload to the viewer (`peopleViewerOf`, `scopeHousehold` in
  // $lib/home/presence/viewer), and a circle viewer's own page is the only
  // person page that opens for them.
  '/home/people': { GET: 'family:circle' },
  '/home/people/[subject]': { GET: 'family:circle' },

  // ── research — runs a member may read, start and change. Every route here
  // resolves the session through `requireResearchSession` (or the list through
  // `readable`), which decides own / household / everyone's and read / write;
  // so the gate asks only for the area, at `self`. Left out, owner-only: the
  // two that write into John's own stores (to-drive, to-intel), the legacy
  // `/api/deepdive` root and `/api/quickanswer`, maintenance re-indexing, the
  // Tavily key admin and the image proxy.
  '/research': { GET: 'research:self' },
  '/research/[id]': { GET: 'research:self' },
  '/research/[id]/desk': { GET: 'research:self' },
  '/api/research': { GET: 'research:self', POST: 'research:self', DELETE: 'research:self' },
  '/api/research/[id]/stream': { GET: 'research:self' },
  '/api/research/[id]/control': { POST: 'research:self' },
  '/api/research/[id]/spend': { GET: 'research:self' },
  '/api/research/[id]/network': { GET: 'research:self' },
  '/api/research/source/[id]': { GET: 'research:self' },
  '/api/deepdive/[id]': { GET: 'research:self', PATCH: 'research:self', DELETE: 'research:self' },
  '/api/deepdive/[id]/data': { GET: 'research:self' },
  '/api/deepdive/[id]/clusters': { GET: 'research:self' },
  '/api/deepdive/[id]/report': { GET: 'research:self' },
  '/api/deepdive/[id]/stream': { GET: 'research:self' },
  '/api/deepdive/[id]/export/docx': { GET: 'research:self' },
  '/api/deepdive/[id]/export/md': { GET: 'research:self' },
  '/api/deepdive/[id]/export/narrative-docx': { GET: 'research:self' },
  '/api/deepdive/[id]/export/narrative-md': { GET: 'research:self' },
  '/api/deepdive/[id]/chat': { POST: 'research:self' },
  '/api/deepdive/[id]/report/custom': { POST: 'research:self' },
  '/api/deepdive/[id]/report/regenerate': { POST: 'research:self' },
  '/api/deepdive/[id]/synthesize': { POST: 'research:self' },
  '/api/deepdive/[id]/source-summary': { POST: 'research:self' },
  '/api/deepdive/[id]/explore': { POST: 'research:self' },
  '/api/deepdive/[id]/narrative': { GET: 'research:self', POST: 'research:self' },
  '/api/deepdive/[id]/artefacts/[artefactId]/position': { PATCH: 'research:self' },
  '/api/deepdive/[id]/share': { POST: 'research:self', DELETE: 'research:self' },

  // ── news — the desk and a story. Each action checks the grant it needs
  // (graph: jkai.intel, research: research) inside the handler.
  // ── jkai.chat — their own threads, on a closed tool list. Every route
  // resolves the thread or job through $lib/jkai/chat-access.server (post in
  // your own thread only); the turn itself runs restricted (member-chat
  // policy). Never opened: the context rail and drill, thread graph and memory,
  // traces, routing and the canvas chat history (chat-route-access.test).
  '/jkai': { GET: 'jkai.chat:self' },
  '/api/jkai/conversations': { GET: 'jkai.chat:self', POST: 'jkai.chat:self' },
  '/api/jkai/conversations/[id]': { GET: 'jkai.chat:self', PATCH: 'jkai.chat:self', DELETE: 'jkai.chat:self' },
  '/api/jkai/conversations/[id]/messages': { GET: 'jkai.chat:self' },
  '/api/jkai/attachments': { POST: 'jkai.chat:self' },
  '/api/jkai/attachments/[id]': { GET: 'jkai.chat:self', DELETE: 'jkai.chat:self' },
  '/api/jkai/events': { GET: 'jkai.chat:self' },
  '/api/workflows/orchestrator/chat': {
    GET: 'jkai.chat:self',
    POST: 'jkai.chat:self',
    PATCH: 'jkai.chat:self',
    DELETE: 'jkai.chat:self',
  },
  '/api/workflows/orchestrator/chat/stream': { GET: 'jkai.chat:self' },
  '/api/workflows/orchestrator/chat/active': { GET: 'jkai.chat:self' },
  '/api/workflows/orchestrator/chat/presence': { POST: 'jkai.chat:self' },

  // ── jkai.knowledge — recall. The search reads only what the caller's other
  // grants already open (their intel scope, their readable research), never
  // the owner's files, memory, datastore or activity. The page sits in the
  // intel workbench, whose layout still needs an intel level.
  '/jkai/intel/search': { GET: 'jkai.knowledge:self' },
  '/api/jkai/knowledge/search': { POST: 'jkai.knowledge:self' },

  // ── jkai.notes — the notebook. Every route resolves notes through
  // $lib/daydream/notebook/access.server (own / household / everyone's, read /
  // write); review and weave refuse anyone but the owner inside the handler.
  '/jkai/notes': { GET: 'jkai.notes:self' },
  '/api/daydream/notes': { GET: 'jkai.notes:self', POST: 'jkai.notes:self' },
  '/api/daydream/notes/audio': { POST: 'jkai.notes:self' },
  '/api/daydream/notes/audio/[id]': { GET: 'jkai.notes:self', DELETE: 'jkai.notes:self' },

  // ── home — the house, not a person. People are /home/people's (family:circle),
  // and the dashboard's people card follows that rule. The Echo readings
  // (per-room motion, alarms, what played) and the voice log are the
  // household's routine and speech, so they open at `all`, never `self`.
  '/home': { GET: 'home:self' },
  '/home/devices': { GET: 'home:self' },
  '/home/echoes': { GET: 'home:all' },
  '/home/voice': { GET: 'home:all' },

  '/news': { GET: 'news:self' },
  '/news/[source]/[id]': { GET: 'news:self' },
  '/api/news/actions': { POST: 'news:self' },
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

/**
 * The pages (not APIs, not `[param]` routes) these grants open, for the nav:
 * a member is offered exactly the destinations they can reach. Sorted, so the
 * nav's "first page under a cell" is stable.
 */
export function reachablePages(grants: Iterable<Permission>): string[] {
  const held = [...grants];
  return Object.entries(ROUTES)
    .filter(([id, verbs]) => !id.startsWith('/api/') && !id.includes('[') && verbs.GET && satisfies(held, verbs.GET))
    .map(([id]) => id)
    .sort();
}

/** Every route id the catalogue opens to anyone. */
export function catalogueRouteIds(): string[] {
  return Object.keys(ROUTES);
}
