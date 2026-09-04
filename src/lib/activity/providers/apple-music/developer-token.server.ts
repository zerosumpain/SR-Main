import { createPrivateKey, sign } from 'node:crypto';

function base64Url(value: string | Uint8Array): string {
  return Buffer.from(value)
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/g, '');
}

export interface AppleMusicDeveloperTokenConfig {
  teamId: string;
  keyId: string;
  privateKey: string;
  origin?: string;
}

export function loadAppleMusicDeveloperTokenConfig(): AppleMusicDeveloperTokenConfig {
  const teamId = process.env.APPLE_MUSIC_TEAM_ID?.trim() ?? '';
  const keyId = process.env.APPLE_MUSIC_KEY_ID?.trim() ?? '';
  const privateKey = (process.env.APPLE_MUSIC_PRIVATE_KEY ?? '').replaceAll('\\n', '\n').trim();
  if (!teamId || !keyId || !privateKey) {
    throw new Error('Apple Music developer credentials are not configured');
  }
  return {
    teamId,
    keyId,
    privateKey,
    origin: process.env.PUBLIC_BASE_URL?.replace(/\/$/, ''),
  };
}

export function createAppleMusicDeveloperToken(
  config: AppleMusicDeveloperTokenConfig,
  options: { now?: Date; ttlSeconds?: number } = {},
): { token: string; expiresAt: Date } {
  const now = options.now ?? new Date();
  const ttlSeconds = Math.max(60, Math.min(86_400, Math.floor(options.ttlSeconds ?? 3_600)));
  const issuedAt = Math.floor(now.getTime() / 1_000);
  const expiresAt = new Date((issuedAt + ttlSeconds) * 1_000);
  const header = base64Url(JSON.stringify({ alg: 'ES256', kid: config.keyId, typ: 'JWT' }));
  const claims: Record<string, string | number> = {
    iss: config.teamId,
    iat: issuedAt,
    exp: issuedAt + ttlSeconds,
  };
  if (config.origin) claims.origin = config.origin;
  const payload = base64Url(JSON.stringify(claims));
  const signingInput = `${header}.${payload}`;
  const signature = sign('sha256', Buffer.from(signingInput), {
    key: createPrivateKey(config.privateKey),
    dsaEncoding: 'ieee-p1363',
  });
  return { token: `${signingInput}.${base64Url(signature)}`, expiresAt };
}
