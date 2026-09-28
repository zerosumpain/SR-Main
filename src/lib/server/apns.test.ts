import { describe, it, expect, afterEach } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { buildPayload, isDeadToken, isDeviceToken, resetApnsForTests, sendPush, apnsConfig } from './apns';

afterEach(() => {
  for (const k of ['APNS_KEY_ID', 'APNS_TEAM_ID', 'APNS_BUNDLE_ID', 'APNS_KEY_BASE64', 'APNS_ENV']) delete process.env[k];
  resetApnsForTests();
});

describe('buildPayload', () => {
  it('puts the alert under aps and the app keys beside it', () => {
    const p = JSON.parse(
      buildPayload({
        title: 'Sam left School',
        body: 'at 17:52',
        category: 'household',
        threadId: 'household',
        level: 'time-sensitive',
        relevance: 1,
        userInfo: { id: 'e1', category: 'household' },
      }),
    );
    expect(p).toEqual({
      id: 'e1',
      category: 'household',
      aps: {
        alert: { title: 'Sam left School', body: 'at 17:52' },
        sound: 'default',
        'interruption-level': 'time-sensitive',
        category: 'household',
        'thread-id': 'household',
        'relevance-score': 1,
      },
    });
  });

  it('makes a passive one silent', () => {
    expect(JSON.parse(buildPayload({ title: 't', body: 'b', level: 'passive' })).aps.sound).toBeUndefined();
  });

  it('stays under Apple\'s 4 KB limit however long the text', () => {
    const p = buildPayload({ title: 'x'.repeat(5000), body: 'y'.repeat(5000), userInfo: { a: 'z'.repeat(2500) } });
    expect(Buffer.byteLength(p)).toBeLessThanOrEqual(4096);
  });
});

describe('tokens', () => {
  it('accepts hex only', () => {
    expect(isDeviceToken('a'.repeat(64))).toBe(true);
    expect(isDeviceToken('not-a-token')).toBe(false);
    expect(isDeviceToken('a'.repeat(63))).toBe(false);
  });

  it('forgets a token Apple has retired, not one that hit a passing fault', () => {
    expect(isDeadToken({ ok: false, status: 410, reason: 'Unregistered' })).toBe(true);
    expect(isDeadToken({ ok: false, status: 400, reason: 'BadDeviceToken' })).toBe(true);
    expect(isDeadToken({ ok: false, status: 429, reason: 'TooManyRequests' })).toBe(false);
    expect(isDeadToken({ ok: false, status: 0, reason: 'Timeout' })).toBe(false);
  });
});

describe('configuration', () => {
  it('sends nothing when the key is not set', async () => {
    expect(apnsConfig()).toBeNull();
    expect(await sendPush('a'.repeat(64), { title: 't', body: 'b' })).toEqual({ ok: false, status: 0, reason: 'NotConfigured' });
  });

  it('reads a base64 .p8 and defaults to production', () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    process.env.APNS_KEY_ID = 'KEY123';
    process.env.APNS_TEAM_ID = 'TEAM123';
    process.env.APNS_BUNDLE_ID = 'com.example.app';
    process.env.APNS_KEY_BASE64 = Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' }) as string).toString('base64');
    expect(apnsConfig()).toMatchObject({ keyId: 'KEY123', teamId: 'TEAM123', bundleId: 'com.example.app', defaultEnv: 'production' });
  });
});
