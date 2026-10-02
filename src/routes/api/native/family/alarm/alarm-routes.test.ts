import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AlarmRecord } from '$lib/family/alarm';

const OWNERS = ['owner@example.test'];

const h = vi.hoisted(() => ({
  role: 'owner' as 'owner' | 'member',
  viewer: null as null | { kind: 'member'; principalId: string; email: string; grants: Set<string> },
  alarms: new Map<string, AlarmRecord>(),
  raised: [] as Array<{ email: string; input: unknown }>,
  raiseResult: null as unknown,
  cancelled: [] as Array<{ id: string; by: string }>,
}));

vi.mock('$lib/server/native-handler', () => ({
  withNativeAccess:
    (_area: string, fn: (event: unknown, identity: unknown, role: string) => unknown) => async (event: unknown) => {
      const r = await fn(event, { ownerEmail: 'owner@example.test' }, h.role);
      return r instanceof Response ? r : Response.json(r);
    },
}));

vi.mock('$lib/server/access', () => ({ isOwnerEmail: (e: string) => OWNERS.includes(e.trim().toLowerCase()) }));

// The forecast's audience: Family Circle / Family Admin only.
vi.mock('$lib/home/presence/viewer', () => ({
  peopleViewerOf: async () => {
    const g = h.viewer?.grants;
    return g && (g.has('family:circle') || g.has('family:admin')) ? { kind: 'household', subject: null } : null;
  },
}));

vi.mock('$lib/family/alarm.server', () => ({
  alarmFromId: (e: string) => `f_${e.split('@')[0]}`,
  raiseAlarm: async (email: string, _parent: boolean, input: unknown) => {
    h.raised.push({ email, input });
    return h.raiseResult;
  },
  getAlarm: async (id: string) => h.alarms.get(id) ?? null,
  cancelAlarm: async (alarm: AlarmRecord, by: string) => {
    h.cancelled.push({ id: alarm.id, by });
    return { alarm: { ...alarm, cancelledAt: new Date('2026-10-02T12:05:00Z') }, pushed: 2 };
  },
  activeAlarms: async () => [...h.alarms.values()].filter((a) => !a.cancelledAt),
}));

function alarm(over: Partial<AlarmRecord> = {}): AlarmRecord {
  return {
    id: 'a-kid', fromEmail: 'kid@example.test', fromName: 'Kid', kind: 'siren', message: 'Help', lat: 51.5, lon: -0.1,
    accuracy: 10, recipientCount: 2, pushedCount: 2, createdAt: new Date('2026-10-02T12:00:00Z'), cancelledAt: null,
    cancelledByEmail: null, ...over,
  };
}

const route = await import('./+server');
const cancel = await import('./cancel/+server');

type Handler = (e: unknown) => Promise<Response>;
function call(handler: unknown, opts: { method?: string; body?: unknown; query?: string } = {}) {
  const request = new Request(`https://strangeramblings.com/api/native/family/alarm${opts.query ?? ''}`, {
    method: opts.method ?? 'GET',
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    headers: { 'content-type': 'application/json' },
  });
  const locals = { viewer: h.viewer ? Promise.resolve(h.viewer) : undefined };
  return (handler as Handler)({ request, locals, url: new URL(request.url) });
}

function asMember(email: string, grants: string[]) {
  h.role = 'member';
  h.viewer = { kind: 'member', principalId: 'p', email, grants: new Set(grants) };
}

beforeEach(() => {
  h.role = 'owner';
  h.viewer = null;
  h.alarms = new Map([['a-kid', alarm()], ['a-owner', alarm({ id: 'a-owner', fromEmail: 'owner@example.test', fromName: 'Owner' })]]);
  h.raised = [];
  h.cancelled = [];
  h.raiseResult = { kind: 'new', alarm: alarm({ id: 'a-new' }), pushed: 3, recipients: 2 };
});

describe('family alarm — who gets in', () => {
  it('refuses a member with no family grant, on every route', async () => {
    asMember('guest@example.test', ['games:self', 'chat:self']);
    expect((await call(route.GET)).status).toBe(403);
    expect((await call(route.POST, { method: 'POST', body: { kind: 'siren' } })).status).toBe(403);
    expect((await call(cancel.POST, { method: 'POST', body: { alarmId: 'a-kid' } })).status).toBe(403);
    expect(h.raised).toEqual([]);
    expect(h.cancelled).toEqual([]);
  });

  it('lets a Family Circle member raise it, as themselves', async () => {
    asMember('kid@example.test', ['family:circle']);
    const res = await call(route.POST, { method: 'POST', body: { kind: 'morse', message: ' Help ' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ alarmId: 'a-new', pushed: 3, recipients: 2, existing: false });
    expect(h.raised).toEqual([{ email: 'kid@example.test', input: { kind: 'morse', message: 'Help', position: null } }]);
  });
});

describe('POST /api/native/family/alarm', () => {
  it('answers a repeat press with the alarm already sounding', async () => {
    h.raiseResult = { kind: 'existing', alarm: alarm(), pushed: 2, recipients: 2 };
    expect(await (await call(route.POST, { method: 'POST', body: { kind: 'siren' } })).json()).toEqual({
      alarmId: 'a-kid', pushed: 2, recipients: 2, existing: true,
    });
  });

  it('is 429 with retry-after inside the gap', async () => {
    h.raiseResult = { kind: 'limited', retryAfterSeconds: 17 };
    const res = await call(route.POST, { method: 'POST', body: { kind: 'siren' } });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('17');
    expect(await res.json()).toMatchObject({ retryAfter: 17 });
  });

  it('is 400 for an unknown kind', async () => {
    expect((await call(route.POST, { method: 'POST', body: { kind: 'klaxon' } })).status).toBe(400);
    expect(h.raised).toEqual([]);
  });
});

describe('GET /api/native/family/alarm', () => {
  it('lists everybody else’s active alarms, without emails', async () => {
    asMember('kid@example.test', ['family:circle']);
    const body = await (await call(route.GET)).json();
    expect(body.alarms.map((a: { alarmId: string }) => a.alarmId)).toEqual(['a-owner']);
    expect(body.alarms[0]).toMatchObject({ from: 'f_owner', name: 'Owner', kind: 'siren', at: '2026-10-02T12:00:00.000Z', cancelledAt: null });
    expect(JSON.stringify(body)).not.toContain('@');
  });

  it('includes the caller’s own with ?mine=1', async () => {
    asMember('kid@example.test', ['family:admin']);
    const body = await (await call(route.GET, { query: '?mine=1' })).json();
    expect(body.alarms.map((a: { alarmId: string }) => a.alarmId).sort()).toEqual(['a-kid', 'a-owner']);
  });
});

describe('POST /api/native/family/alarm/cancel', () => {
  it('lets the sender stand theirs down', async () => {
    asMember('kid@example.test', ['family:circle']);
    const res = await call(cancel.POST, { method: 'POST', body: { alarmId: 'a-kid' } });
    expect(await res.json()).toEqual({ alarmId: 'a-kid', cancelledAt: '2026-10-02T12:05:00.000Z', pushed: 2 });
    expect(h.cancelled).toEqual([{ id: 'a-kid', by: 'kid@example.test' }]);
  });

  it('lets the owner stand anyone’s down', async () => {
    expect((await call(cancel.POST, { method: 'POST', body: { alarmId: 'a-kid' } })).status).toBe(200);
  });

  it('refuses another member — a Family Admin included', async () => {
    asMember('parent@example.test', ['family:circle', 'family:admin']);
    expect((await call(cancel.POST, { method: 'POST', body: { alarmId: 'a-kid' } })).status).toBe(403);
    expect(h.cancelled).toEqual([]);
  });

  it('is 404 for an unknown alarm and 400 without an id', async () => {
    expect((await call(cancel.POST, { method: 'POST', body: { alarmId: 'nope' } })).status).toBe(404);
    expect((await call(cancel.POST, { method: 'POST', body: {} })).status).toBe(400);
  });
});
