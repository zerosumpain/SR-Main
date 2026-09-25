import { describe, expect, it } from 'vitest';
import { signConnectState, verifyConnectState } from './oauth-state';

const SECRET = 'test-secret';

describe('gmail connect state', () => {
  it('verifies a state it signed for the same email', () => {
    const state = signConnectState(SECRET, 'Member@Example.com');
    expect(verifyConnectState(SECRET, state, 'member@example.com')).toBe(true);
  });

  it('refuses another session, another secret, a tampered or an expired state', () => {
    const now = 1_000_000;
    const state = signConnectState(SECRET, 'a@example.com', now);
    expect(verifyConnectState(SECRET, state, 'b@example.com', now)).toBe(false);
    expect(verifyConnectState('other', state, 'a@example.com', now)).toBe(false);
    expect(verifyConnectState(SECRET, state.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')), 'a@example.com', now)).toBe(false);
    expect(verifyConnectState(SECRET, state, 'a@example.com', now + 16 * 60 * 1000)).toBe(false);
    expect(verifyConnectState(SECRET, null, 'a@example.com', now)).toBe(false);
    expect(verifyConnectState(SECRET, 'a.b.c', 'a@example.com', now)).toBe(false);
  });
});
