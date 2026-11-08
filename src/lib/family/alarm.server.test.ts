import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PushMessage } from '$lib/server/apns';
import type { AlarmRecord } from './alarm';

const h = vi.hoisted(() => ({
  latest: null as AlarmRecord | null,
  inserted: [] as Array<Record<string, unknown>>,
  recorded: [] as Array<{ email: string; name: string; body: string; counts: { recipients: number; pushed: number } }>,
  positions: [] as Array<{ subject: string; lat: number; lon: number; at: string; isHome: boolean | null }>,
}));

// Just enough of drizzle for raiseAlarm: the locked read of the sender's
// latest alarm, the insert, and the pushed-count update.
vi.mock('$lib/db', () => {
  const chain = (result: () => unknown) => {
    const c: Record<string, unknown> = {};
    for (const k of ['from', 'where', 'orderBy', 'set']) c[k] = () => c;
    c.limit = async () => result();
    c.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, err);
    return c;
  };
  const tx = {
    execute: async () => ({ rows: [] }),
    select: () => chain(() => (h.latest ? [h.latest] : [])),
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        returning: async () => {
          h.inserted.push(v);
          return [{ id: `a-${h.inserted.length}`, pushedCount: 0, cancelledAt: null, cancelledByEmail: null, ...v }];
        },
      }),
    }),
  };
  return { db: { transaction: async (fn: (t: typeof tx) => unknown) => fn(tx), update: () => chain(() => undefined) } };
});

vi.mock('$lib/server/access', () => ({
  getOwnerEmails: () => ['owner@example.test', 'owner.alt@example.test'],
  isOwnerEmail: (e: string) => ['owner@example.test', 'owner.alt@example.test'].includes(e.trim().toLowerCase()),
}));
vi.mock('$lib/family/roster.server', () => ({
  familyId: (e: string) => `f_${e.split('@')[0]}`,
  familyRoster: async () => [
    { id: 'f_owner', email: 'owner@example.test', name: 'John', parent: true, pilot: true },
    { id: 'f_kid', email: 'kid@example.test', name: 'Kid', parent: false, pilot: true },
    { id: 'f_parent', email: 'parent@example.test', name: 'Parent', parent: true, pilot: true },
  ],
  familyPersonFor: async (email: string, parent: boolean) => ({ id: `f_${email.split('@')[0]}`, email, name: 'Kid', parent, pilot: true }),
}));
vi.mock('$lib/family/messages.server', () => ({
  senderSubjects: async () => (e: string) => ({ 'owner@example.test': 'john', 'owner.alt@example.test': 'john', 'parent@example.test': 'mum' })[e] ?? null,
  recordMessage: async (email: string, name: string, body: string, counts: { recipients: number; pushed: number }) => {
    h.recorded.push({ email, name, body, counts });
    return {};
  },
}));
vi.mock('$lib/home/presence/household', () => ({ livePositions: async () => h.positions }));

const { raiseAlarm } = await import('./alarm.server');

const NOW = new Date('2026-10-27T12:00:00Z');
// Due north of the alarm: 10 km straight is 13 road-km (23 min); 0.1 km is 1 min.
const north = (km: number) => ({ lat: 54.5 + (km / 6371) * (180 / Math.PI), lon: -1.55 });

function pusher() {
  const sent: Array<{ emails: readonly string[]; message: PushMessage }> = [];
  const push = vi.fn(async (emails: readonly string[], message: PushMessage) => {
    sent.push({ emails, message });
    return { reached: new Set<string>(), sent: emails.length, failed: 0 };
  });
  return { push, sent };
}

const quietInput = {
  kind: 'quiet' as const,
  message: 'Come now',
  position: { lat: 54.5, lon: -1.55, accuracy: 10 },
  battery: 0.23,
  place: 'Elton Parade, Darlington',
};

/** The kid's Bat phone, pressed a minute ago and still active. */
const activeQuiet = (): AlarmRecord => ({
  id: 'a-quiet', fromEmail: 'kid@example.test', fromName: 'Kid', kind: 'quiet', message: null, lat: null, lon: null, accuracy: null,
  battery: null, place: null, recipientCount: 2, pushedCount: 3, createdAt: new Date(NOW.getTime() - 60_000), cancelledAt: null,
  cancelledByEmail: null,
});

beforeEach(() => {
  h.latest = null;
  h.inserted = [];
  h.recorded = [];
  h.positions = [
    { subject: 'john', ...north(10), at: '2026-10-27T11:30:00.000Z', isHome: false },
    { subject: 'mum', ...north(0.1), at: '2026-10-27T11:59:00.000Z', isHome: true },
  ];
});

describe('raiseAlarm — the Bat phone', () => {
  it('stores battery and place, and pushes each person the drive from them', async () => {
    const { push, sent } = pusher();
    const r = await raiseAlarm('kid@example.test', false, quietInput, NOW, push);
    expect(r).toMatchObject({ kind: 'new', pushed: 3, recipients: 2 });
    expect(h.inserted[0]).toMatchObject({ kind: 'quiet', battery: 0.23, place: 'Elton Parade, Darlington', lat: 54.5 });
    expect(sent.map((s) => [[...s.emails].sort(), s.message.body])).toEqual([
      [['owner.alt@example.test', 'owner@example.test'], 'At Elton Parade, Darlington · battery 23% · about 23 min drive from you\nCome now'],
      [['parent@example.test'], 'At Elton Parade, Darlington · battery 23% · about 1 min drive from you\nCome now'],
    ]);
    expect(sent.every((s) => s.message.title === 'Bat phone — Kid' && s.message.sound === 'default')).toBe(true);
  });

  it('writes it into msg family once, with the push’s counts, without pushing again', async () => {
    const { push } = pusher();
    await raiseAlarm('kid@example.test', false, quietInput, NOW, push);
    expect(h.recorded).toEqual([
      {
        email: 'kid@example.test',
        name: 'Kid',
        body: '🦇 Bat phone — at Elton Parade, Darlington · battery 23%\nCome now',
        counts: { recipients: 2, pushed: 3 },
      },
    ]);
    expect(push).toHaveBeenCalledTimes(2);
  });

  it('goes without the drive when positions cannot be read', async () => {
    h.positions = [];
    const { push, sent } = pusher();
    await raiseAlarm('kid@example.test', false, { ...quietInput, message: null }, NOW, push);
    expect(sent).toHaveLength(1);
    expect(sent[0].message.body).toBe('At Elton Parade, Darlington · battery 23%');
  });

  it('escalates: the siren pressed during an active Bat phone rings everyone with the siren', async () => {
    h.latest = activeQuiet();
    const { push, sent } = pusher();
    const r = await raiseAlarm('kid@example.test', false, { kind: 'siren', message: null, position: null, battery: null, place: null }, NOW, push);
    expect(r.kind).toBe('new');
    expect(sent).toHaveLength(1);
    expect(sent[0].message).toMatchObject({ title: 'Kid raised the alarm', sound: 'sr-siren.caf' });
    expect(h.recorded).toEqual([]);
  });

  it('answers a second Bat phone with the active one, ringing nobody', async () => {
    h.latest = activeQuiet();
    const { push } = pusher();
    const r = await raiseAlarm('kid@example.test', false, quietInput, NOW, push);
    expect(r).toMatchObject({ kind: 'existing', pushed: 3, recipients: 2 });
    expect(push).not.toHaveBeenCalled();
    expect(h.recorded).toEqual([]);
  });
});
