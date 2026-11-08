import { describe, expect, it } from 'vitest';
import { APP_WEB_SESSION_TTL_S, appWebSessionCookie, signAppWebSession, verifyAppWebSession } from './app-web-session';

// The iPhone app's web-view cookie: only this server can make one, only for the
// audience it names, only until it expires.

const SECRET = 's'.repeat(40);
const DEVICE = '0b9d8c1e-1111-4a2b-9c3d-123456789abc';
const NOW = 1_800_000_000_000;
const mint = (over: Partial<{ audience: string; email: string; deviceId: string }> = {}) =>
  signAppWebSession(SECRET, { audience: 'sr-wildmind', email: 'Owner@X.test', deviceId: DEVICE, ...over }, NOW);

describe('app web session', () => {
  it('round-trips for its audience, lower-casing the email', () => {
    const { value, expiresAt } = mint();
    expect(expiresAt).toBe(NOW + APP_WEB_SESSION_TTL_S * 1000);
    expect(verifyAppWebSession(SECRET, 'sr-wildmind', value, NOW + 1000)).toEqual({ audience: 'sr-wildmind', email: 'owner@x.test', deviceId: DEVICE, expiresAt });
  });

  it('means nothing to another audience', () => {
    expect(verifyAppWebSession(SECRET, 'sr-drive', mint().value, NOW)).toBeNull();
  });

  it('cannot be minted for an audience the app does not show', () => {
    expect(() => mint({ audience: 'sr-drive' })).toThrow();
  });

  it('expires', () => {
    const { value, expiresAt } = mint();
    expect(verifyAppWebSession(SECRET, 'sr-wildmind', value, expiresAt)).toBeNull();
  });

  it('refuses another secret, an edited field and junk', () => {
    const { value } = mint();
    expect(verifyAppWebSession('t'.repeat(40), 'sr-wildmind', value, NOW)).toBeNull();
    const parts = value.split('.');
    parts[2] = Buffer.from('mallory@x.test').toString('base64url');
    expect(verifyAppWebSession(SECRET, 'sr-wildmind', parts.join('.'), NOW)).toBeNull();
    const later = value.split('.');
    later[4] = String(NOW + 10 * APP_WEB_SESSION_TTL_S * 1000);
    expect(verifyAppWebSession(SECRET, 'sr-wildmind', later.join('.'), NOW)).toBeNull();
    for (const junk of ['', 'v1', 'v1.a.b.c.d.e', 'x'.repeat(2000), null, undefined]) expect(verifyAppWebSession(SECRET, 'sr-wildmind', junk, NOW)).toBeNull();
  });

  it('is read from a cookie header by its exact name', () => {
    expect(appWebSessionCookie('a=1; sr_app_session=v1.x; b=2')).toBe('v1.x');
    expect(appWebSessionCookie('xsr_app_session=v1.x')).toBe('');
  });
});
