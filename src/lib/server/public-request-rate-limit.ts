import { createHash } from 'node:crypto';

// A secret salt, so a stored hash cannot be reversed by hashing the whole IPv4
// space with a constant read out of this (public) repository.
// `REQUEST_HASH_SALT` is the name: the `PUBLIC_` prefix reads as "exposed to
// the browser" in SvelteKit terms, which a salt must never be. The old name
// is still honoured so a host that set it keeps its hashes, and the constant
// remains only as the last resort for a box with neither.
//
// Changing the salt changes every hash from then on. Nothing joins across
// time beyond a day: the blog-comment daily ceiling counts rows by hash over
// the last 24 hours (so a rotation resets it once), and access_request.ip_hash
// is recorded, never looked up.
const salt =
  process.env.REQUEST_HASH_SALT || process.env.PUBLIC_REQUEST_SALT || 'strange-ramblings-public-v1';
const hits = new Map<string, number[]>();
const maxKeys = 20_000;

export function hashIp(ip: string | null | undefined): string {
  return createHash('sha256').update(`${salt}:${ip || 'unknown'}`).digest('hex').slice(0, 32);
}

export function clientIp(request: Request, getClientAddress: () => string): string {
  const cf = request.headers.get('cf-connecting-ip');
  if (cf) return cf.trim();
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const parts = forwarded.split(',').map((value) => value.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  try {
    return getClientAddress();
  } catch {
    return 'unknown';
  }
}

export function rateLimit(bucket: string, ipHash: string, max: number, windowMs: number): boolean {
  if (hits.size > maxKeys) sweep();
  if (hits.size > maxKeys) hits.clear();
  const key = `${bucket}:${ipHash}`;
  const now = Date.now();
  const recent = (hits.get(key) || []).filter((time) => now - time < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}

function sweep(): void {
  const now = Date.now();
  for (const [key, times] of hits) {
    const recent = times.filter((time) => now - time < 60 * 60_000);
    if (recent.length) hits.set(key, recent);
    else hits.delete(key);
  }
}

let lastSweep = Date.now();
export function maybeSweep(): void {
  if (Date.now() - lastSweep < 5 * 60_000) return;
  lastSweep = Date.now();
  sweep();
}
