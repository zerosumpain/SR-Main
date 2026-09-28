import { createHash, timingSafeEqual } from 'node:crypto';
import { getToken } from '@auth/core/jwt';

/** Each caller holds one audience key; only Main holds the browser signing secret. */
export function sessionCaller(audience: unknown, bearer: string, encodedKeys: string | undefined): boolean {
  if (typeof audience !== 'string' || !audience || audience.length > 80) return false;
  let keys: Record<string, unknown>;
  try { keys = JSON.parse(encodedKeys ?? '{}'); } catch { return false; }
  if (!keys || typeof keys !== 'object' || Array.isArray(keys)) return false;
  const expected = Object.hasOwn(keys, audience) ? keys[audience] : null;
  if (typeof expected !== 'string' || expected.length < 32) return false;
  if (Object.values(keys).filter(value => value === expected).length !== 1) return false;
  const digest = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(digest(bearer), digest(expected));
}

export async function browserSessionEmail(cookie: string, secret: string): Promise<string | null> {
  const token = await getToken({ req: { headers: new Headers({ cookie }) }, secret, secureCookie: true });
  if (!token || (token.registrant != null && token.registrant !== false) || typeof token.email !== 'string') return null;
  return token.email.trim().toLowerCase() || null;
}
