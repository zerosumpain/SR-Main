import { createHash } from 'node:crypto';

const salt = process.env.PUBLIC_REQUEST_SALT || 'strange-ramblings-public-v1';
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
