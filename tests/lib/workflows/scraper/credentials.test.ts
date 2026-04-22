import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: { SCRAPER_VAULT_KEY: '2'.repeat(64) } }));

const { dbStore, db } = vi.hoisted(() => {
  const dbStore: any[] = [];
  const db: any = {
    insert: vi.fn(() => ({
      values: vi.fn((v: any) => ({
        returning: vi.fn(async () => { dbStore.push({ id: dbStore.length + 1, ...v }); return [dbStore.at(-1)]; }),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => dbStore),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(async () => ({})),
    })),
  };
  return { dbStore, db };
});

vi.mock('$lib/db', () => ({ db }));
vi.mock('$lib/db/schema', () => ({ scraperCredentials: { id: 'id', domain: 'domain' } }));
vi.mock('drizzle-orm', () => ({ eq: (a: any, b: any) => ({ a, b }) }));

import { saveCredential, loadCredentialForRunner } from '$lib/workflows/scraper/credentials';

describe('credentials', () => {
  beforeEach(() => { dbStore.length = 0; });

  it('saves a credential with encrypted blob and never returns the plaintext', async () => {
    const row = await saveCredential({
      domain: 'civilservicejobs.gov.uk',
      label: 'main',
      loginStrategy: 'form',
      loginUrl: 'https://civilservicejobs.gov.uk/login',
      credential: { username: 'me', password: 'secret' },
    });
    expect(row.credentialEnc).toBeDefined();
    expect(row.credentialEnc).not.toContain('secret');
    expect((row as any).credential).toBeUndefined();
  });

  it('decrypts a credential for the runner only', async () => {
    await saveCredential({
      domain: 'x.com', label: 'l', loginStrategy: 'form',
      credential: { username: 'u', password: 'p' },
    });
    const decrypted = await loadCredentialForRunner(1);
    expect(decrypted).toEqual(expect.objectContaining({
      domain: 'x.com',
      credential: { username: 'u', password: 'p' },
    }));
  });
});
