/**
 * API routes reachable WITHOUT authentication.
 *
 * Single source of truth, deliberately. `hooks.server.ts` enforces this list
 * and `/admin/access/security` displays it; when those were going to be two
 * separate arrays the second one would have started lying the first time
 * anyone edited one of them. The sensitive-data detector already taught this
 * lesson by existing in three copies that drifted.
 *
 * Adding an entry here makes a route world-readable. Read-only endpoints only,
 * plus the write-only telemetry beacon which stores nothing.
 */
export const PUBLIC_API_PATHS = [
  '/api/vitals/state',
  // Only prepared, explicitly published hero derivatives; original Drive files remain private.
  '/api/landing/hero-media',
  // Public repository commit/tree ids only.
  '/api/version',
] as const;

export function isPublicApiPath(pathname: string): boolean {
  return (PUBLIC_API_PATHS as readonly string[]).some((p) => pathname === p);
}
