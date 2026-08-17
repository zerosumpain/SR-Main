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
import { buildFromAuthHeader } from '$lib/jkai/bridge-token';

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

/**
 * A RUNNING BUILD, authenticating as itself.
 *
 * The pull channel could never work inside a build, and the reason was a name
 * collision rather than anything to do with this file. `executor.ts` sets
 * `JKAI_BRIDGE_TOKEN` to a per-build signed token for the tool bridge, and
 * `codegraph-query.mjs` reads `JKAI_BRIDGE_TOKEN || CLAUDE_CHANGELOG_SECRET`.
 * So inside a build the script always picked the tool-bridge token, sent it
 * here, and this module compared it against the changelog secret. Always 401,
 * for every build, since the day it shipped — observed once, in build
 * 5bed21a0, as a bare `codegraph: 401` in a recorded bash action.
 *
 * Accepting the build's own credential is the right fix rather than teaching
 * the script a third variable: the build already holds a legitimate,
 * short-scoped, per-build secret, and using it means a query can be attributed
 * to the build that actually made it instead of being taken on trust from the
 * request body.
 */
export function codegraphBuildAuthorized(request: Request): string | null {
  return buildFromAuthHeader(request.headers.get('authorization'));
}

/**
 * Why a request could not be authorised, for the response body.
 *
 * A server with no secret configured is a SERVER fault, and answering it with a
 * bare "unauthorized" tells the caller to go and check its own credentials —
 * which is exactly the wrong place to look, and cost real time when the app
 * process was running with a stale environment and every build's pull request
 * came back 401 with no way to tell why.
 */
export function codegraphAuthFailure(request: Request): string {
  if (!env.CLAUDE_CHANGELOG_SECRET) return 'server has no service secret configured';
  return request.headers.get('authorization')
    ? 'bearer token matched neither the service secret nor a live build token'
    : 'no session and no bearer token';
}
