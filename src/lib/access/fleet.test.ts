import { describe, expect, it } from 'vitest';
import { buildFleet } from './fleet';
import type { DeviceRow } from './device-rows';

const NOW = new Date('2026-10-20T12:00:00Z');

function row(over: Partial<DeviceRow> & Pick<DeviceRow, 'key' | 'lane' | 'email'>): DeviceRow {
  return {
    id: over.key,
    person: over.email,
    label: over.lane === 'site' ? 'iPhone' : 'SR iPhone',
    paired: '2026-10-01T00:00:00.000Z',
    lastUsed: null,
    expires: null,
    status: 'active',
    app: null,
    os: null,
    model: null,
    deviceName: null,
    push: null,
    ...over,
  };
}

const app = (build: number, channel: string | null = 'testflight') => ({ version: `0.1.${build}`, build, commit: null, channel, since: null });

describe('buildFleet', () => {
  it('shows a site row and a companion row of one person with the same model and name as ONE phone', () => {
    const fleet = buildFleet({
      rows: [
        row({ key: 's1', lane: 'site', email: 'rory@example.test', model: 'iPhone15,2', deviceName: "Rory's iPhone", app: app(137, 'adhoc'), lastUsed: '2026-10-20T11:00:00.000Z', push: true }),
        row({ key: 'c1', lane: 'companion', email: 'rory@example.test', model: 'iPhone15,2', deviceName: "Rory's iPhone", app: app(137, 'adhoc'), lastUsed: '2026-10-20T11:30:00.000Z' }),
      ],
      enrolled: [],
      latestBuild: 137,
      copyDevices: [],
      names: new Map([['rory@example.test', 'Rory']]),
      now: NOW,
    });
    expect(fleet.people).toHaveLength(1);
    const [phone] = fleet.people[0].phones;
    expect(phone).toMatchObject({
      person: 'Rory',
      label: "Rory's iPhone · iPhone15,2",
      lanes: ['site', 'companion'],
      ids: { site: 's1', companion: 'c1' },
      channel: 'adhoc',
      build: 'current',
      lastSeen: '2026-10-20T11:30:00.000Z',
      lastUpload: '2026-10-20T11:30:00.000Z',
      push: true,
    });
    expect(fleet.totals).toEqual({ phones: 1, stale: 0, behind: 0, noPush: 0, notInCopy: 0 });
  });

  it('keeps rows apart when they could be different phones: no model, a different name, or a second phone', () => {
    const fleet = buildFleet({
      rows: [
        row({ key: 's-old', lane: 'site', email: 'k@example.test' }),
        row({ key: 'c-old', lane: 'companion', email: 'k@example.test' }),
        row({ key: 's-a', lane: 'site', email: 'k@example.test', model: 'iPhone14,5', deviceName: 'A' }),
        row({ key: 'c-b', lane: 'companion', email: 'k@example.test', model: 'iPhone14,5', deviceName: 'B' }),
        row({ key: 's-x', lane: 'site', email: 'k@example.test', model: 'iPad13,1' }),
        row({ key: 'c-x1', lane: 'companion', email: 'k@example.test', model: 'iPad13,1' }),
        row({ key: 'c-x2', lane: 'companion', email: 'k@example.test', model: 'iPad13,1' }),
      ],
      enrolled: [],
      latestBuild: null,
      copyDevices: null,
      names: new Map(),
      now: NOW,
    });
    const keys = fleet.people[0].phones.map((p) => p.key).sort();
    expect(keys).toEqual(['c-b', 'c-old', 'c-x2', 's-a', 's-old', 's-x+c-x1']);
    expect(fleet.people[0].phones.every((p) => p.build === 'unknown')).toBe(true);
  });

  it('grades each phone against the newest build and counts what needs attention', () => {
    const fleet = buildFleet({
      rows: [
        row({ key: 's1', lane: 'site', email: 'a@example.test', model: 'iPhone15,2', app: app(130), lastUsed: '2026-10-01T00:00:00.000Z', push: false }),
        row({ key: 's2', lane: 'site', email: 'b@example.test', model: 'iPhone15,2', app: app(137), lastUsed: '2026-10-20T00:00:00.000Z', push: true }),
        row({ key: 's3', lane: 'site', email: 'c@example.test', status: 'revoked', app: app(1) }),
      ],
      enrolled: [
        { id: 'e1', email: 'A@example.test', name: "A's iPhone", product: 'iPhone15,2', osVersion: '26.0', enrolledAt: new Date('2026-10-19T20:00:00Z') },
        { id: 'e2', email: 'd@example.test', name: "D's iPad", product: 'iPad13,1', osVersion: null, enrolledAt: '2026-10-19T21:00:00Z' },
      ],
      latestBuild: 137,
      copyDevices: ["a's iphone"],
      names: new Map([['a@example.test', 'Ann']]),
      now: NOW,
    });
    expect(fleet.people.map((p) => p.person)).toEqual(['Ann', 'b@example.test', 'd@example.test']);
    expect(fleet.people[0].phones[0]).toMatchObject({ build: 'behind', push: false });
    expect(fleet.people[0].enrolments[0]).toMatchObject({ name: "A's iPhone", inLatestCopy: true, enrolledAt: '2026-10-19T20:00:00.000Z' });
    // Enrolled only — no credential yet — still a person on the list.
    expect(fleet.people[2]).toMatchObject({ phones: [], enrolments: [expect.objectContaining({ inLatestCopy: false })] });
    expect(fleet.totals).toEqual({ phones: 2, stale: 1, behind: 1, noPush: 1, notInCopy: 1 });
  });

  it('cannot say who is missing from a copy it could not read', () => {
    const fleet = buildFleet({
      rows: [],
      enrolled: [{ id: 'e', email: 'x@example.test', name: "X's iPhone", product: null, osVersion: null, enrolledAt: NOW }],
      latestBuild: null,
      copyDevices: null,
      names: new Map(),
      now: NOW,
    });
    expect(fleet.people[0].enrolments[0].inLatestCopy).toBeNull();
    expect(fleet.totals.notInCopy).toBe(0);
  });
});
