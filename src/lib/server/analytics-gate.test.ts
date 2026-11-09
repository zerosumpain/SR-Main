import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PASS_TTL_SECONDS,
  issuePass,
  issueTicket,
  passCookieName,
  redeemTicket,
  resetAnalyticsGateState,
  safeDashboardPath,
  umamiUiToken,
  verifyPass,
} from './analytics-gate';

const SECRET = 'test-secret-that-is-long-enough';
const NOW = Date.UTC(2026, 10, 9, 21, 0, 0);

beforeEach(() => resetAnalyticsGateState());

describe('ticket', () => {
  it('is redeemable once, within 60 s, with the right secret only', () => {
    const t = issueTicket(SECRET, NOW);
    expect(redeemTicket(t, 'wrong-secret', NOW)).toBe(false);
    expect(redeemTicket(t, SECRET, NOW + 61_000)).toBe(false);
    expect(redeemTicket(t, SECRET, NOW + 1_000)).toBe(true);
    expect(redeemTicket(t, SECRET, NOW + 2_000)).toBe(false);
  });

  it('is not interchangeable with a pass (domain-separated labels)', () => {
    const pass = issuePass(SECRET, NOW);
    expect(redeemTicket(pass, SECRET, NOW)).toBe(false);
    expect(verifyPass(issueTicket(SECRET, NOW), SECRET, NOW)).toBe(false);
  });

  it('refuses garbage and a missing secret', () => {
    expect(redeemTicket('nope', SECRET, NOW)).toBe(false);
    expect(redeemTicket(undefined, SECRET, NOW)).toBe(false);
    expect(redeemTicket(issueTicket(SECRET, NOW), undefined, NOW)).toBe(false);
    expect(() => issueTicket('', NOW)).toThrow();
  });
});

describe('pass', () => {
  it('lasts 12 hours and no longer', () => {
    const p = issuePass(SECRET, NOW);
    expect(verifyPass(p, SECRET, NOW + (PASS_TTL_SECONDS - 5) * 1000)).toBe(true);
    expect(verifyPass(p, SECRET, NOW + (PASS_TTL_SECONDS + 5) * 1000)).toBe(false);
    expect(verifyPass(p.replace(/.$/, (c) => (c === '0' ? '1' : '0')), SECRET, NOW)).toBe(false);
  });

  it('uses a __Host- cookie in production', () => {
    expect(passCookieName(false)).toBe('__Host-sr-analytics-pass');
    expect(passCookieName(true)).toBe('sr-analytics-pass');
  });
});

describe('safeDashboardPath', () => {
  it('keeps dashboard paths and refuses redirects off the host or back into the gate', () => {
    expect(safeDashboardPath('/websites/abc/replays', '/d')).toBe('/websites/abc/replays');
    for (const bad of ['//evil.example', 'https://evil.example', '/x:y', '/__sr/enter', '/login', '/sso?token=x', '\\\\evil', '', null]) {
      expect(safeDashboardPath(bad, '/d')).toBe('/d');
    }
  });
});

describe('umamiUiToken', () => {
  it('logs in once and caches the token', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ token: 'tok' }), { status: 200 }));
    const login = { baseUrl: 'http://127.0.0.1:3002', username: 'admin', password: 'pw' };
    expect(await umamiUiToken(login, fetchFn as unknown as typeof fetch)).toBe('tok');
    expect(await umamiUiToken(login, fetchFn as unknown as typeof fetch)).toBe('tok');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('answers null on a refused login, and does not cache it', async () => {
    const fetchFn = vi.fn(async () => new Response('{}', { status: 401 }));
    const login = { baseUrl: 'http://x', username: 'a', password: 'b' };
    expect(await umamiUiToken(login, fetchFn as unknown as typeof fetch)).toBeNull();
    expect(await umamiUiToken(login, fetchFn as unknown as typeof fetch)).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
