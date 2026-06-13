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
  // Public, read-only aggregator for the landing-page "Vital Signs" tiles.
  // Exposes only safe aggregate counts / derived build stage / already-public
  // live-walk + published-project data — never prompts, conversation ids, or
  // canvas slugs. See src/routes/api/landing/vitals/+server.ts.
  '/api/landing/vitals',
  '/projects',
  '/heart',
  // Public leaderboard for the Terminal Descent game (/projects/terminal-descent).
  // Anonymous read (GET scores) + write (POST session + score). No OAuth — the
  // POST surface is bounded by single-use nonces, rate limiting and server-side
  // score recomputation (see src/lib/space-lander/score.ts), not a cookie gate.
  '/api/space-lander',
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
