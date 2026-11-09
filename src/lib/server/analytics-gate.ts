import { createHmac, randomBytes } from 'node:crypto';
import { secretsMatch } from '$lib/server/secrets';

/**
 * Sign-in to the Umami dashboard with the site's login.
 *
 * Umami has no OpenID client, and the site's Auth.js session is host-only (it
 * never reaches analytics.strangeramblings.com, deliberately). So the dashboard
 * sits behind Caddy's forward_auth, and access is a PASS cookie that lives on
 * the analytics host alone:
 *
 *   /analytics (owner, site session)
 *     → 60 s single-use TICKET in the URL to analytics.…/__sr/enter
 *     → SR-Main (proxied) swaps it for a 12 h host-only PASS cookie, then
 *       signs the Umami UI in through Umami's own /sso hand-off page
 *     → every dashboard request: Caddy asks /api/analytics-gate/check
 *
 * Both credentials are HMACs over AUTH_SECRET, domain-separated by label, in
 * the shape of `$lib/server/vnc-ticket`. Umami's own password login is not
 * reachable from the internet (Caddy redirects it here); SR-Main uses it over
 * loopback to obtain the token it hands the browser.
 */

export const TICKET_TTL_SECONDS = 60;
export const PASS_TTL_SECONDS = 12 * 60 * 60;

/** `__Host-` needs https; a local preview is plain http on the tailnet. */
export function passCookieName(dev: boolean): string {
  return dev ? 'sr-analytics-pass' : '__Host-sr-analytics-pass';
}

function sign(secret: string, label: string, payload: string): string {
  return createHmac('sha256', secret).update(`${label}.${payload}`, 'utf8').digest('hex');
}

function mint(secret: string, label: string, ttl: number, nowMs: number): string {
  if (!secret) throw new Error('AUTH_SECRET is required for analytics access');
  const expires = Math.floor(nowMs / 1000) + ttl;
  const payload = `${expires}.${randomBytes(16).toString('hex')}`;
  return `${payload}.${sign(secret, label, payload)}`;
}

function verify(
  token: string | undefined | null,
  secret: string | undefined,
  label: string,
  ttl: number,
  nowMs: number,
): { nonce: string } | null {
  if (!token || !secret) return null;
  const match = /^(\d{10})\.([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(token);
  if (!match) return null;
  const expires = Number(match[1]);
  const now = Math.floor(nowMs / 1000);
  if (!Number.isSafeInteger(expires) || expires < now || expires > now + ttl) return null;
  return secretsMatch(sign(secret, label, `${match[1]}.${match[2]}`), match[3]) ? { nonce: match[2] } : null;
}

export const issueTicket = (secret: string, nowMs = Date.now()) =>
  mint(secret, 'analytics-ticket', TICKET_TTL_SECONDS, nowMs);
export const issuePass = (secret: string, nowMs = Date.now()) =>
  mint(secret, 'analytics-pass', PASS_TTL_SECONDS, nowMs);
export const verifyPass = (pass: string | undefined, secret: string | undefined, nowMs = Date.now()) =>
  verify(pass, secret, 'analytics-pass', PASS_TTL_SECONDS, nowMs) !== null;

/** Tickets are single-use: a copied hand-off URL is dead once followed. */
const spent = new Map<string, number>();

export function redeemTicket(ticket: string | undefined | null, secret: string | undefined, nowMs = Date.now()): boolean {
  const ok = verify(ticket, secret, 'analytics-ticket', TICKET_TTL_SECONDS, nowMs);
  if (!ok) return false;
  const now = Math.floor(nowMs / 1000);
  for (const [nonce, until] of spent) if (until < now) spent.delete(nonce);
  if (spent.has(ok.nonce)) return false;
  spent.set(ok.nonce, now + TICKET_TTL_SECONDS);
  return true;
}

/**
 * Where in the dashboard to land. Same rule as Umami's own /sso page (one
 * leading slash, no scheme), plus never back into the gate itself.
 */
export function safeDashboardPath(raw: string | null | undefined, fallback: string): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes(':') || raw.includes('\\')) return fallback;
  if (raw.startsWith('/__sr/') || raw === '/login' || raw.startsWith('/login/') || raw.startsWith('/sso')) return fallback;
  return raw.slice(0, 1000);
}

export type UmamiLogin = { baseUrl: string; username: string; password: string };

let cachedToken: { key: string; token: string } | null = null;

/**
 * A Umami UI token for the hand-off, from Umami's password login over
 * loopback. Cached: without Redis a Umami token does not expire (it is bound
 * to the password, so changing that password revokes it). Behind the gate a
 * token is useless on its own, because every dashboard API call also needs
 * the pass.
 */
export async function umamiUiToken(login: UmamiLogin, fetchFn: typeof fetch = fetch): Promise<string | null> {
  const key = `${login.baseUrl}|${login.username}`;
  if (cachedToken?.key === key) return cachedToken.token;
  try {
    const res = await fetchFn(`${login.baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: login.username, password: login.password }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { token?: string };
    if (!body.token) return null;
    cachedToken = { key, token: body.token };
    return body.token;
  } catch {
    return null;
  }
}

/** Test seam. */
export function resetAnalyticsGateState(): void {
  spent.clear();
  cachedToken = null;
}
