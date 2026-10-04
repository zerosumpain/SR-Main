import { beforeEach, describe, expect, it, vi } from 'vitest';

// The service lane and the household table are the only things this module
// talks to. Mocking both exercises the paths asked for and the whole
// projection without SR-Health or a database. Every name, email and coordinate
// here is synthetic: this repository is public.

const h = vi.hoisted(() => ({
  calls: [] as string[],
  respond: (_path: string): unknown => {
    throw new Error('no response set');
  },
  members: [] as Array<{ subject: string; email: string | null; displayName: string }>,
}));

vi.mock('$lib/server/extracted-app', () => ({
  getFromExtracted: vi.fn(async (_app: string, path: string) => {
    h.calls.push(path);
    return h.respond(path);
  }),
}));

vi.mock('$lib/home/presence/members', () => ({
  listMembers: async () => h.members,
}));

import { familyChangeId, familyId, familySubjectId } from './roster.server';
import {
  LANDGRAB_CHANGES_PATH,
  LANDGRAB_WEEKS_PATH,
  TRACE_MAX,
  getFamilyLandgrabChanges,
  getFamilyLandgrabWeeks,
  isWeekShape,
  landgrabPeople,
  upstreamStatus,
  type UpstreamChanges,
  type UpstreamWeeks,
} from './landgrab.server';

const MEMBERS = [
  { subject: 'sam', email: 'Sam@Example.test', displayName: 'Sam' },
  { subject: 'alex', email: 'alex@example.test', displayName: 'Alex' },
  // On Life360 only: no email, so no steps-board id to share.
  { subject: 'robin', email: null, displayName: 'Robin' },
];

const person = (subject: string, over: Partial<UpstreamWeeks['weeks'][0]['people'][0]> = {}) => ({
  subject, won: 0, taken: 0, lost: 0, net: 0, held: 0, rank: 1, colour: '#123456', ...over,
});

const WEEKS: UpstreamWeeks = {
  updatedAt: '2026-10-04T08:00:00.000Z',
  weeks: [
    {
      start: '2026-09-28', end: '2026-10-04', current: true,
      people: [
        person('alex', { won: 41, taken: 12, lost: 3, net: 38, held: 211, rank: 1, colour: '#aa0000' }),
        person('robin', { won: 5, lost: 1, net: 4, held: 20, rank: 2 }),
        person('sam', { rank: 3 }),
        // Health should never answer for someone Main did not ask about.
        person('stranger', { won: 99 }),
      ],
    },
    { start: '2026-09-21', end: '2026-09-27', current: false, people: [person('sam'), person('alex'), person('robin')] },
  ],
};

// Synthetic ground in a public park, nowhere real to anyone.
const poly = (lat: number, lon: number): [number, number][] =>
  Array.from({ length: 6 }, (_, i) => [lat + i * 0.0001, lon + i * 0.0001]);

const CHANGES: UpstreamChanges = {
  week: { start: '2026-09-28', end: '2026-10-04', current: true },
  bounds: { minLat: 40.764, minLon: -73.981, maxLat: 40.8, maxLon: -73.949 },
  focus: { lat: 40.78123, lon: -73.96654, radiusM: 3219 },
  people: [{ subject: 'alex', colour: '#aa0000' }, { subject: 'sam', colour: '#00aa00' }, { subject: 'robin', colour: '#0000aa' }],
  hexes: [
    { id: 0, polygon: poly(40.77, -73.97), owner: 'alex', previous: 'sam' },
    { id: 1, polygon: poly(40.771, -73.97), owner: 'alex', previous: null },
    { id: 2, polygon: poly(40.772, -73.97), owner: 'robin', previous: 'alex' },
    { id: 3, polygon: poly(40.773, -73.97), owner: 'stranger', previous: null },
  ],
  changes: [
    {
      id: 'trail:alex:2026-10-01T09:12', subject: 'alex', at: '2026-10-01T09:40:00.000Z', won: 2, taken: 1,
      from: [{ subject: 'sam', hexes: 1 }, { subject: null, hexes: 1 }], hexIds: [0, 1],
      activity: {
        kind: 'trail', type: 'walk', startedAt: '2026-10-01T09:12:00.000Z', endedAt: '2026-10-01T09:40:00.000Z',
        distanceM: 3400, durationS: 1680, loop: true,
        trace: Array.from({ length: 900 }, (_, i) => [40.77 + i * 1e-6 + 1.234e-7, -73.97 - i * 1e-6] as [number, number]),
      },
    },
    {
      id: 'workout:abc', subject: 'robin', at: '2026-09-30T18:00:00.000Z', won: 1, taken: 1,
      from: [{ subject: 'alex', hexes: 1 }], hexIds: [2], activity: null,
    },
    {
      id: 'unattributed:stranger', subject: 'stranger', at: '2026-09-29T08:00:00.000Z', won: 1, taken: 0,
      from: [{ subject: null, hexes: 1 }], hexIds: [3], activity: null,
    },
  ],
};

beforeEach(() => {
  h.calls.length = 0;
  h.members = MEMBERS.map((m) => ({ ...m }));
  h.respond = (path) => (path.startsWith(LANDGRAB_WEEKS_PATH) ? WEEKS : CHANGES);
});

describe('the SR-Health paths SR-Main depends on', () => {
  // A cross-repository dependency neither build can see: if SR-Health renames
  // either path, this is the line that says so on Main's side.
  it('asks exactly /api/health/landgrab/family/weeks and /family/changes', async () => {
    expect(LANDGRAB_WEEKS_PATH).toBe('/api/health/landgrab/family/weeks');
    expect(LANDGRAB_CHANGES_PATH).toBe('/api/health/landgrab/family/changes');
    await getFamilyLandgrabWeeks(6, 'sam@example.test');
    await getFamilyLandgrabChanges('2026-09-28');
    expect(h.calls).toEqual([
      '/api/health/landgrab/family/weeks?subjects=sam%2Calex%2Crobin&weeks=6',
      '/api/health/landgrab/family/changes?week=2026-09-28&subjects=sam%2Calex%2Crobin',
    ]);
  });

  it('does not ask Health at all when the household is empty', async () => {
    h.members = [];
    expect(await getFamilyLandgrabWeeks(6, 'sam@example.test')).toEqual({ updatedAt: null, weeks: [] });
    expect(h.calls).toEqual([]);
  });
});

describe('who is who', () => {
  it('gives a member with an email the steps board id, and one without a stable keyed hash', async () => {
    const people = await landgrabPeople();
    expect(people.map((p) => p.id)).toEqual([
      familyId('sam@example.test'),
      familyId('alex@example.test'),
      familySubjectId('robin'),
    ]);
    expect(familySubjectId('robin')).toMatch(/^f_[0-9a-f]{12}$/);
    expect(familySubjectId('robin')).toBe(familySubjectId('robin'));
    expect(familySubjectId('robin')).not.toBe(familyId('robin'));
  });

  it('skips a member with no subject and a duplicated subject', async () => {
    h.members = [...MEMBERS, { subject: '', email: 'x@example.test', displayName: 'X' }, { ...MEMBERS[0] }];
    expect((await landgrabPeople()).map((p) => p.name)).toEqual(['Sam', 'Alex', 'Robin']);
  });
});

describe('the weekly board', () => {
  it('keys people by id, names them, marks the caller and drops anyone not asked for', async () => {
    const body = await getFamilyLandgrabWeeks(6, ' ALEX@example.test ');
    expect(body.updatedAt).toBe('2026-10-04T08:00:00.000Z');
    expect(body.weeks).toHaveLength(2);
    expect(body.weeks[0]).toEqual({
      start: '2026-09-28', end: '2026-10-04', current: true,
      people: [
        { id: familyId('alex@example.test'), name: 'Alex', me: true, won: 41, taken: 12, lost: 3, net: 38, held: 211, rank: 1, colour: '#aa0000' },
        { id: familySubjectId('robin'), name: 'Robin', me: false, won: 5, taken: 0, lost: 1, net: 4, held: 20, rank: 2, colour: '#123456' },
        { id: familyId('sam@example.test'), name: 'Sam', me: false, won: 0, taken: 0, lost: 0, net: 0, held: 0, rank: 3, colour: '#123456' },
      ],
    });
    const text = JSON.stringify(body);
    for (const leak of ['"subject"', 'stranger', 'robin', 'alex@', 'sam@', '@']) expect(text).not.toContain(leak);
  });
});

describe('the map of a week', () => {
  it('replaces every subject with an id, and every change id with an opaque one', async () => {
    const body = await getFamilyLandgrabChanges('2026-09-28');
    const alex = familyId('alex@example.test');
    const sam = familyId('sam@example.test');
    const robin = familySubjectId('robin');

    expect(body.people).toEqual([
      { id: alex, name: 'Alex', colour: '#aa0000' },
      { id: sam, name: 'Sam', colour: '#00aa00' },
      { id: robin, name: 'Robin', colour: '#0000aa' },
    ]);
    expect(body.hexes.map((x) => [x.id, x.owner, x.previous])).toEqual([
      [0, alex, sam],
      [1, alex, null],
      [2, robin, alex],
    ]);
    expect(body.changes.map((c) => c.id)).toEqual([familyChangeId('trail:alex:2026-10-01T09:12'), familyChangeId('workout:abc')]);
    // Stable across calls, so the phone keeps its selection on a refresh.
    expect((await getFamilyLandgrabChanges('2026-09-28')).changes.map((c) => c.id)).toEqual(body.changes.map((c) => c.id));
    expect(body.changes[0]).toMatchObject({
      personId: alex, at: '2026-10-01T09:40:00.000Z', won: 2, taken: 1,
      from: [{ id: sam, hexes: 1 }, { id: null, hexes: 1 }], hexIds: [0, 1],
      activity: { kind: 'trail', type: 'walk', distanceM: 3400, durationS: 1680, loop: true },
    });
    expect(body.changes[1]).toMatchObject({ personId: robin, from: [{ id: alex, hexes: 1 }], activity: null });
    expect(body.bounds).toEqual(CHANGES.bounds);
    expect(body.focus).toEqual({ lat: 40.7812, lon: -73.9665, radiusM: 3219 });
    expect(body).not.toHaveProperty('truncated');

    const text = JSON.stringify(body);
    for (const leak of ['"subject"', 'stranger', 'robin', 'alex', '"sam', ':sam', '@']) expect(text).not.toContain(leak);
  });

  it('sends no household subject string anywhere, on either endpoint', async () => {
    const subjects = MEMBERS.map((m) => m.subject).concat('stranger');
    const bodies = [
      JSON.stringify(await getFamilyLandgrabWeeks(6, 'sam@example.test')),
      JSON.stringify(await getFamilyLandgrabChanges('2026-09-28')),
    ];
    for (const text of bodies) {
      expect(text).not.toContain('"subject"');
      for (const subject of subjects) expect(text, subject).not.toContain(subject);
    }
  });

  it('holds the trace to the contract ceiling at five decimal places', async () => {
    const trace = (await getFamilyLandgrabChanges('2026-09-28')).changes[0].activity!.trace!;
    expect(trace.length).toBe(TRACE_MAX);
    for (const [lat, lon] of trace) {
      expect(Math.round(lat * 1e5) / 1e5).toBe(lat);
      expect(Math.round(lon * 1e5) / 1e5).toBe(lon);
    }
  });

  it('passes Health’s nulls through: undated unattributed ground, no trace, an unnamed previous holder', async () => {
    h.respond = () => ({
      ...CHANGES,
      hexes: [{ id: 0, polygon: poly(40.77, -73.97), owner: 'sam', previous: null }],
      changes: [
        { id: 'unattributed:sam', subject: 'sam', at: null, won: 2, taken: 2, from: [{ subject: null, hexes: 2 }], hexIds: [0], activity: null },
        {
          id: 'trail:sam:2026-10-01T09:12:00.000Z', subject: 'sam', at: '2026-10-01T09:30:00.000Z', won: 1, taken: 0, from: [{ subject: null, hexes: 1 }], hexIds: [0],
          activity: { kind: 'trail', type: null, startedAt: '2026-10-01T09:12:00.000Z', endedAt: null, distanceM: null, durationS: null, loop: true, trace: null },
        },
      ],
    });
    const body = await getFamilyLandgrabChanges('2026-09-28');
    const sam = familyId('sam@example.test');
    expect(body.hexes[0]).toMatchObject({ owner: sam, previous: null });
    expect(body.changes[0]).toMatchObject({ personId: sam, at: null, from: [{ id: null, hexes: 2 }], activity: null });
    expect(body.changes[1].activity).toMatchObject({ kind: 'trail', type: null, trace: null });
  });

  it('asks in lower case and maps Health’s lower-case answer back to a mixed-case subject', async () => {
    h.members = [{ subject: 'Sam', email: 'sam@example.test', displayName: 'Sam' }];
    h.respond = () => ({ updatedAt: null, weeks: [{ start: '2026-09-28', end: '2026-10-04', current: true, people: [person('sam')] }] });
    const body = await getFamilyLandgrabWeeks(1, 'sam@example.test');
    expect(h.calls[0]).toContain('subjects=sam&');
    expect(body.weeks[0].people.map((p) => p.id)).toEqual([familyId('sam@example.test')]);
  });

  it('answers an empty map for an empty household without asking Health (subjects is required there)', async () => {
    h.members = [];
    const body = await getFamilyLandgrabChanges('2026-09-28', new Date('2026-10-02T12:00:00Z'));
    expect(body).toEqual({ week: { start: '2026-09-28', end: '2026-10-04', current: true }, bounds: null, focus: null, people: [], hexes: [], changes: [] });
    expect(h.calls).toEqual([]);
  });

  it('passes truncated through only when Health set it', async () => {
    h.respond = () => ({ ...CHANGES, truncated: true });
    expect((await getFamilyLandgrabChanges('2026-09-28')).truncated).toBe(true);
  });
});

describe('small rules', () => {
  it('turns a change id into a stable, opaque c_ id', () => {
    const id = familyChangeId('unattributed:sam');
    expect(id).toMatch(/^c_[0-9a-f]{16}$/);
    expect(familyChangeId('unattributed:sam')).toBe(id);
    expect(familyChangeId('unattributed:alex')).not.toBe(id);
  });

  it('accepts only a real calendar date as a week', () => {
    expect(isWeekShape('2026-09-28')).toBe(true);
    for (const bad of [null, '', '2026-9-28', '2026-02-30', '2026-09-28T00:00', '../x']) expect(isWeekShape(bad)).toBe(false);
  });

  it('reads the upstream status from the lane’s message, and nothing else', () => {
    expect(upstreamStatus(new Error('health/api/x returned 400'))).toBe(400);
    expect(upstreamStatus(new Error('health/api/x timed out after 15000ms'))).toBeNull();
    expect(upstreamStatus('returned 400')).toBeNull();
  });
});
