/**
 * The workflow-engine liveness probe, at its owning domain's path.
 *
 * This is Main's platform watchdog, not a health-domain endpoint. It has lived
 * at `/api/health/workflow-engine` since before `/health` was a product, and now
 * that the health domain is being extracted the collision matters: the edge
 * router will hand `/api/health/*` to the health application, and this probe
 * must keep reaching Main — because its failure action, in
 * `strange-rambling-svelte-watchdog.service`, is `systemctl restart
 * strange-rambling-svelte`. A routing mistake here does not 404 quietly; it
 * restarts the site every sixty seconds.
 *
 * So the path moves first, on its own, while both still work:
 *
 *   1. (this change) serve the probe at both paths, identically;
 *   2. repoint `strange-rambling-svelte-watchdog.service` on the VPS at this
 *      path and confirm a 200 — a deliberate systemd edit, since the CI release
 *      path does not install that unit and `scripts/deploy.sh` must not be run;
 *   3. only then let the health application take the `/api/health` prefix;
 *   4. and in a later release, delete the old route.
 *
 * The handler is shared rather than copied, so the two cannot drift while both
 * are live.
 */
export { GET } from '$lib/workflows/engine-probe';
