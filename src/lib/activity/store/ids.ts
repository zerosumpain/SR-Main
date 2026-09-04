import { createHash, randomUUID } from 'node:crypto';

/** Stable opaque id for provider natural keys, without leaking those keys. */
export function stableActivityId(prefix: string, parts: Array<string | number | null>): string {
  const hash = createHash('sha256');
  for (const part of parts) {
    const value = part === null ? '<null>' : String(part);
    hash.update(String(Buffer.byteLength(value)));
    hash.update(':');
    hash.update(value);
    hash.update('|');
  }
  return `${prefix}_${hash.digest('hex').slice(0, 32)}`;
}

export function randomActivityId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}
