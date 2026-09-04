import { createHash, randomBytes } from 'node:crypto';

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/g, '');
}

export function createOauthState(): string {
  return base64Url(randomBytes(32));
}

export function createPkceVerifier(): string {
  return base64Url(randomBytes(48));
}

export function pkceChallenge(verifier: string): string {
  return base64Url(createHash('sha256').update(verifier).digest());
}

export function hashOauthState(state: string): string {
  return createHash('sha256').update(state).digest('hex');
}
