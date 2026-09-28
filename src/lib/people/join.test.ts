import { describe, expect, it } from 'vitest';
import type { Permission } from '$lib/access/catalogue';
import type { DeviceRow } from '$lib/access/device-rows';
import type { HouseholdMember } from '$lib/home/presence/members';
import { findPerson, joinPeople, type RoleView } from './join';

const roles: RoleView[] = [
  { id: 'family-circle', label: 'Family', description: null, grants: ['family:circle', 'games:self'], builtIn: true },
  {
    id: 'family-admin',
    label: 'Parent',
    description: null,
    grants: ['family:circle', 'family:admin', 'games:self'],
    builtIn: true,
  },
  { id: 'friend', label: 'Friend', description: null, grants: ['news:self', 'jkai.chat:self', 'games:self'], builtIn: true },
];

function member(subject: string, email: string | null, source: HouseholdMember['source'] = 'life360'): HouseholdMember {
  return { subject, email, displayName: subject[0].toUpperCase() + subject.slice(1), source, haPersonEntity: null, whatsapp: null, alerts: {} };
}

function device(email: string, lane: 'site' | 'companion', status: DeviceRow['status'] = 'active'): DeviceRow {
  return { key: `${lane}:${email}:${status}`, lane, id: `${lane}-${email}`, email, person: email, label: null, paired: null, lastUsed: null, expires: null, status };
}

const at = new Date('2026-09-20T10:00:00Z');

const people = joinPeople({
  owners: ['Owner@Example.test'],
  accounts: [
    {
      email: 'wife@example.test',
      note: 'Wife',
      role: 'guest',
      groups: ['family-circle', 'family-admin'],
      grants: ['games:all', 'family:circle', 'research:self'] as Permission[],
      createdAt: at,
    },
    { email: 'pal@example.test', note: 'friend', role: 'guest', groups: [], grants: ['news:all'], createdAt: at },
    { email: 'old@example.test', note: null, role: 'household', groups: [], grants: [], createdAt: at },
  ],
  roles,
  household: [
    member('john', 'owner@example.test', 'companion'),
    member('katie', 'wife@example.test'),
    member('rory', null),
  ],
  devices: [
    device('wife@example.test', 'companion'),
    device('wife@example.test', 'site'),
    device('wife@example.test', 'site', 'revoked'),
  ],
});

describe('one row per human', () => {
  it('orders the owner, then accounts, then household-only people', () => {
    expect(people.map((p) => [p.kind, p.key])).toEqual([
      ['owner', 'john'],
      ['account', 'pal@example.test'],
      ['account', 'katie'],
      ['account', 'old@example.test'],
      ['household', 'rory'],
    ]);
  });

  it('names someone from the household first, then the allow-list note, then the address', () => {
    expect(people.map((p) => p.name)).toEqual(['John', 'friend', 'Katie', 'Old', 'Rory']);
  });

  it('reads an old two-group row as its strongest role, and keeps only real adds', () => {
    const katie = findPerson(people, 'katie');
    expect(katie).toMatchObject({ roleId: 'family-admin', roleLabel: 'Parent', adds: ['research:self'], family: 'parent' });
    expect(katie?.summary).toEqual(['research', 'games']);
  });

  it('carries a pre-groups household role in as the family circle', () => {
    expect(findPerson(people, 'old@example.test')).toMatchObject({ roleId: null, adds: ['family:circle'], family: 'circle' });
  });

  it('counts only live phones', () => {
    expect(findPerson(people, 'katie')?.devices.map((d) => d.lane)).toEqual(['companion', 'site']);
  });

  it('finds a person by subject or email, whatever the case', () => {
    expect(findPerson(people, 'KATIE')?.email).toBe('wife@example.test');
    expect(findPerson(people, 'Wife@Example.test')?.key).toBe('katie');
    expect(findPerson(people, 'nobody')).toBeNull();
  });
});
