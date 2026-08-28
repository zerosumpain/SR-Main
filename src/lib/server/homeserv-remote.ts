/**
 * Where the homeserv SvelteKit instance is, as seen from the VPS.
 *
 * Production runs on the VPS and reaches homeserv over Tailscale. Only the
 * security panel still needs this — it shows both hosts' posture side by side,
 * and the second host has to be addressed somehow.
 *
 * This used to be the host switch for a whole Hermes admin surface (session
 * store, `hermes` CLI, gateway control). That surface is gone; what is left is
 * one base URL and the boolean that says whether we are already on the box.
 */
import { env } from '$env/dynamic/private';
import os from 'node:os';

export const IS_HOMESERV = os.hostname() === 'homeserv';

/** Base URL of the homeserv SvelteKit instance. Prefer an explicit
 *  HOMESERV_ADMIN_URL; else derive from SCRAPER_SERVICE_URL (the VPS already
 *  sets it to the homeserv :5173 host). Null on homeserv → use the local path. */
export function homeservBase(): string | null {
  const explicit = env.HOMESERV_ADMIN_URL ?? env.HERMES_ADMIN_SERVICE_URL;
  if (explicit) return explicit.replace(/\/+$/, '');
  const svc = env.SCRAPER_SERVICE_URL;
  if (!svc) return null;
  try {
    const u = new URL(svc);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}
