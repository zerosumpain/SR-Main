import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const VNC_ACCESS_COOKIE = '__Secure-sr-vnc-access';
export const VNC_ACCESS_TTL_SECONDS = 15 * 60;

function signature(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(`vnc-access.${payload}`, 'utf8').digest('hex');
}

/** Mint a narrow, short-lived credential for Caddy's VNC forward-auth check. */
export function issueVncAccessTicket(secret: string, nowMs = Date.now()): string {
  if (!secret) throw new Error('AUTH_SECRET is required to issue VNC access');
  const expires = Math.floor(nowMs / 1000) + VNC_ACCESS_TTL_SECONDS;
  const payload = `${expires}.${randomBytes(16).toString('hex')}`;
  return `${payload}.${signature(secret, payload)}`;
}

export function verifyVncAccessTicket(
  ticket: string | undefined,
  secret: string | undefined,
  nowMs = Date.now(),
): boolean {
  if (!ticket || !secret) return false;
  const match = /^(\d{10})\.([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(ticket);
  if (!match) return false;
  const expires = Number(match[1]);
  const now = Math.floor(nowMs / 1000);
  if (!Number.isSafeInteger(expires) || expires < now || expires > now + VNC_ACCESS_TTL_SECONDS) {
    return false;
  }
  const payload = `${match[1]}.${match[2]}`;
  return timingSafeEqual(
    Buffer.from(signature(secret, payload), 'hex'),
    Buffer.from(match[3], 'hex'),
  );
}
