import { createHash, randomBytes } from 'node:crypto';
import { db } from '$lib/db';
import { webdavCredentials } from '$lib/db/schema';
import { and, eq, isNull } from 'drizzle-orm';

// ──────── token generation ─────────────────────────────────────────────
// 32 random bytes, base64url-encoded → ~43 chars. Fits in a Finder password
// dialog without wrapping. Shown to the user once at creation; the DB only
// stores the sha256.

export function generateSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

// ──────── basic-auth header parsing ────────────────────────────────────

export function parseBasicAuth(headerValue: string | null): { user: string; pass: string } | null {
  if (!headerValue) return null;
  const m = headerValue.match(/^Basic\s+(.+)$/i);
  if (!m) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(m[1], 'base64').toString('utf8');
  } catch {
    return null;
  }
  const idx = decoded.indexOf(':');
  if (idx < 0) return null;
  return { user: decoded.slice(0, idx), pass: decoded.slice(idx + 1) };
}

// ──────── credential lookup ────────────────────────────────────────────
// Returns the row if the secret matches an unrevoked credential, else null.
// Updates last_used_at fire-and-forget so a slow DB write doesn't stall
// the hot path.

export type DavAuthContext = {
  credentialId: string;
  ownerEmail: string;
  label: string;
};

export async function verifySecret(secret: string): Promise<DavAuthContext | null> {
  if (!secret || secret.length < 16) return null;
  const hash = hashSecret(secret);
  const [row] = await db
    .select()
    .from(webdavCredentials)
    .where(and(eq(webdavCredentials.secretHash, hash), isNull(webdavCredentials.revokedAt)))
    .limit(1);
  if (!row) return null;
  // Async last-used bump.
  void db
    .update(webdavCredentials)
    .set({ lastUsedAt: new Date() })
    .where(eq(webdavCredentials.id, row.id))
    .catch(() => {});
  return { credentialId: row.id, ownerEmail: row.ownerEmail, label: row.label };
}
