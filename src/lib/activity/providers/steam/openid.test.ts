import { describe, expect, it } from 'vitest';
import { buildSteamOpenIdUrl, steamIdFromClaimedId, verifySteamOpenIdResponse } from './openid';

describe('Steam OpenID', () => {
  it('builds an OpenID 2.0 login URL bound to return URL and realm', () => {
    const result = new URL(buildSteamOpenIdUrl({
      returnTo: 'https://example.test/callback?state=abc',
      realm: 'https://example.test',
    }));
    expect(result.origin + result.pathname).toBe('https://steamcommunity.com/openid/login');
    expect(result.searchParams.get('openid.mode')).toBe('checkid_setup');
    expect(result.searchParams.get('openid.return_to')).toBe('https://example.test/callback?state=abc');
  });

  it('accepts only canonical 17-digit Steam claimed ids', () => {
    expect(steamIdFromClaimedId('https://steamcommunity.com/openid/id/76561198000000000')).toBe('76561198000000000');
    expect(steamIdFromClaimedId('https://evil.test/openid/id/76561198000000000')).toBeNull();
    expect(steamIdFromClaimedId('https://steamcommunity.com/openid/id/not-a-number')).toBeNull();
  });

  it('round-trips the assertion to Steam before trusting the identity', async () => {
    const fetchFn = async (_url: string | URL | Request, init?: RequestInit) => {
      expect(String(init?.body)).toContain('openid.mode=check_authentication');
      return new Response('ns:http://specs.openid.net/auth/2.0\nis_valid:true\n');
    };
    const callback = new URL('https://example.test/callback?openid.claimed_id=https%3A%2F%2Fsteamcommunity.com%2Fopenid%2Fid%2F76561198000000000&openid.mode=id_res');
    await expect(verifySteamOpenIdResponse(callback, fetchFn as typeof fetch)).resolves.toBe('76561198000000000');
  });

  it('rejects an assertion Steam does not validate', async () => {
    const fetchFn = async () => new Response('is_valid:false\n');
    const callback = new URL('https://example.test/callback?openid.claimed_id=https%3A%2F%2Fsteamcommunity.com%2Fopenid%2Fid%2F76561198000000000');
    await expect(verifySteamOpenIdResponse(callback, fetchFn as typeof fetch)).rejects.toThrow(/not valid/);
  });
});
