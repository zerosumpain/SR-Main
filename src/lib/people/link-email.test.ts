import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/db', () => ({ db: {} }));

const { refuseLink } = await import('./link-email');

const base = {
  from: 'x1y2@privaterelay.appleid.com',
  to: 'sam@gmail.com',
  toIsOwner: false,
  fromIsAccount: true,
  toIsTaken: false,
  toInHouseholdElsewhere: false,
};

describe('linking a Google address', () => {
  it('lets an account move to a new, free address', () => {
    expect(refuseLink(base)).toBeNull();
    expect(refuseLink({ ...base, to: ' Sam@Gmail.com ' })).toBeNull();
  });

  it('refuses the owner’s address, a taken one, and one another household person holds', () => {
    expect(refuseLink({ ...base, toIsOwner: true })).toBe('owner');
    expect(refuseLink({ ...base, toIsTaken: true })).toBe('taken');
    expect(refuseLink({ ...base, toInHouseholdElsewhere: true })).toBe('household-taken');
  });

  it('refuses nonsense, a no-op, and someone with no account', () => {
    expect(refuseLink({ ...base, to: 'not-an-email' })).toBe('bad-email');
    expect(refuseLink({ ...base, to: base.from.toUpperCase() })).toBe('same');
    expect(refuseLink({ ...base, fromIsAccount: false })).toBe('not-an-account');
  });
});
