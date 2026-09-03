import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { error } from '@sveltejs/kit';
import { rateLimit, type RateLimitOptions } from './rate-limit';

interface RequestContext {
  request: Request;
  getClientAddress?: () => string;
}

interface PublicGuardOptions {
  scope: string;
  perClient: RateLimitOptions;
  global: RateLimitOptions;
}

function clientKey(ctx: RequestContext): string {
  // Production is loopback-bound behind Cloudflare Tunnel, which overwrites
  // CF-Connecting-IP. Never consume X-Forwarded-For: callers can append/spoof
  // entries and different proxies disagree about which side is authoritative.
  const edge = ctx.request.headers.get('cf-connecting-ip')?.trim() ?? '';
  let address = isIP(edge) ? edge : '';
  if (!address) {
    try { address = ctx.getClientAddress?.() ?? ''; } catch { address = ''; }
  }
  return createHash('sha256').update(address || 'unknown').digest('hex').slice(0, 24);
}

/** Apply both abuse-per-client and total-cost backstops before expensive work. */
export function assertPublicRequestBudget(ctx: RequestContext, options: PublicGuardOptions): void {
  const client = rateLimit(`public:client:${options.scope}:${clientKey(ctx)}`, options.perClient);
  // Do not spend a global token for a caller already over its client budget;
  // otherwise one noisy address can drain the shared pool with rejected calls.
  const global = client.allowed
    ? rateLimit(`public:global:${options.scope}`, options.global)
    : null;
  const denied = !client.allowed ? client : global && !global.allowed ? global : null;
  if (denied) {
    throw error(429, `Rate limit exceeded; retry in ${Math.ceil(denied.retryAfterMs / 1000)}s`);
  }
}
