import { createHash, createHmac } from 'node:crypto';
import { secretsMatch } from '$lib/server/secrets';

/**
 * Who is signed in to the phone that scanned a pairing code.
 *
 * A code shown at /welcome is minted for whoever is signed in to THAT browser.
 * On 2026-10-19 the owner's browser was signed in when his son scanned the
 * codes from it, and the son's phone became the owner's — owner chat, and his
 * Apple Health and location uploaded into the owner's record. Nothing in the
 * code said whose phone it was going on to.
 *
 * So a scanned code (`kind: 'scan'`, `$lib/server/native-auth`) is redeemed
 * only by a phone that proves who it is signed in as, and only when that is
 * the person the code was minted for. The proof is either the site credential
 * the phone already holds, or one of these: a ten-minute assertion minted by a
 * fresh Google or Apple sign-in in the app, bound to the hash of the one code
 * it was asked for. It grants nothing by itself — it only lets that code be
 * redeemed by its own person — which is why the owner may get one too, where
 * the registration sign-in refuses him.
 */

export const PAIR_IDENTITY_TTL_MS = 10 * 60 * 1000;

/** The hex SHA-256 the app sends instead of the code itself while it signs in. */
export function pairCodeHash(code: string): string {
  return createHash('sha256').update(code.trim()).digest('hex');
}

export function isPairCodeHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function signature(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(`sr-pair-identity.${payload}`, 'utf8').digest('base64url');
}

/** Mint an assertion that `email` signed in, for the code with this hash. Throws rather than returning an unsigned one. */
export function mintPairIdentity(email: string, codeHash: string, secret: string, nowMs = Date.now()): string {
  if (!secret) throw new Error('AUTH_SECRET is required to confirm who is pairing');
  const e = email.trim().toLowerCase();
  if (!e) throw new Error('A pairing identity needs an email');
  if (!isPairCodeHash(codeHash)) throw new Error('A pairing identity needs a code hash');
  const payload = Buffer.from(JSON.stringify({ e, h: codeHash, x: nowMs + PAIR_IDENTITY_TTL_MS })).toString('base64url');
  return `${payload}.${signature(secret, payload)}`;
}

/** The email an assertion vouches for, if it is genuine, fresh, and for THIS code. Otherwise null. */
export function verifyPairIdentity(
  assertion: unknown,
  code: string,
  secret: string | undefined,
  nowMs = Date.now(),
): string | null {
  if (!secret || typeof assertion !== 'string' || assertion.length > 1024) return null;
  const match = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/.exec(assertion);
  if (!match) return null;
  if (!secretsMatch(signature(secret, match[1]), match[2])) return null;
  let claims: { e?: unknown; h?: unknown; x?: unknown };
  try {
    claims = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof claims.e !== 'string' || !claims.e) return null;
  if (claims.h !== pairCodeHash(code)) return null;
  // The upper bound refuses one minted with a longer life than this code issues.
  if (typeof claims.x !== 'number' || claims.x < nowMs || claims.x > nowMs + PAIR_IDENTITY_TTL_MS) return null;
  return claims.e;
}
