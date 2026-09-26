import { describe, expect, it } from 'vitest';
import { accessInvite } from '$lib/db/schema';
import {
  decideSignIn,
  hashInviteCode,
  inviteState,
  isInviteCodeShaped,
  maskEmail,
  mintInviteCode,
  type InviteRow,
  type SignInDeps,
} from './invites';

const NOW = new Date('2026-09-26T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function invite(over: Partial<InviteRow> = {}): InviteRow {
  return {
    id: 'inv-1',
    codeHash: 'x',
    email: null,
    name: 'Jane',
    note: null,
    groups: ['family-circle'],
    createdBy: 'owner@example.com',
    createdAt: new Date(NOW.getTime() - DAY),
    expiresAt: new Date(NOW.getTime() + 13 * DAY),
    usedAt: null,
    usedByEmail: null,
    revokedAt: null,
    ...over,
  };
}

/** A world of one invite, recording what the rule did to it. */
function world(opts: { allowed?: string[]; invite?: InviteRow | null; owners?: boolean; claimWins?: boolean } = {}) {
  const code = mintInviteCode();
  const row = opts.invite === undefined ? invite({ codeHash: hashInviteCode(code) }) : opts.invite;
  const log = { claimed: [] as string[], admitted: [] as { id: string; email: string }[], lookups: 0 };
  const deps: SignInDeps = {
    isAllowed: async (e) => (opts.allowed ?? []).includes(e),
    ownersConfigured: () => opts.owners ?? true,
    findInvite: async (hash) => {
      log.lookups++;
      return row && row.codeHash === hash ? row : null;
    },
    claimInvite: async (id, email) => {
      if (opts.claimWins === false) return false;
      log.claimed.push(email);
      if (row) row.usedAt = NOW;
      return true;
    },
    admit: async (inv, email) => {
      log.admitted.push({ id: inv.id, email });
    },
    now: () => NOW,
  };
  return { code, row, deps, log };
}

describe('the invite table', () => {
  it('stores a hash, never a code', () => {
    expect(accessInvite.codeHash).toBeDefined();
    expect((accessInvite as unknown as Record<string, unknown>).code).toBeUndefined();
  });

  it('cannot mint a row without an expiry', () => {
    expect(accessInvite.expiresAt.notNull).toBe(true);
  });
});

describe('invite codes', () => {
  it('are long, url-safe and unique', () => {
    const a = mintInviteCode();
    const b = mintInviteCode();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(isInviteCodeShaped(a)).toBe(true);
  });

  it('refuse anything that could not be a code before any lookup', () => {
    expect(isInviteCodeShaped('')).toBe(false);
    expect(isInviteCodeShaped('short')).toBe(false);
    expect(isInviteCodeShaped('../../etc/passwd-and-some-padding')).toBe(false);
    expect(isInviteCodeShaped(null)).toBe(false);
  });

  it('hash deterministically', () => {
    expect(hashInviteCode('abc')).toBe(hashInviteCode('abc'));
    expect(hashInviteCode('abc')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('inviteState', () => {
  it('is ok for a live invite', () => {
    expect(inviteState(invite(), null, NOW)).toBe('ok');
    expect(inviteState(invite(), 'anyone@example.com', NOW)).toBe('ok');
  });

  it('reports unknown, used, revoked and expired', () => {
    expect(inviteState(null, null, NOW)).toBe('unknown');
    expect(inviteState(invite({ usedAt: NOW }), null, NOW)).toBe('used');
    expect(inviteState(invite({ revokedAt: NOW }), null, NOW)).toBe('revoked');
    expect(inviteState(invite({ expiresAt: new Date(NOW.getTime() - 1) }), null, NOW)).toBe('expired');
    // The instant of expiry is already expired.
    expect(inviteState(invite({ expiresAt: NOW }), null, NOW)).toBe('expired');
  });

  it('admits only the named address when the invite has one, case-blind', () => {
    const named = invite({ email: 'jane@example.com' });
    expect(inviteState(named, 'Jane@Example.com', NOW)).toBe('ok');
    expect(inviteState(named, 'someone@example.com', NOW)).toBe('email-mismatch');
    // The landing page (no email yet) does not leak the mismatch.
    expect(inviteState(named, null, NOW)).toBe('ok');
  });
});

describe('the sign-in rule', () => {
  it('lets an allowed person in without spending the invite', async () => {
    const w = world({ allowed: ['jane@example.com'] });
    const out = await decideSignIn('jane@example.com', w.code, w.deps);
    expect(out).toEqual({ allow: true, via: 'allow-list' });
    expect(w.log.claimed).toEqual([]);
    expect(w.log.lookups).toBe(0);
  });

  it('denies a stranger with no invite exactly as before', async () => {
    const w = world();
    expect(await decideSignIn('stranger@example.com', undefined, w.deps)).toEqual({ allow: false, reason: 'not-allowed' });
    expect(await decideSignIn('stranger@example.com', 'garbage', w.deps)).toEqual({ allow: false, reason: 'not-allowed' });
    expect(w.log.lookups).toBe(0);
  });

  it('accepts a live invite once, and puts them on the allow-list', async () => {
    const w = world();
    const out = await decideSignIn('Jane@Example.com', w.code, w.deps);
    expect(out).toEqual({ allow: true, via: 'invite' });
    expect(w.log.claimed).toEqual(['jane@example.com']);
    expect(w.log.admitted).toEqual([{ id: 'inv-1', email: 'jane@example.com' }]);
  });

  it('refuses the same link a second time', async () => {
    const w = world();
    await decideSignIn('jane@example.com', w.code, w.deps);
    const again = await decideSignIn('other@example.com', w.code, w.deps);
    expect(again).toEqual({ allow: false, reason: 'used' });
    expect(w.log.admitted).toHaveLength(1);
  });

  it('refuses an expired invite', async () => {
    const code = mintInviteCode();
    const w = world({ invite: invite({ codeHash: hashInviteCode(code), expiresAt: new Date(NOW.getTime() - DAY) }) });
    expect(await decideSignIn('jane@example.com', code, w.deps)).toEqual({ allow: false, reason: 'expired' });
    expect(w.log.claimed).toEqual([]);
  });

  it('refuses a revoked invite', async () => {
    const code = mintInviteCode();
    const w = world({ invite: invite({ codeHash: hashInviteCode(code), revokedAt: NOW }) });
    expect(await decideSignIn('jane@example.com', code, w.deps)).toEqual({ allow: false, reason: 'revoked' });
  });

  it('refuses an invite made out to somebody else, without spending it', async () => {
    const code = mintInviteCode();
    const w = world({ invite: invite({ codeHash: hashInviteCode(code), email: 'jane@example.com' }) });
    expect(await decideSignIn('mallory@example.com', code, w.deps)).toEqual({ allow: false, reason: 'email-mismatch' });
    expect(w.log.claimed).toEqual([]);
    // Jane can still use it afterwards.
    expect(await decideSignIn('jane@example.com', code, w.deps)).toEqual({ allow: true, via: 'invite' });
  });

  it('refuses an unknown code', async () => {
    const w = world();
    expect(await decideSignIn('jane@example.com', mintInviteCode(), w.deps)).toEqual({ allow: false, reason: 'unknown' });
  });

  it('refuses when a racing sign-in claimed the invite first', async () => {
    const w = world({ claimWins: false });
    expect(await decideSignIn('jane@example.com', w.code, w.deps)).toEqual({ allow: false, reason: 'claim-lost' });
    expect(w.log.admitted).toEqual([]);
  });

  it('admits nobody on a site with no owner configured', async () => {
    const w = world({ owners: false });
    expect(await decideSignIn('jane@example.com', w.code, w.deps)).toEqual({ allow: false, reason: 'no-owners' });
  });

  it('refuses an empty email', async () => {
    const w = world();
    expect(await decideSignIn('  ', w.code, w.deps)).toEqual({ allow: false, reason: 'no-email' });
  });
});

describe('maskEmail', () => {
  it('keeps the first letter and the domain', () => {
    expect(maskEmail('jane@gmail.com')).toBe('j•••@gmail.com');
    expect(maskEmail('nonsense')).toBe('•••');
  });
});
