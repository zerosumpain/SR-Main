import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const BUFFER_MAGIC = Buffer.from('JKAI1', 'ascii');

function getKey(): Buffer {
  const hex = process.env.INTEGRATION_CREDENTIALS_KEY;
  if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error('INTEGRATION_CREDENTIALS_KEY must be 64 hex chars (32 bytes)');
  }
  return Buffer.from(hex, 'hex');
}

/** Format: `<iv-hex>:<auth-tag-hex>:<ciphertext-hex>`. */
export function encryptPayload(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`;
}

export function decryptPayload(enc: string): string {
  const parts = enc.split(':');
  if (parts.length !== 3) throw new Error('Malformed encrypted payload');
  const [ivH, tagH, ctH] = parts;
  if (!ivH || !tagH || !ctH) throw new Error('Malformed encrypted payload');
  const decipher = createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivH, 'hex'));
  decipher.setAuthTag(Buffer.from(tagH, 'hex'));
  const pt = Buffer.concat([decipher.update(Buffer.from(ctH, 'hex')), decipher.final()]);
  return pt.toString('utf8');
}

/** Binary companion for private archive uploads. Format: magic | iv | tag | ciphertext. */
export function encryptBuffer(plain: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([BUFFER_MAGIC, iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptBuffer(encrypted: Buffer): Buffer {
  const headerBytes = BUFFER_MAGIC.length + 12 + 16;
  if (encrypted.length < headerBytes || !encrypted.subarray(0, BUFFER_MAGIC.length).equals(BUFFER_MAGIC)) {
    throw new Error('Malformed encrypted buffer');
  }
  const ivStart = BUFFER_MAGIC.length;
  const tagStart = ivStart + 12;
  const ciphertextStart = tagStart + 16;
  const decipher = createDecipheriv(
    'aes-256-gcm',
    getKey(),
    encrypted.subarray(ivStart, tagStart),
  );
  decipher.setAuthTag(encrypted.subarray(tagStart, ciphertextStart));
  return Buffer.concat([
    decipher.update(encrypted.subarray(ciphertextStart)),
    decipher.final(),
  ]);
}
