import { describe, expect, it } from 'vitest';
import {
  MEMBER_ROOT,
  fitsPrincipal,
  isReservedForOwnerLane,
  memberViewRoot,
  principalForName,
  toStored,
  toView,
} from './namespace';

describe('principalForName', () => {
  it('reads a member file as its principal', () => {
    expect(principalForName('members/u_x/a.pdf')).toBe('u_x');
    expect(principalForName('members/u_x/deep/er/a.pdf')).toBe('u_x');
    expect(principalForName('members/household/rota.xlsx')).toBe('household');
  });

  it("treats a bare members/<p> as that principal's folder", () => {
    expect(principalForName('members/u_x')).toBe('u_x');
    expect(principalForName('members/u_x/')).toBe('u_x');
  });

  it('reads every other name as the owner', () => {
    expect(principalForName('a.pdf')).toBe('owner');
    expect(principalForName('jkai/notes/x.md')).toBe('owner');
    expect(principalForName('')).toBe('owner');
    expect(principalForName('membersx/u_x/a.pdf')).toBe('owner');
    expect(principalForName('membersx/..')).toBe('owner');
    expect(principalForName('members')).toBe('owner');
    expect(principalForName('x/members/u_x/a.pdf')).toBe('owner');
  });

  it('is case-sensitive, like the unique index on name', () => {
    expect(principalForName('Members/u_x/a.pdf')).toBe('owner');
    expect(principalForName('MEMBERS/u_x/a.pdf')).toBe('owner');
    expect(principalForName('members/U_X/a.pdf')).toBe('U_X');
  });

  it('gives a name under the root with no usable principal to nobody (owner, but reserved)', () => {
    for (const name of ['members/', 'members//a.pdf', 'members/../a.pdf', 'members/./a.pdf', 'members/..']) {
      expect(principalForName(name), name).toBe('owner');
      expect(isReservedForOwnerLane(name), name).toBe(true);
      expect(fitsPrincipal(name, 'owner'), name).toBe(false);
    }
  });
});

describe('isReservedForOwnerLane', () => {
  it('reserves everything under the member root, and nothing else', () => {
    expect(isReservedForOwnerLane('members/')).toBe(true);
    expect(isReservedForOwnerLane('members/u_x')).toBe(true);
    expect(isReservedForOwnerLane('members/u_x/a.pdf')).toBe(true);
    expect(isReservedForOwnerLane('members')).toBe(false);
    expect(isReservedForOwnerLane('membersx/a.pdf')).toBe(false);
    expect(isReservedForOwnerLane('Members/u_x/a.pdf')).toBe(false);
    expect(isReservedForOwnerLane('notes/members/a.pdf')).toBe(false);
  });
});

describe('view roots', () => {
  it('roots a member view at the member root', () => {
    expect(memberViewRoot()).toBe(MEMBER_ROOT);
    expect(MEMBER_ROOT).toBe('members/');
  });

  it('toView strips the root, and refuses a name outside it', () => {
    expect(toView('members/u_x/a.pdf', 'members/')).toBe('u_x/a.pdf');
    expect(toView('members/', 'members/')).toBe('');
    expect(toView('a.pdf', 'members/')).toBeNull();
    expect(toView('membersx/a.pdf', 'members/')).toBeNull();
    expect(toView('Members/u_x/a.pdf', 'members/')).toBeNull();
  });

  it("the owner's root '' is the identity", () => {
    expect(toView('a.pdf', '')).toBe('a.pdf');
    expect(toView('members/u_x/a.pdf', '')).toBe('members/u_x/a.pdf');
    expect(toStored('a.pdf', '')).toBe('a.pdf');
  });

  it('toStored adds the root', () => {
    expect(toStored('u_x/a.pdf', 'members/')).toBe('members/u_x/a.pdf');
    expect(toStored('u_x/', 'members/')).toBe('members/u_x/');
    expect(toStored('', 'members/')).toBe('members/');
  });

  it('toStored rejects anything that could climb out of its root', () => {
    for (const view of [
      '..',
      '../a.pdf',
      'u_x/../u_y/a.pdf',
      'u_x/..',
      './a.pdf',
      'u_x/./a.pdf',
      '/a.pdf',
      '/members/u_y/a.pdf',
      'u_x\\..\\a.pdf',
      'u_x/a\0.pdf',
    ]) {
      expect(toStored(view, 'members/'), view).toBeNull();
      expect(toStored(view, ''), view).toBeNull();
    }
  });

  it('allows dots that are not whole segments', () => {
    expect(toStored('u_x/..a.pdf', 'members/')).toBe('members/u_x/..a.pdf');
    expect(toStored('u_x/a..b/c.pdf', 'members/')).toBe('members/u_x/a..b/c.pdf');
    expect(toStored('u_x/.hidden', 'members/')).toBe('members/u_x/.hidden');
  });

  it('round-trips', () => {
    const stored = 'members/u_x/sub/a.pdf';
    expect(toStored(toView(stored, 'members/')!, 'members/')).toBe(stored);
  });
});

describe('fitsPrincipal', () => {
  it('lets the owner hold any name outside the root', () => {
    expect(fitsPrincipal('a.pdf', 'owner')).toBe(true);
    expect(fitsPrincipal('Members/u_x/a.pdf', 'owner')).toBe(true);
    expect(fitsPrincipal('membersx/a.pdf', 'owner')).toBe(true);
    expect(fitsPrincipal('members/u_x/a.pdf', 'owner')).toBe(false);
    expect(fitsPrincipal('members/owner/a.pdf', 'owner')).toBe(false);
  });

  it('lets a member hold only names under their own folder', () => {
    expect(fitsPrincipal('members/u_x/a.pdf', 'u_x')).toBe(true);
    expect(fitsPrincipal('members/u_x', 'u_x')).toBe(true);
    expect(fitsPrincipal('members/u_y/a.pdf', 'u_x')).toBe(false);
    expect(fitsPrincipal('members/u_xy/a.pdf', 'u_x')).toBe(false);
    expect(fitsPrincipal('a.pdf', 'u_x')).toBe(false);
    expect(fitsPrincipal('members/', 'u_x')).toBe(false);
    expect(fitsPrincipal('Members/u_x/a.pdf', 'u_x')).toBe(false);
  });

  it('never fits a malformed principal', () => {
    expect(fitsPrincipal('members//a.pdf', '')).toBe(false);
    expect(fitsPrincipal('members/../a.pdf', '..')).toBe(false);
    expect(fitsPrincipal('members/./a.pdf', '.')).toBe(false);
  });

  it('keeps the invariant principal_id === principalForName(name) for every name that fits', () => {
    const names = ['a.pdf', 'members/u_x/a.pdf', 'members/household/a', 'Members/u_x/a', 'members/u_x'];
    for (const name of names) {
      const p = principalForName(name);
      if (fitsPrincipal(name, p)) expect(principalForName(name)).toBe(p);
      for (const other of ['owner', 'u_x', 'u_y', 'household']) {
        if (fitsPrincipal(name, other)) expect(p, `${name} fits ${other}`).toBe(other);
      }
    }
  });
});
