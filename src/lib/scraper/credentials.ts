import { db } from '$lib/db';
import { scraperCredentials, type ScraperCredential } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { encryptCredential, decryptCredential } from './crypto';

export interface SaveCredentialInput {
  domain: string;
  label: string;
  loginUrl?: string;
  loginStrategy: 'form' | 'script' | 'cookie';
  credential: Record<string, unknown>;
}

export async function saveCredential(input: SaveCredentialInput): Promise<Omit<ScraperCredential, never>> {
  const credentialEnc = encryptCredential(input.credential);
  const [row] = await db.insert(scraperCredentials).values({
    domain: input.domain,
    label: input.label,
    loginUrl: input.loginUrl,
    loginStrategy: input.loginStrategy,
    credentialEnc,
  }).returning();
  return row;
}

export interface CredentialForRunner {
  id: number;
  domain: string;
  loginUrl: string | null;
  loginStrategy: 'form' | 'script' | 'cookie';
  credential: Record<string, unknown>;
}

export async function loadCredentialForRunner(id: number): Promise<CredentialForRunner | null> {
  const rows = await db.select().from(scraperCredentials).where(eq(scraperCredentials.id, id));
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    domain: row.domain,
    loginUrl: row.loginUrl ?? null,
    loginStrategy: row.loginStrategy as CredentialForRunner['loginStrategy'],
    credential: decryptCredential(row.credentialEnc),
  };
}

export async function deleteCredential(id: number): Promise<void> {
  await db.delete(scraperCredentials).where(eq(scraperCredentials.id, id));
}
