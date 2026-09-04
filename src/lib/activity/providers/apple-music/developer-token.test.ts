import { generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createAppleMusicDeveloperToken } from './developer-token.server';

function decodeJson(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
}

describe('Apple Music developer token', () => {
  it('creates a bounded ES256 JWT with the expected Apple claims', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const result = createAppleMusicDeveloperToken(
      { teamId: 'TEAM123', keyId: 'KEY123', privateKey: privatePem, origin: 'https://example.test' },
      { now: new Date('2026-09-04T12:00:00.000Z'), ttlSeconds: 7 * 86_400 },
    );
    const [header, payload, signature] = result.token.split('.');
    expect(decodeJson(header)).toMatchObject({ alg: 'ES256', kid: 'KEY123' });
    expect(decodeJson(payload)).toMatchObject({ iss: 'TEAM123', origin: 'https://example.test' });
    // TTL is capped to one day even when a longer duration is requested.
    expect(Number(decodeJson(payload).exp) - Number(decodeJson(payload).iat)).toBe(86_400);
    expect(
      verify(
        'sha256',
        Buffer.from(`${header}.${payload}`),
        { key: publicKey, dsaEncoding: 'ieee-p1363' },
        Buffer.from(signature, 'base64url'),
      ),
    ).toBe(true);
  });
});
