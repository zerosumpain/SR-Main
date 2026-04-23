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
  '/projects',
  '/heart',
  // Service-to-service endpoint for the stealth-scrape proxy. Auth is
  // enforced by the handler itself via SCRAPER_SERVICE_TOKEN (Bearer
  // header) — not Google OAuth, because the caller is the VPS workflow
  // engine reaching homeserv over Tailscale, not a human.
  '/api/scraper/run',
];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
}
