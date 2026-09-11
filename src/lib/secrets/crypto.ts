import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const BUFFER_MAGIC = Buffer.from('JKAI1', 'ascii');

function getKey(): Buffer {
  const hex = process.env.INTEGRATION_CREDENTIALS_KEY;
  if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error('INTEGRATION_CREDENTIALS_KEY must be 64 hex chars (32 bytes)');
  }
  return Buffer.from(hex, 'hex');
}

/**
 * The same cipher against a CALLER-SUPPLIED key.
 *
 * Every other function here uses the one site-wide key, which is right for
 * credentials: they are all as secret as each other and they all live as long as
 * the site does. Sealed policy runs want the opposite — a key PER RUN, held
 * outside the database, destroyed on demand — so that destroying it makes one
 * run's ciphertext permanently unreadable wherever a copy of it has got to, in
 * fourteen nightly dumps and every restic snapshot beside them.
 *
 * One implementation, two key sources. A second AES-GCM in the policy feature
 * would be a second thing to get the IV handling wrong in.
 *
 * Format: `<iv-hex>:<auth-tag-hex>:<ciphertext-hex>`.
 */
export function encryptWith(key: Buffer, plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${ct.toString('hex')}`;
}

/** Throws on a wrong key, a truncated payload or a tampered tag — never returns rubbish. */
export function decryptWith(key: Buffer, enc: string): string {
  const parts = enc.split(':');
  if (parts.length !== 3) throw new Error('Malformed encrypted payload');
  const [ivH, tagH, ctH] = parts;
  if (!ivH || !tagH || !ctH) throw new Error('Malformed encrypted payload');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivH, 'hex'));
  decipher.setAuthTag(Buffer.from(tagH, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(ctH, 'hex')), decipher.final()]).toString('utf8');
}

export function encryptPayload(plain: string): string {
  return encryptWith(getKey(), plain);
}

export function decryptPayload(enc: string): string {
  return decryptWith(getKey(), enc);
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
