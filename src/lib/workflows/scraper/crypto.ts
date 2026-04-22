import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { env } from '$env/dynamic/private';

function getKey(): Buffer {
  const hex = env.SCRAPER_VAULT_KEY;
  if (!hex || hex.length !== 64) throw new Error('SCRAPER_VAULT_KEY must be 64 hex chars (32 bytes)');
  return Buffer.from(hex, 'hex');
}

export function encryptCredential(value: Record<string, unknown>): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`;
}

export function decryptCredential<T = Record<string, unknown>>(enc: string): T {
  const [ivH, tagH, ctH] = enc.split(':');
  if (!ivH || !tagH || !ctH) throw new Error('Malformed encrypted credential');
  const decipher = createDecipheriv('aes-256-gcm', getKey(), Buffer.from(ivH, 'hex'));
  decipher.setAuthTag(Buffer.from(tagH, 'hex'));
  const pt = Buffer.concat([decipher.update(Buffer.from(ctH, 'hex')), decipher.final()]);
  return JSON.parse(pt.toString('utf8'));
}
