import { createHmac, randomBytes } from 'node:crypto';
import { secretsMatch } from '$lib/server/secrets';

/**
 * A short-lived capability for loading ONE build's preview assets.
 *
 * Why this has to exist, given the preview already requires an owner session:
 *
 * Generated apps are served under `GENERATED_CONTENT_CSP`, whose `sandbox`
 * directive deliberately omits `allow-same-origin` so agent-written code cannot
 * act with strangeramblings.com's authority. That gives the document an OPAQUE
 * origin — and the browser then treats every subresource it requests as
 * cross-site, so the `SameSite=Lax` Auth.js cookie is withheld.
 *
 * The result was a preview that looked broken in a very specific way: the
 * top-level navigation is same-site, so the HTML arrived; every stylesheet,
 * script and chapter link that HTML asked for arrived without a cookie, failed
 * `isOwnerRequest`, and 404ed. A studio explainer rendered as `<main
 * id="contents"></main>` and nothing else — a blank page whose own upstream log
 * showed a single `GET /` and not one asset request. A single-file build with
 * everything inline was unaffected, which is why this survived: it only bites
 * apps that have subresources at all.
 *
 * Adding `allow-same-origin` would fix the symptom by removing the isolation
 * the sandbox exists for, so instead the proxy mints one of these and injects
 * it into the `<base href>`. Every relative URL in the app then resolves
 * through a prefix that carries its own authorisation, and no cookie is needed.
 *
 * What it is safe to hand a generated app:
 *
 *  - It is bound to a single `buildId`, so it cannot read another build.
 *  - It expires, and it carries a random nonce, so it cannot be guessed.
 *  - It is only ever checked by the preview route. It authenticates nothing
 *    else on the site.
 *  - The app can read it out of its own URL, but the only thing it unlocks is
 *    files that app already has. There is no escalation to leak.
 *  - The proxy sets `Referrer-Policy: no-referrer`, so it does not travel to
 *    third parties in a Referer header.
 */
export const PREVIEW_TICKET_TTL_SECONDS = 2 * 60 * 60;

/**
 * Path segment that carries the ticket, e.g.
 * `/api/jkai/proxy/<id>/_t_<ticket>/explainer-kit/shell.js`.
 *
 * A prefix rather than a bare segment so a real asset path can never be
 * mistaken for a ticket — `_t_` is not a leading substring of anything the
 * builder writes, and an app that genuinely has such a directory still resolves
 * because the segment is only consumed when the rest of it parses AND verifies.
 */
export const PREVIEW_TICKET_PREFIX = '_t_';

function signature(secret: string, buildId: string, payload: string): string {
  // buildId is inside the signed material, not merely compared afterwards, so
  // a ticket minted for one build cannot be replayed against another.
  return createHmac('sha256', secret).update(`jkai-preview.${buildId}.${payload}`, 'utf8').digest('hex');
}

/** Mint a ticket for `buildId`. Throws rather than returning an unsigned one. */
export function issuePreviewTicket(buildId: string, secret: string, nowMs = Date.now()): string {
  if (!secret) throw new Error('AUTH_SECRET is required to issue a preview ticket');
  if (!buildId) throw new Error('buildId is required to issue a preview ticket');
  const expires = Math.floor(nowMs / 1000) + PREVIEW_TICKET_TTL_SECONDS;
  const payload = `${expires}.${randomBytes(16).toString('hex')}`;
  return `${payload}.${signature(secret, buildId, payload)}`;
}

export function verifyPreviewTicket(
  ticket: string | undefined,
  buildId: string | undefined,
  secret: string | undefined,
  nowMs = Date.now(),
): boolean {
  if (!ticket || !buildId || !secret) return false;
  const match = /^(\d{10})\.([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(ticket);
  if (!match) return false;
  const expires = Number(match[1]);
  const now = Math.floor(nowMs / 1000);
  // The upper bound rejects a ticket minted with a longer TTL than this build
  // of the code would issue — the same belt-and-braces check vnc-ticket makes.
  if (!Number.isSafeInteger(expires) || expires < now || expires > now + PREVIEW_TICKET_TTL_SECONDS) {
    return false;
  }
  const payload = `${match[1]}.${match[2]}`;
  return secretsMatch(signature(secret, buildId, payload), match[3]);
}

/**
 * Split a proxy path into its ticket (if the first segment carries one) and the
 * asset path underneath.
 *
 * Purely syntactic — it does not verify. The caller verifies, and MUST treat a
 * present-but-invalid ticket as unauthorised rather than falling through to the
 * stripped path, or the prefix would become a way to rewrite request paths.
 */
export function splitPreviewTicket(rawPath: string): { ticket: string | null; path: string } {
  const clean = rawPath.replace(/^\/+/, '');
  const slash = clean.indexOf('/');
  const first = slash === -1 ? clean : clean.slice(0, slash);
  if (!first.startsWith(PREVIEW_TICKET_PREFIX)) return { ticket: null, path: clean };
  return {
    ticket: first.slice(PREVIEW_TICKET_PREFIX.length),
    path: slash === -1 ? '' : clean.slice(slash + 1),
  };
}
