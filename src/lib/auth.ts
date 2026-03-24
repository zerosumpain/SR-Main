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
];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
}
