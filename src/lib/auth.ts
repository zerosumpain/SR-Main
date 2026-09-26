// Route protection helpers — Auth.js config is in hooks.server.ts

// Routes that don't require authentication
const PUBLIC_PATHS = [
  '/',
  '/blog',
  '/writing',
  '/rss.xml',
  '/sitemap.xml',
  '/login',
  '/auth-error',
  '/auth',
  // Linked from Google's OAuth consent screen, which requires them to be public.
  '/privacy',
  '/tos',
  '/api/vitals/state',
  '/api/health/apple',
  '/api/jkai/proxy',
  '/api/jkai/cors',
  // The daydream trail's push ingest — a Home Assistant automation posts GPS
  // changes here with a shared secret (DAYDREAM_INGEST_SECRET), exactly as
  // Listed as exact paths, never as '/api/daydream':
  // the match here is a prefix, and the thoughts and feedback endpoints that
  // live under that tree are owner-only.
  '/api/daydream/observe',
  // One hashed 256-bit capability per shared drive file, resolved in
  // $lib/file-shares; the drive itself stays owner-gated. Expired, revoked and
  // unknown tokens all 404 alike. This is a PREFIX — check-public-routes.mjs
  // is what stops a new sibling route becoming anonymous unnoticed.
  '/api/file-shares',
  // The Local Plan Navigator's "describe a problem" endpoint, called by a
  // public static bundle (/projects/local-plan-navigator) for anonymous
  // visitors. A PREFIX for that one project only, never '/api/projects' —
  // the visibility toggle lives under that tree and is owner-only. The route
  // itself is rate-limited per IP and capped per day; see its +server.ts.
  '/api/projects/local-plan-navigator',
  // Read-only public serving of blog post images — referenced by <img src> on the
  // public /blog pages, so it must be reachable by anonymous readers. The UPLOAD
  // endpoint (/api/admin/blog/upload-image) stays owner-gated; this serves only
  // already-public image bytes and is path-traversal guarded in blogImageKey().
  '/api/blog/images',
  // Public, read-only aggregator for the landing-page "Vital Signs" tiles.
  // Exposes only safe aggregate counts / derived build stage / already-public
  // live-walk + published-project data — never prompts, conversation ids, or
  // canvas slugs. See src/routes/api/landing/vitals/+server.ts.
  '/api/landing/vitals',
  '/projects',
  // sr. decks — presentations. The hook lets everyone through; per-deck privacy
  // is enforced by requireDeckVisible in the route loads (private-by-default,
  // owner or share-token; same two-layer design as /projects). The /decks index
  // itself 404s non-owners in its own load.
  '/decks',
  // Read-only shared jkai conversations. The /jkai/shared/<token> route
  // self-gates on shareVisibility ('public' → anyone; 'users' → requires a
  // signed-in session; else 404), so the hook must let anonymous visitors
  // reach it. Only shared conversations are exposed — the rest of /jkai stays
  // owner-only (isPublicPath('/jkai') remains false: this prefix is /jkai/shared).
  '/jkai/shared',
  // Service-to-service endpoints for the stealth-scrape + interactive-VNC
  // proxy. Auth is enforced by each handler via SCRAPER_SERVICE_TOKEN
  // (Bearer header) — not Google OAuth, because the caller is the VPS
  // workflow engine reaching homeserv over Tailscale, not a human.
  '/api/scraper/run',
  '/api/scraper/interactive',
  '/api/scraper/node',
  // Same shape, opposite direction: the security panel reads the PEER host's
  // sshd/fail2ban posture, and each host can only read its own. The cookie gate
  // is dropped so the bearer can be the gate — and the handler still refuses
  // anything without either a valid SERVICE_BRIDGE_SECRET or an owner session,
  // so this does not make posture public. The one mutating action (unban) is
  // owner-session ONLY and rejects the bearer outright.
  '/api/admin/security',
  // The browser's Mapbox token, validated as a `pk.` public token only.
  //
  // Anonymous readers need it and no Main page does: SR-Health's shared
  // activity pages draw a route for somebody with no account, and their browser
  // fetches `/api/maps/config` by absolute path — which cloudflared sends HERE,
  // because `/api/maps` is not a path that application owns.
  //
  // Removed by #871 along with Main's own map code, which took every map on
  // /health down until it was noticed. The dependency is an HTTP one, so
  // neither repository's build could see it. Pinned by a test in auth.test.ts
  // and by the public-routes lockfile, so the next prune has to argue with both.
  '/api/maps/config',
];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

// Authed pages AND authed APIs are owner-only by DEFAULT (see hooks.server.ts).
// A signed-in guest (on the allowed_user login allow-list, but not an owner) may
// reach the public paths above plus any prefix listed here — nothing else.
// /jkai, /admin, /live, /deepdive, the canvas, etc. are all owner-only.
// To grant guests a specific surface later, add its prefix here (e.g. '/live').
// Empty = guests can sign in but see only public content.
const GUEST_ALLOWED_PREFIXES: string[] = [];

export function isGuestAllowedPath(pathname: string): boolean {
  return GUEST_ALLOWED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

// What a MEMBER (a guest the owner promoted at /admin/access — see
// $lib/server/members) may reach beyond the guest surface: their own intel
// space, read-only, plus triage of their own held mail and connecting their
// own Gmail.
//
// Keyed on SvelteKit's ROUTE ID, not the pathname, and matched exactly. A
// pathname pattern for `/jkai/intel/notes/[id]` would also match the static
// sibling `/jkai/intel/notes/new`, and `/api/jkai/intel/entities/[id]` would
// match `/api/jkai/intel/entities/split`; the route id cannot be confused that
// way, and a directory added beside one of these is closed until listed here.
// Per method, too: most of these handlers also carry owner-only writes.
//
// Every route here must resolve its data through `resolveRequestScope` — the
// hook deciding a member may REACH a route is not what stops the owner's rows
// reaching them (members.integration.test.ts and route-scope.test.ts).
const MEMBER_ROUTES: Record<string, readonly string[]> = {
  // Pages. A page's `__data.json` carries the same route id.
  '/jkai/intel': ['GET'],
  '/jkai/intel/notes': ['GET'],
  '/jkai/intel/notes/[id]': ['GET'],
  '/jkai/intel/entities': ['GET'],
  '/jkai/intel/entities/[id]': ['GET'],
  '/jkai/intel/timeline': ['GET'],
  '/jkai/intel/mail': ['GET'],
  // Read APIs the pages above call.
  '/api/jkai/intel/network': ['GET'],
  '/api/jkai/intel/network/paths': ['GET'],
  '/api/jkai/intel/evidence-network': ['GET'],
  '/api/jkai/intel/entity-card': ['GET'],
  '/api/jkai/intel/entities': ['GET'],
  '/api/jkai/intel/entities/[id]': ['GET'],
  '/api/jkai/intel/notes': ['GET'],
  '/api/jkai/intel/notes/[id]': ['GET'],
  // Triage of their own held mail: admit / reject / requeue / similar /
  // score-relevance, each within the request's scope. The one owner-only
  // action on this handler (backfill-embeddings) refuses non-owner scopes.
  '/api/jkai/intel/mail': ['GET', 'POST'],
  // Their own Gmail, read-only scopes; the callback stamps their principal.
  '/api/gmail/connect': ['GET'],
  '/api/gmail/callback': ['GET'],
};

export function isMemberAllowedRoute(routeId: string | null | undefined, method: string): boolean {
  if (!routeId) return false;
  const methods = MEMBER_ROUTES[routeId];
  if (!methods) return false;
  const m = method.toUpperCase();
  return methods.includes(m) || (m === 'HEAD' && methods.includes('GET'));
}

/** The member route ids, for the tests that prove each one is scoped. */
export function memberRouteIds(): string[] {
  return Object.keys(MEMBER_ROUTES);
}

// What a HOUSEHOLD viewer (an `allowed_user` row with role 'household' whose
// email is on a `household_member` row — see $lib/server/viewer) may reach:
// the People room and their own page under it. Nothing else under /home —
// voice, echoes and devices stay owner-only — and no API.
//
// Keyed on the route id and per verb, exactly like MEMBER_ROUTES and for the
// same reasons. Reaching the route is not seeing everything on it: both loads
// scope their payload to the viewer (`peopleViewerOf`, `scopeHousehold`) —
// the production database role bypasses RLS, so the load is the only place
// scoping can live.
const HOUSEHOLD_ROUTES: Record<string, readonly string[]> = {
  '/home/people': ['GET'],
  '/home/people/[subject]': ['GET'],
};

export function isHouseholdAllowedRoute(routeId: string | null | undefined, method: string): boolean {
  if (!routeId) return false;
  const methods = HOUSEHOLD_ROUTES[routeId];
  if (!methods) return false;
  const m = method.toUpperCase();
  return methods.includes(m) || (m === 'HEAD' && methods.includes('GET'));
}

/** The household route ids, for the test that proves each one exists. */
export function householdRouteIds(): string[] {
  return Object.keys(HOUSEHOLD_ROUTES);
}
