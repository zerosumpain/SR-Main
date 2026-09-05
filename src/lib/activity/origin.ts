/**
 * The public origin a provider must send the browser back to.
 *
 * Pure, so the precedence is unit tested. `PUBLIC_BASE_URL` wins when set;
 * `PUBLIC_SITE_URL` is what both hosts actually define; and the request's own
 * origin is the fallback — on the VPS adapter-node builds it from `ORIGIN`,
 * which is how the Gmail OAuth flow has always found its way home.
 *
 * There is deliberately no `http://localhost:5173` default: that string is what
 * Steam sent the owner to from production on 2026-09-05.
 */
export function activityPublicOrigin(
  requestUrl: URL,
  env: Record<string, string | undefined>,
): string {
  const configured = (env.PUBLIC_BASE_URL ?? env.PUBLIC_SITE_URL ?? '').trim();
  return (configured || requestUrl.origin).replace(/\/$/, '');
}
