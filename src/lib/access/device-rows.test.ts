import { describe, expect, it } from 'vitest';
import { LANE_LABEL, appLabel, mergeDeviceRows, phoneLabel } from './device-rows';

const NOW = new Date('2026-09-26T12:00:00Z');

const site = [
  {
    id: 's1',
    ownerEmail: 'Owner@Example.com',
    label: 'SR iPhone',
    createdAt: new Date('2026-09-20T10:00:00Z'),
    expiresAt: new Date('2026-12-20T10:00:00Z'),
    revokedAt: null,
    lastUsedAt: new Date('2026-09-26T11:00:00Z'),
  },
  {
    id: 's2',
    ownerEmail: 'jane@example.com',
    label: null,
    createdAt: new Date('2026-08-01T10:00:00Z'),
    expiresAt: new Date('2026-09-01T10:00:00Z'),
    revokedAt: null,
    lastUsedAt: null,
  },
  {
    id: 's3',
    ownerEmail: 'jane@example.com',
    label: null,
    createdAt: new Date('2026-09-02T10:00:00Z'),
    expiresAt: new Date('2026-12-02T10:00:00Z'),
    revokedAt: new Date('2026-09-10T10:00:00Z'),
    lastUsedAt: null,
  },
];

const pilot = [
  { id: 'h1', email: 'jane@example.com', name: 'Jane', label: 'iPhone 15', created: '2026-09-21T00:00:00Z', expires: null, lastUsed: '2026-09-26T09:00:00Z' },
  { id: 'h2', email: 'kid@example.com', name: 'Kid', label: null, created: '2026-09-22T00:00:00Z', expires: null, lastUsed: null },
];

const names = new Map([
  ['owner@example.com', 'You'],
  ['jane@example.com', 'Jane Doe'],
]);

describe('mergeDeviceRows', () => {
  const rows = mergeDeviceRows(site, pilot, names, NOW);

  it('keeps one row per credential across both lanes', () => {
    expect(rows).toHaveLength(5);
    expect(new Set(rows.map((r) => r.key)).size).toBe(5);
    expect(rows.filter((r) => r.lane === 'site')).toHaveLength(3);
    expect(rows.filter((r) => r.lane === 'companion')).toHaveLength(2);
  });

  it('names people from the site first, then the pilot, then the address', () => {
    expect(rows.find((r) => r.id === 's1')?.person).toBe('You');
    expect(rows.find((r) => r.id === 'h1')?.person).toBe('Jane Doe');
    expect(rows.find((r) => r.id === 'h2')?.person).toBe('Kid');
    expect(rows.find((r) => r.id === 's1')?.email).toBe('owner@example.com');
  });

  it('grades site rows active, expired or revoked', () => {
    expect(rows.find((r) => r.id === 's1')?.status).toBe('active');
    expect(rows.find((r) => r.id === 's2')?.status).toBe('expired');
    expect(rows.find((r) => r.id === 's3')?.status).toBe('revoked');
  });

  it('treats a pilot row as active unless its own expiry has passed', () => {
    expect(rows.find((r) => r.id === 'h1')?.status).toBe('active');
    const old = mergeDeviceRows([], [{ ...pilot[0], expires: '2026-09-01T00:00:00Z' }], names, NOW);
    expect(old[0].status).toBe('expired');
  });

  it('groups by person, companion before site, newest pairing first', () => {
    const jane = rows.filter((r) => r.person === 'Jane Doe').map((r) => r.id);
    expect(jane).toEqual(['h1', 's3', 's2']);
    const people = rows.map((r) => r.person);
    expect(people).toEqual([...people].sort((a, b) => a.localeCompare(b)));
  });

  it('works with the pilot unreachable (no pilot rows at all)', () => {
    const only = mergeDeviceRows(site, [], names, NOW);
    expect(only.every((r) => r.lane === 'site')).toBe(true);
    expect(only).toHaveLength(3);
  });

  it('serialises dates as ISO and tolerates junk', () => {
    expect(rows.find((r) => r.id === 's1')?.paired).toBe('2026-09-20T10:00:00.000Z');
    const junk = mergeDeviceRows([], [{ ...pilot[1], created: 'not a date' }], names, NOW);
    expect(junk[0].paired).toBe(null);
  });

  it('labels the lanes by what they open', () => {
    expect(LANE_LABEL.companion).toBe('Health & location');
    expect(LANE_LABEL.site).toBe('Chat & news');
  });

  it('carries what each phone said it was running, from either lane, and nothing from a silent one', () => {
    const told = mergeDeviceRows(
      [{ ...site[0], appVersion: '0.1.136', appBuild: 136, appCommit: '68136470', appSeenAt: new Date('2026-09-25T08:00:00Z'), osVersion: '26.0.1', deviceModel: 'iPhone15,2', deviceName: "Rory's iPhone" }],
      [{ ...pilot[0], app: { version: '0.1.134', build: 134, commit: null, channel: 'adhoc', since: '2026-09-24T08:00:00Z' }, os: '18.6', model: 'iPhone14,5', deviceName: null }],
      names,
      NOW,
    );
    expect(told.find((r) => r.id === 's1')).toMatchObject({
      app: { version: '0.1.136', build: 136, commit: '68136470', channel: null, since: '2026-09-25T08:00:00.000Z' },
      os: '26.0.1',
      model: 'iPhone15,2',
      deviceName: "Rory's iPhone",
    });
    expect(told.find((r) => r.id === 'h1')).toMatchObject({ app: { build: 134 }, os: '18.6', model: 'iPhone14,5', deviceName: null });
    expect(rows.find((r) => r.id === 's1')).toMatchObject({ app: null, os: null, model: null, deviceName: null });
  });
});

describe('labels', () => {
  it('describes the app by version and build, or nothing', () => {
    expect(appLabel({ app: { version: '0.1.136', build: 136, commit: null, channel: null, since: null } })).toBe('0.1.136 (136)');
    expect(appLabel({ app: { version: null, build: 136, commit: null, channel: null, since: null } })).toBe('build 136');
    expect(appLabel({ app: null })).toBeNull();
  });

  it('calls a phone by its own name first, with the model beside it', () => {
    expect(phoneLabel({ label: 'SR iPhone', model: null, deviceName: null })).toBe('SR iPhone');
    expect(phoneLabel({ label: null, model: null, deviceName: null })).toBe('iPhone');
    expect(phoneLabel({ label: 'iPhone', model: 'iPhone15,2', deviceName: null })).toBe('iPhone · iPhone15,2');
    expect(phoneLabel({ label: 'iPhone', model: 'iPhone15,2', deviceName: "Rory's iPhone" })).toBe("Rory's iPhone · iPhone15,2");
  });
});
