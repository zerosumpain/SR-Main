import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

function getKey(): Buffer {
  const hex = process.env.INTEGRATION_CREDENTIALS_KEY;
  if (!hex || hex.length !== 64) {
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
