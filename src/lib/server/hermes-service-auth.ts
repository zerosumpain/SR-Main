import { env } from '$env/dynamic/private';
import os from 'node:os';
import { error } from '@sveltejs/kit';

/**
 * Host + bearer gate for the `/api/admin/hermes/*` proxy endpoints — the
 * server-to-server channel the VPS uses to read/drive the Hermes engine that
 * lives only on homeserv (state.db + the `hermes` CLI + the gateway).
 *
 * Mirrors `workflows/scraper/service-auth.ts`, with one deliberate difference:
 * the bearer is **mandatory**, not optional. Unlike the scraper proxy (which
 * carries no sensitive payload), these endpoints expose full session
 * transcripts, cost data, and service-restart / cron-mutation control — so an
 * absent/mismatched token is rejected, never waved through.
 *
 *  1. Serving host MUST be homeserv (503 otherwise) — keeps the sqlite/CLI
 *     bodies on the host that owns the data and prevents a misconfigured proxy
 *     chain from looping back to the VPS.
 *  2. `Authorization: Bearer <HERMES_BRIDGE_SECRET>` MUST match (401 otherwise).
 *     HERMES_BRIDGE_SECRET is already present + identical on both hosts.
 *
 * The Auth.js cookie gate is separately dropped for this subtree via
 * PUBLIC_PATHS in src/lib/auth.ts — the bearer here is the real gate.
 */
export function assertHermesServiceRequest(request: Request): void {
  if (os.hostname() !== 'homeserv' && !process.env.HERMES_ALLOW_NON_HOMESERV) {
    throw error(503, `Hermes admin endpoints are only served from homeserv (host='${os.hostname()}').`);
  }
  const expected = env.HERMES_BRIDGE_SECRET;
  if (!expected) throw error(503, 'HERMES_BRIDGE_SECRET not configured on this host');
  const auth = request.headers.get('authorization') ?? '';
  const supplied = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (supplied !== expected) throw error(401, 'Invalid or missing Hermes service token');
}
