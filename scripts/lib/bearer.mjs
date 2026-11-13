import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Constant-time check of an `Authorization: Bearer <token>` header.
 * Compares fixed-width digests, so neither the token's length nor a matching
 * prefix is observable through response timing. Same rule as
 * `assertBearerSecret` in src/lib/server/service-auth.ts, for plain-Node scripts.
 *
 * @param {string | undefined} header
 * @param {string | undefined} token
 * @returns {boolean}
 */
export function bearerMatches(header, token) {
  if (!token || typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const digest = (/** @type {string} */ value) => createHash('sha256').update(value, 'utf8').digest();
  return timingSafeEqual(digest(header.slice(7)), digest(token));
}
