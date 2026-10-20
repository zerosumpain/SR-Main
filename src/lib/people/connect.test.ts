import { beforeEach, describe, expect, it, vi } from 'vitest';

// The table in connect.ts, one row per case. Everything underneath is stood
// in for: this is about WHICH kind of code goes to WHOM, and what else
// happens on the way.

const h = vi.hoisted(() => ({
  codes: [] as Array<{ email: string; kind: string; fresh: boolean | undefined }>,
  admitted: [] as Array<Record<string, unknown>>,
  linked: [] as Array<[string, Record<string, unknown>]>,
  linkFails: false,
}));

vi.mock('$env/dynamic/private', () => ({ env: { AUTH_SECRET: 'connect-test-secret'.padEnd(40, 'x') } }));
vi.mock('$lib/server/access', () => ({ isOwnerEmail: (e: string) => e === 'owner@example.test' }));
vi.mock('$lib/server/registration', () => ({ PRE_REGISTERED_GROUP: 'family-circle' }));
vi.mock('$lib/server/qr', () => ({ qrDataUrl: async (text: string) => `qr:${text}` }));
vi.mock('$lib/server/admission', () => ({
  admitToAllowList: async (input: Record<string, unknown>) => {
    h.admitted.push(input);
    return { email: input.email, created: true, carried: 0 };
  },
}));
vi.mock('$lib/server/pair-codes', () => ({
  pairingCode: async (email: string, kind: string, opts?: { fresh?: boolean }) => {
    h.codes.push({ email, kind, fresh: opts?.fresh });
    return { code: `${kind}-code`, expiresAt: new Date('2026-10-20T09:10:00Z'), reused: false };
  },
}));
vi.mock('$lib/home/presence/members', () => ({
  updateMember: async (subject: string, patch: Record<string, unknown>) => {
    if (h.linkFails) throw new Error('household_member_email_idx');
    h.linked.push([subject, patch]);
    return null;
  },
}));

const { connect } = await import('./connect');

const ORIGIN = 'https://strangeramblings.com';
const owner = { kind: 'owner' as const, name: 'John', email: 'owner@example.test', householdSubject: 'john' };
const adult = { kind: 'account' as const, name: 'Katie', email: 'katie@example.test', householdSubject: 'katie' };
const child = { kind: 'household' as const, name: 'Rory', email: null, householdSubject: 'rory' };

beforeEach(() => {
  h.codes.length = 0;
  h.admitted.length = 0;
  h.linked.length = 0;
  h.linkFails = false;
});

describe('connect', () => {
  it.each([
    ['the owner, whatever the toggle says', owner, false, 'scan'],
    ['an adult with identity on', adult, true, 'scan'],
    ['an adult the owner vouches for', adult, false, 'pair'],
  ])('TestFlight for %s → a %s code', async (_, person, identity, kind) => {
    const r = await connect({ person, channel: 'testflight', identity, origin: ORIGIN, addedBy: 'owner@example.test' });
    expect(r).toMatchObject({ channel: 'testflight', kind, code: `${kind}-code`, admitted: false, reused: false });
    expect(h.codes).toEqual([{ email: person.email, kind, fresh: undefined }]);
    expect((r as { qr: string }).qr).toBe(`qr:${JSON.stringify({ type: 'sr-pair', version: 1, server: ORIGIN, code: `${kind}-code` })}`);
    expect(h.admitted).toEqual([]);
  });

  it('"New code" is passed through', async () => {
    await connect({ person: adult, channel: 'testflight', identity: true, origin: ORIGIN, fresh: true, addedBy: null });
    expect(h.codes[0].fresh).toBe(true);
  });

  it('admits a household-only person on the way: Family Circle, and the address onto THEIR row by subject', async () => {
    const r = await connect({ person: child, channel: 'testflight', identity: false, email: 'Rory@Example.test', origin: ORIGIN, addedBy: 'owner@example.test' });
    expect(r).toMatchObject({ kind: 'pair', admitted: true });
    expect(h.linked).toEqual([['rory', { email: 'rory@example.test' }]]);
    expect(h.admitted).toEqual([{ email: 'rory@example.test', name: 'Rory', groups: ['family-circle'], addedBy: 'owner@example.test' }]);
    expect(h.codes).toEqual([{ email: 'rory@example.test', kind: 'pair', fresh: undefined }]);
  });

  it('needs an address for someone with none, and never the owner’s', async () => {
    expect(await connect({ person: child, channel: 'testflight', identity: false, origin: ORIGIN, addedBy: null })).toHaveProperty('error');
    expect(await connect({ person: child, channel: 'testflight', identity: false, email: 'not-an-email', origin: ORIGIN, addedBy: null })).toHaveProperty('error');
    expect(await connect({ person: child, channel: 'testflight', identity: false, email: 'owner@example.test', origin: ORIGIN, addedBy: null })).toHaveProperty('error');
    expect(h.admitted).toEqual([]);
    expect(h.codes).toEqual([]);
  });

  it('refuses, and admits nobody, when the household row cannot take the address', async () => {
    h.linkFails = true;
    const r = await connect({ person: child, channel: 'testflight', identity: false, email: 'rory@example.test', origin: ORIGIN, addedBy: null });
    expect(r).toEqual({ error: 'Someone else in the household already has that email.' });
    expect(h.admitted).toEqual([]);
  });

  it('ad-hoc is a week’s join link for their first name, the same link all day', async () => {
    const r = await connect({ person: adult, channel: 'adhoc', identity: true, origin: ORIGIN, addedBy: null });
    expect(r).toMatchObject({ channel: 'adhoc', kind: 'join', days: 7, admitted: false, reused: false });
    const link = (r as { link: string }).link;
    expect(link).toMatch(new RegExp(`^${ORIGIN}/app/katie-[A-Za-z0-9_-]{10}$`));
    expect((r as { qr: string }).qr).toBe(`qr:${link}`);
    expect((await connect({ person: adult, channel: 'adhoc', identity: true, origin: ORIGIN, addedBy: null }) as { link: string }).link).toBe(link);
    expect(h.codes).toEqual([]);
  });
});
