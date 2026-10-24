// The password a share link can ask for (24 Oct 2026). Until now the Spine
// hard-coded one password that every link had to give; now the owner chooses,
// per link, whether it asks for one and what it is. Main mints the verifier and
// stores it on the `project_share` row; the gateway carries it in the project
// claim (`project.pass`) and the app checks the recipient's answer against it.
// Main never sees an answer, so `checkSharePassword` exists for the tests and as
// the reference the app's copy must agree with.
//
//   scrypt$<salt b64url, 16 bytes>$<key b64url, 32 bytes>   N=16384 r=8 p=1
//   sha256$<64 hex>   LEGACY: the one Spine link minted under the shared
//                     password, backfilled by hand. Checked, never minted.
//
// The password is trimmed before hashing and before checking, so a stray space
// pasted from an email still opens the link.

import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * The projects whose app checks a link password: today only the Spine. A
 * password on any other project's link would be a promise nothing keeps, so the
 * share API refuses one. The card's `sharePassword` (src/routes/projects/cards.ts)
 * shows the Share panel's toggle and must name the same keys; a route may not
 * import another route, so the list the server reads lives here.
 */
export const SHARE_PASSWORD_KEYS: ReadonlySet<string> = new Set(['spine']);

export function sharePasswordAllowed(key: string): boolean {
  return SHARE_PASSWORD_KEYS.has(key);
}

export const SHARE_PASSWORD_MIN = 4;
export const SHARE_PASSWORD_MAX = 128;

const SCRYPT = { N: 16384, r: 8, p: 1 } as const;
const KEY_LEN = 32;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, KEY_LEN, SCRYPT, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

/** The trimmed password, or null when it is not a string of 4 to 128 characters. */
export function normaliseSharePassword(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const pw = raw.trim();
  return pw.length >= SHARE_PASSWORD_MIN && pw.length <= SHARE_PASSWORD_MAX ? pw : null;
}

/** A fresh `scrypt$salt$key` verifier for a password (trimmed first). */
export async function hashSharePassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password.trim(), salt);
  return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

/** Does `given` answer `verifier`? Anything unrecognised is false. Constant-time compare. */
export async function checkSharePassword(given: string, verifier: string): Promise<boolean> {
  const pw = given.trim();
  const legacy = /^sha256\$([0-9a-f]{64})$/.exec(verifier);
  if (legacy) {
    const want = Buffer.from(legacy[1], 'hex');
    return timingSafeEqual(createHash('sha256').update(pw).digest(), want);
  }
  const m = /^scrypt\$([A-Za-z0-9_-]{16,64})\$([A-Za-z0-9_-]{32,128})$/.exec(verifier);
  if (!m) return false;
  const want = Buffer.from(m[2], 'base64url');
  if (want.length !== KEY_LEN) return false;
  const got = await derive(pw, Buffer.from(m[1], 'base64url'));
  return timingSafeEqual(got, want);
}
