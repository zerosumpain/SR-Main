/**
 * Historical path for the workflow-engine liveness probe, kept because
 * `strange-rambling-svelte-watchdog.service` on the VPS still curls it every
 * sixty seconds and restarts the site on anything but a 200.
 *
 * The probe belongs to the platform and now lives at
 * /api/platform/workflow-engine. This alias exists so the watchdog can be
 * repointed in its own step, before the health application takes over the
 * /api/health prefix. Delete it once that unit no longer names this path.
 */
export { GET } from '$lib/workflows/engine-probe';
