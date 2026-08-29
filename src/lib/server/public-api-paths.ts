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
/**
 * `/api/family-presence/stats` was here until 2026-08-29 and is deliberately
 * gone.
 *
 * It anonymously served five family members' clustered location history and
 * their current positions, labelled by first name — three of them children,
 * where the densest cluster is the front door and the second densest is the
 * school. It answered 503 only because its backing workflow datastore row is
 * empty: a loaded gun with an empty magazine, one workflow run away from being
 * live.
 *
 * It was also INVISIBLE to the CI public-routes lockfile, which read
 * PUBLIC_PATHS and the hook bypasses and had never read this array — so nothing
 * would have flagged it. That blind spot is CLOSED as of the same change:
 * scripts/check-public-routes.mjs now extracts these entries and folds them
 * into .github/public-routes.txt as exact paths, with /api/biome/state as the
 * canary so the extraction cannot silently stop working. Adding a line here is
 * a reviewable diff in that snapshot. Verified by adding a throwaway route and
 * watching the gate go red.
 *
 * The route count did not move when that landed, and that is expected rather
 * than a sign it did nothing: both surviving entries are ALSO covered by a
 * PUBLIC_PATHS prefix (/api/biome, /api/landing) and were already listed.
 * family-presence was the only entry this array opened on its own. The gate is
 * for the next one.
 *
 * Nothing in a browser consumed it. The only reader is jkai's
 * `family_presence_current` site-tool, which goes to the datastore directly
 * (src/lib/workflows/site-tools/tools/site-signals.ts) and is unaffected.
 * Removing the line closes the route: /api/* with no entry here and no hook
 * bypass requires an owner session.
 */
export const PUBLIC_API_PATHS = [
  '/api/biome/state',
  '/api/landing/ecg-telemetry',
] as const;

export function isPublicApiPath(pathname: string): boolean {
  return (PUBLIC_API_PATHS as readonly string[]).some((p) => pathname === p);
}
