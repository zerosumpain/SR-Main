import { createHash, timingSafeEqual } from 'node:crypto';

/** Compare non-empty secrets without leaking their value or length. */
export function secretsMatch(configured: string, provided: string | null | undefined): boolean {
  if (!configured) return false;
  if (typeof provided !== 'string' || provided.length === 0) return false;
  const configuredDigest = createHash('sha256').update(configured, 'utf8').digest();
  const providedDigest = createHash('sha256').update(provided, 'utf8').digest();
  return timingSafeEqual(configuredDigest, providedDigest);
}
