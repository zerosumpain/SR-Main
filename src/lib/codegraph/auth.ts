/**
 * Shared bearer check for the codegraph service-to-service routes.
 *
 * Reuses `CLAUDE_CHANGELOG_SECRET` rather than minting a second secret. It is
 * the same trust boundary — homeserv posting its own session-derived data to
 * the VPS — and every additional secret is another thing to escrow, rotate and
 * forget to set. Forgetting to set one is not hypothetical here: this endpoint's
 * sibling spent its whole life unauthenticated on the public internet because
 * an unset secret and an authorised caller took the same branch.
 *
 * So: fails CLOSED in production. In production a missing secret is a
 * misconfiguration, and the honest answer to a misconfigured auth check is to
 * refuse, not to admit everyone.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';

/** Constant-time compare over fixed-width digests (unequal lengths cannot short-circuit). */
function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(
    createHash('sha256').update(a).digest(),
    createHash('sha256').update(b).digest(),
  );
}

export function codegraphServiceAuthorized(request: Request): boolean {
  const secret = env.CLAUDE_CHANGELOG_SECRET;
  if (!secret) return dev;
  return safeEqual(request.headers.get('authorization') ?? '', `Bearer ${secret}`);
}
