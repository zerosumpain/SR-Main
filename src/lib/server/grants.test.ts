import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/db', () => ({ db: {} }));
vi.mock('./members', () => ({ disableMemberGmail: vi.fn(), ensureMemberPrincipal: vi.fn() }));

const { effectivePermissions, groupIdFromLabel } = await import('./grants');

const groups = new Map<string, readonly unknown[]>([
  ['family-circle', ['family:circle']],
  ['readers', ['research:all', 'news:self', 'not-a-permission']],
]);

describe('effectivePermissions', () => {
  it('is the union of the groups and the one-off grants', () => {
    const got = effectivePermissions(
      { role: 'guest', groups: ['family-circle', 'readers'], grants: ['jkai.intel:self'] },
      groups,
    );
    expect([...got].sort()).toEqual(['family:circle', 'jkai.intel:self', 'news:self', 'research:all']);
  });

  it('ignores a group that no longer exists and permissions no code defines', () => {
    const got = effectivePermissions({ role: 'guest', groups: ['gone', 7], grants: ['owner', 'jkai.canvas:self'] }, groups);
    expect(got.size).toBe(0);
  });

  it('reads a pre-groups member row as their own intel space', () => {
    expect([...effectivePermissions({ role: 'member', groups: [], grants: [] }, groups)]).toEqual(['jkai.intel:self']);
  });

  it('holds only grants of open areas — workflows and the admin showcase are closed until built', async () => {
    // effectivePermissions drops a grant whose area is closed (isOpenPermission):
    // a tick at /admin/access for a closed area is stored but never held, so it
    // cannot open anything before the area's scoping ships.
    const { AREAS } = await import('$lib/access/catalogue');
    expect(AREAS.filter((a) => !a.open).map((a) => a.id)).toEqual(['workflows', 'admin']);
    const got = effectivePermissions(
      { role: 'guest', groups: [], grants: ['drive:admin', 'research:self', 'health:all', 'workflows:self', 'admin:self'] },
      groups,
    );
    expect([...got].sort()).toEqual(['drive:admin', 'health:all', 'research:self']);
  });

  it('gives a guest with nothing nothing', () => {
    expect(effectivePermissions({ role: 'guest', groups: null, grants: null }, groups).size).toBe(0);
  });
});

describe('groupIdFromLabel', () => {
  it('slugs a label', () => {
    expect(groupIdFromLabel('  Research readers! ')).toBe('research-readers');
    expect(groupIdFromLabel('Kids & Teens')).toBe('kids-teens');
    expect(groupIdFromLabel('!!!')).toBe('');
  });
});
