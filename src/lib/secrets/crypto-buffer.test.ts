import { afterEach, describe, expect, it } from 'vitest';
import { decryptBuffer, encryptBuffer } from './crypto';

const previousKey = process.env.INTEGRATION_CREDENTIALS_KEY;

afterEach(() => {
  if (previousKey === undefined) delete process.env.INTEGRATION_CREDENTIALS_KEY;
  else process.env.INTEGRATION_CREDENTIALS_KEY = previousKey;
});

describe('encrypted binary payloads', () => {
  it('round-trips archive bytes without retaining plaintext', () => {
    process.env.INTEGRATION_CREDENTIALS_KEY = '11'.repeat(32);
    const plain = Buffer.from('private archive bytes');
    const encrypted = encryptBuffer(plain);
    expect(encrypted.includes(plain)).toBe(false);
    expect(decryptBuffer(encrypted)).toEqual(plain);
  });

  it('authenticates ciphertext before returning bytes', () => {
    process.env.INTEGRATION_CREDENTIALS_KEY = '22'.repeat(32);
    const encrypted = encryptBuffer(Buffer.from('private'));
    encrypted[encrypted.length - 1] ^= 1;
    expect(() => decryptBuffer(encrypted)).toThrow();
  });
});
