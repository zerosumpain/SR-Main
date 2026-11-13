import { createHash, timingSafeEqual } from 'node:crypto';

/** Routes that act as the owner (send, or reveal the pairing QR). /health stays open for probes. */
export const PROTECTED_ROUTES: ReadonlySet<string> = new Set(['/send', '/send-media', '/qr', '/typing']);

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * Whether a request to `path` may proceed.
 *
 * The worker listens on loopback, but loopback is shared by every process on
 * the box, so a bearer token is what stands between "can open a socket" and
 * "can message anyone as the owner". Enforcement switches on with
 * WA_WORKER_TOKEN: callers send it whenever it is set, so the variable can be
 * added to the shared env file and both sides restarted without a window where
 * owner notifications fail. Compared over fixed-width digests so neither the
 * length nor a prefix leaks through timing.
 */
export function workerRequestAllowed(path: string, authorization: string | undefined, token: string | undefined): boolean {
  if (!PROTECTED_ROUTES.has(path) || !token) return true;
  const header = authorization ?? '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
  return supplied.length > 0 && timingSafeEqual(digest(supplied), digest(token));
}
