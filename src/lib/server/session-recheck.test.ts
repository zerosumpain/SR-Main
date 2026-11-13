import { beforeEach, describe, expect, it, vi } from 'vitest';

// The guest re-check behind the Auth.js `jwt` callback: a guest removed from
// the allow-list loses an existing session within GUEST_RECHECK_MS.
const h = vi.hoisted(() => ({ guests: new Set<string>(), reads: 0, fail: false }));

vi.mock('$env/dynamic/private', () => ({ env: { AUTH_ALLOWED_EMAILS: 'owner@example.test' } }));
vi.mock('$lib/db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => {
          h.reads++;
          if (h.fail) throw new Error('db down');
          return [...h.guests].map((email) => ({ email }));
        },
      }),
    }),
  },
}));

const { sessionStillAllowed, resetGuestVerdicts, GUEST_RECHECK_MS } = await import('./access');

beforeEach(() => {
  h.guests = new Set(['guest@example.test']);
  h.reads = 0;
  h.fail = false;
  resetGuestVerdicts();
});

describe('sessionStillAllowed', () => {
  it('keeps the owner without touching the database', async () => {
    expect(await sessionStillAllowed('Owner@example.test')).toBe(true);
    expect(h.reads).toBe(0);
  });

  it('ends a removed guest once the cached answer goes stale', async () => {
    const t0 = 1_000_000;
    expect(await sessionStillAllowed('guest@example.test', t0)).toBe(true);
    h.guests.clear();
    // Inside the window: answered from cache, one read in total.
    expect(await sessionStillAllowed('guest@example.test', t0 + GUEST_RECHECK_MS - 1)).toBe(true);
    expect(h.reads).toBe(1);
    // Past it: looked up again, and refused.
    expect(await sessionStillAllowed('guest@example.test', t0 + GUEST_RECHECK_MS + 1)).toBe(false);
    expect(h.reads).toBe(2);
  });

  it('keeps a session through a failed lookup rather than signing everyone out', async () => {
    h.fail = true;
    expect(await sessionStillAllowed('guest@example.test')).toBe(true);
  });

  it('refuses a token with no email', async () => {
    expect(await sessionStillAllowed(undefined)).toBe(false);
  });
});
