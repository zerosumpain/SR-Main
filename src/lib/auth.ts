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
  '/api/biome/state',
  '/api/biome/config',
  '/api/health/apple',
  '/api/agent',
  '/api/jkai/proxy',
  '/api/jkai/cors',
  '/api/live-walk',
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
  // Write-only frame-rate telemetry beacon from the landing heartbeat — logs a
  // single line to stdout, stores nothing. See its +server.ts for rationale.
  '/api/landing/ecg-telemetry',
  '/projects',
  // Read-only shared jkai conversations. The /jkai/shared/<token> route
  // self-gates on shareVisibility ('public' → anyone; 'users' → requires a
  // signed-in session; else 404), so the hook must let anonymous visitors
  // reach it. Only shared conversations are exposed — the rest of /jkai stays
  // owner-only (isPublicPath('/jkai') remains false: this prefix is /jkai/shared).
  '/jkai/shared',
  '/heart',
  // Public leaderboard for the Terminal Descent game (/projects/terminal-descent).
  // Anonymous read (GET scores) + write (POST session + score). No OAuth — the
  // POST surface is bounded by single-use nonces, rate limiting and server-side
  // score recomputation (see src/lib/space-lander/score.ts), not a cookie gate.
  '/api/space-lander',
  // Public, read-only ratings proxy for Broads Pilot (/projects/broads-pilot).
  // Anonymous GET only; the handler self-limits and caches Google Places data
  // server-side (no OAuth, since holidaymakers using the planner never sign in).
  '/api/broads-pilot',
  // Service-to-service endpoints for the stealth-scrape + interactive-VNC
  // proxy. Auth is enforced by each handler via SCRAPER_SERVICE_TOKEN
  // (Bearer header) — not Google OAuth, because the caller is the VPS
  // workflow engine reaching homeserv over Tailscale, not a human.
  '/api/scraper/run',
  '/api/scraper/interactive',
  '/api/scraper/node',
  // VPS→homeserv proxy for the Hermes admin pages (session inspector, telemetry,
  // cron). Auth is enforced per-handler via a mandatory HERMES_BRIDGE_SECRET
  // Bearer (assertHermesServiceRequest) — not Google OAuth, because the caller
  // is the VPS reaching homeserv over Tailscale. Dropping the cookie gate here
  // does NOT make the data public; the bearer is the real gate.
  '/api/admin/hermes',
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
