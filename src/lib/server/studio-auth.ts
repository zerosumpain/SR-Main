import { timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';

/**
 * A service credential for ONE endpoint: `POST /api/jkai/studio`.
 *
 * Why it exists: starting a studio build is otherwise owner-session-only, so
 * nothing unattended — a script, an agent, a cron — can kick one off, and every
 * run needs a human to click. This is the narrowest possible opening: one
 * route, one non-destructive action.
 *
 * Why it is safe to open THAT action specifically: creating a build is
 * reversible (it can be stopped and deleted), it publishes nothing (publishing
 * is a separate owner-only step), it is bounded by STUDIO_BUDGET, and the
 * existing 3/hour rate limit still applies.
 *
 * Deliberately NOT loopback-gated, unlike `hasMaintenanceSecret`. On this VPS
 * every request arrives through cloudflared and therefore appears to come from
 * 127.0.0.1 — the same property that turned AUTH_BYPASS=1 into a public /admin
 * exposure on 2026-07-24. Loopback is not a security property here, so pairing
 * it with a secret would only imply a protection that does not exist. The token
 * alone is the control, which is why the length floor below is not optional.
 */
const MIN_TOKEN_LEN = 32;

export function hasStudioServiceToken(request: Request): boolean {
  const secret = env.STUDIO_SERVICE_TOKEN;
  // Unset means the door does not exist at all — no default, no dev fallback.
  if (!secret || secret.length < MIN_TOKEN_LEN) return false;
  const header = request.headers.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  // Length-check first: timingSafeEqual throws on unequal buffers. The early
  // return leaks length only, never content.
  if (!provided || provided.length !== secret.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(secret));
  } catch {
    return false;
  }
}
