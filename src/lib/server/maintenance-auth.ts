// Shared auth for owner-triggered maintenance endpoints (research re-index /
// backfill). Two accepted callers: (1) the owner from a browser (normal Auth.js
// session), or (2) a CLI/one-off run from the box carrying a shared secret —
// used to drive long re-index passes from the VPS's own loopback, where there is
// no user session. The secret path is only active when MAINTENANCE_SECRET is set
// and is compared in constant time. The secret is never logged.

import { env } from '$env/dynamic/private';
import { timingSafeEqual } from 'node:crypto';

/** True iff the request carries a valid x-maintenance-secret. Only when the env is set. */
export function hasMaintenanceSecret(request: Request): boolean {
  const secret = env.MAINTENANCE_SECRET;
  if (!secret) return false;
  const provided = request.headers.get('x-maintenance-secret') ?? '';
  // Length-check first so timingSafeEqual doesn't throw on a mismatch (it requires
  // equal-length buffers); the early return leaks only length, not content.
  if (!provided || provided.length !== secret.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
  } catch {
    return false;
  }
}

/** Owner session OR a valid maintenance secret. */
export async function isMaintenanceAuthorized(request: Request, locals: App.Locals): Promise<boolean> {
  const session = await locals.auth();
  if (session?.user?.email) return true;
  return hasMaintenanceSecret(request);
}
