import { describe, expect, it } from 'vitest';
import { createOauthState, createPkceVerifier, hashOauthState, pkceChallenge } from './pkce';

describe('activity OAuth PKCE', () => {
  it('matches the RFC 7636 S256 example', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('creates high-entropy URL-safe state and verifier values', () => {
    const state = createOauthState();
    const verifier = createPkceVerifier();
    expect(state).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(state).not.toBe(createOauthState());
  });

  it('persists only a deterministic state hash', () => {
    const state = 'private-browser-state';
    expect(hashOauthState(state)).toHaveLength(64);
    expect(hashOauthState(state)).toBe(hashOauthState(state));
    expect(hashOauthState(state)).not.toContain(state);
  });
});
