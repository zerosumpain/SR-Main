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
      { role: 'guest', groups: ['family-circle', 'readers'], grants: ['jkai.notes:self'] },
      groups,
    );
    expect([...got].sort()).toEqual(['family:circle', 'jkai.notes:self', 'news:self', 'research:all']);
  });

  it('ignores a group that no longer exists and permissions no code defines', () => {
    const got = effectivePermissions({ role: 'guest', groups: ['gone', 7], grants: ['owner', 'jkai.canvas:self'] }, groups);
    expect(got.size).toBe(0);
  });

  it('reads a pre-groups member row as their own intel space', () => {
    expect([...effectivePermissions({ role: 'member', groups: [], grants: [] }, groups)]).toEqual(['jkai.intel:self']);
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
