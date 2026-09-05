import { describe, expect, it } from 'vitest';
import { parseSteamWebApiKey, SteamCredentialError } from './credential';

const KEY = '0123456789ABCDEF0123456789ABCDEF';

describe('parseSteamWebApiKey', () => {
  it('accepts a clean key', () => {
    expect(parseSteamWebApiKey(KEY)).toBe(KEY);
  });

  it('tolerates the paste people actually make', () => {
    expect(parseSteamWebApiKey(`  ${KEY.toLowerCase()}\n`)).toBe(KEY);
    expect(parseSteamWebApiKey(`Key: ${KEY}`)).toBe(KEY);
    expect(parseSteamWebApiKey(`${KEY.slice(0, 16)} ${KEY.slice(16)}`)).toBe(KEY);
  });

  it('refuses anything that is not a 32-character hex key', () => {
    for (const bad of ['', '   ', KEY.slice(1), `${KEY}0`, 'not-a-key', 42, null]) {
      expect(() => parseSteamWebApiKey(bad)).toThrow(SteamCredentialError);
    }
  });

  it('never echoes the pasted value in the error', () => {
    try {
      parseSteamWebApiKey('SECRETSECRETSECRETSECRETSECRETSECRE!');
    } catch (error) {
      expect((error as Error).message).not.toContain('SECRET');
    }
  });
});
