import { describe, it, expect, beforeAll } from 'vitest';

// 32 random bytes as hex (deterministic for tests).
const TEST_KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

beforeAll(() => {
  process.env.INTEGRATION_CREDENTIALS_KEY = TEST_KEY;
});

describe('integrations/crypto', () => {
  it('round-trips a payload', async () => {
    const { encryptPayload, decryptPayload } = await import('$lib/integrations/crypto');
    const plain = JSON.stringify({ username: 'john', password: 'hunter2' });
    const enc = encryptPayload(plain);
    expect(enc).toMatch(/^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/);
    expect(decryptPayload(enc)).toBe(plain);
  });

  it('detects tampering via auth tag', async () => {
    const { encryptPayload, decryptPayload } = await import('$lib/integrations/crypto');
    const enc = encryptPayload('hello');
    const [iv, tag, ct] = enc.split(':');
    // Flip the last byte of ciphertext.
    const flippedCt = ct.slice(0, -2) + (ct.slice(-2) === 'ff' ? '00' : 'ff');
    const tampered = `${iv}:${tag}:${flippedCt}`;
    expect(() => decryptPayload(tampered)).toThrow();
  });

  it('rejects malformed encrypted strings', async () => {
    const { decryptPayload } = await import('$lib/integrations/crypto');
    expect(() => decryptPayload('not-a-real-cipher')).toThrow(/Malformed/);
  });

  it('rejects a missing or wrong-length key', async () => {
    const original = process.env.INTEGRATION_CREDENTIALS_KEY;
    process.env.INTEGRATION_CREDENTIALS_KEY = 'tooshort';
    // Re-import to pick up the new env (vitest caches modules).
    await expect(async () => {
      const mod = await import('$lib/integrations/crypto?bust=' + Date.now());
      mod.encryptPayload('x');
    }).rejects.toThrow(/64 hex chars/);
    process.env.INTEGRATION_CREDENTIALS_KEY = original;
  });
});
