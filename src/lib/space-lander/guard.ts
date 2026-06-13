import { createHash, randomBytes } from 'node:crypto';

// Lightweight, dependency-free guards for the public Terminal Descent
// leaderboard endpoints. In-memory state resets on deploy — acceptable for a
// personal arcade board; the load-bearing protection is server-side score
// recomputation + plausibility (see score.ts), this just blunts flooding.

const SALT = process.env.SPACE_LANDER_SALT || 'terminal-descent-v1';

export function hashIp(ip: string | null | undefined): string {
  return createHash('sha256')
    .update(SALT + ':' + (ip || 'unknown'))
    .digest('hex')
    .slice(0, 32);
}

export function newNonce(): string {
  return randomBytes(16).toString('hex');
}

// Best-effort true client IP. Behind Cloudflare/Caddy the left-most
// X-Forwarded-For token is attacker-controllable (a client can pre-seed it),
// so prefer Cloudflare's CF-Connecting-IP (the edge overwrites it), then the
// LAST XFF hop (added by our own proxy), then the socket address. This keeps
// the rate-limit key from being trivially rotated to bypass the limiter.
export function clientIp(
  request: Request,
  getClientAddress: () => string,
): string {
  const cf = request.headers.get('cf-connecting-ip');
  if (cf) return cf.trim();
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  try {
    return getClientAddress();
  } catch {
    return 'unknown';
  }
}

// Simple sliding-window rate limiter keyed by `${bucket}:${ipHash}`. The map is
// hard-capped so a flood of distinct keys can't grow it without bound.
const hits = new Map<string, number[]>();
const MAX_KEYS = 20_000;

export function rateLimit(bucket: string, ipHash: string, max: number, windowMs: number): boolean {
  if (hits.size > MAX_KEYS) sweepNow();
  if (hits.size > MAX_KEYS) hits.clear(); // last-resort bound
  const key = `${bucket}:${ipHash}`;
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    hits.set(key, arr);
    return false; // limited
  }
  arr.push(now);
  hits.set(key, arr);
  return true; // allowed
}

function sweepNow() {
  const now = Date.now();
  for (const [k, arr] of hits) {
    const kept = arr.filter((t) => now - t < 60 * 60_000);
    if (kept.length) hits.set(k, kept);
    else hits.delete(k);
  }
}

// Time-gate for the periodic DB cleanup of expired sessions (called from the
// session route). Returns true at most once every 5 minutes.
let lastDbSweep = 0;
export function dueForDbSweep(): boolean {
  const now = Date.now();
  if (now - lastDbSweep < 5 * 60_000) return false;
  lastDbSweep = now;
  return true;
}

// Opportunistic cleanup so the maps don't grow unbounded on a long-lived process.
let lastSweep = Date.now();
export function maybeSweep() {
  const now = Date.now();
  if (now - lastSweep < 5 * 60_000) return;
  lastSweep = now;
  for (const [k, arr] of hits) {
    const kept = arr.filter((t) => now - t < 60 * 60_000);
    if (kept.length) hits.set(k, kept);
    else hits.delete(k);
  }
}
