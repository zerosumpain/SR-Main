// The one place a pairing code is minted, whoever asks: a person's page,
// /welcome, or the household push that answers a phone asking for the site.
//
// `createPairingCode` and `createScanCode` each DELETE the email's previous
// code of that kind, which is right for a secret (one live code per person)
// and was wrong for the callers: the push re-minted every cycle and killed
// the code the owner had just put on his screen, and his /welcome code and his
// /admin code cancelled each other. So this remembers the plaintext of what it
// minted, per person and kind, and hands the same code back while it is live —
// the database holds only the hash, so there is nothing to read it back from.
// Lost on restart, which costs one rotation.

import { createPairingCode, createScanCode, isPairingCodeLive } from './native-auth';

export type PairingKind = 'pair' | 'scan';

/** A held code with less life than this left is replaced, not re-sent. */
export const REUSE_FLOOR_MS = 2 * 60_000;

const held = new Map<string, { code: string; expiresAt: Date }>();

const keyOf = (email: string, kind: PairingKind) => `${kind}:${email.trim().toLowerCase()}`;

/** For tests: forget every held code. */
export function resetPairingCodes(): void {
  held.clear();
}

/** Stop holding a code for them — it stays live until it expires or is redeemed. */
export function forgetPairingCode(email: string, kind: PairingKind): void {
  held.delete(keyOf(email, kind));
}

/**
 * This person's live code of this kind: the one already held, unless it is
 * nearly spent, no longer live (redeemed, or minted by another process), or
 * `fresh` was asked for — then a new one, which retires the old.
 */
export async function pairingCode(
  email: string,
  kind: PairingKind,
  opts: { fresh?: boolean; now?: Date } = {},
): Promise<{ code: string; expiresAt: Date; reused: boolean }> {
  const e = email.trim().toLowerCase();
  if (!e) throw new Error('A pairing code needs a person.');
  const key = keyOf(e, kind);
  const now = opts.now ?? new Date();
  if (!opts.fresh) {
    const h = held.get(key);
    if (h && h.expiresAt.getTime() - now.getTime() > REUSE_FLOOR_MS && (await isPairingCodeLive(h.code, kind))) {
      return { ...h, reused: true };
    }
  }
  const minted = kind === 'scan' ? await createScanCode(e) : await createPairingCode(e);
  held.set(key, minted);
  return { ...minted, reused: false };
}
