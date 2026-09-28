import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskRecord } from '$lib/family/tasks';

const h = vi.hoisted(() => ({
  role: 'owner' as 'owner' | 'member',
  viewer: null as null | { kind: 'member'; principalId: string; email: string; grants: Set<string> },
  tasks: new Map<string, TaskRecord>(),
  notified: [] as Array<{ kind: string; actor: string; doer?: string | null }>,
  created: [] as Array<Record<string, unknown>>,
}));

vi.mock('$lib/server/native-handler', () => ({
  // The gate, handler called straight through, as the owner or a member.
  withNativeAccess:
    (_area: string, fn: (event: unknown, identity: unknown, role: string) => unknown) => async (event: unknown) => {
      const r = await fn(event, { ownerEmail: 'owner@example.test' }, h.role);
      return r instanceof Response ? r : Response.json(r);
    },
}));

const ROSTER = [
  { id: 'f_owner', email: 'owner@example.test', name: 'Owner', parent: true, pilot: true },
  { id: 'f_kid', email: 'kid@example.test', name: 'Kid', parent: false, pilot: true },
];
vi.mock('$lib/family/roster.server', () => ({
  familyRoster: async () => ROSTER,
  familyId: (e: string) => `f_${e.split('@')[0]}`,
  familyPersonFor: async (email: string, parent: boolean) => ({
    id: `f_${email.split('@')[0]}`, email, name: email.split('@')[0], parent, pilot: false,
  }),
}));

vi.mock('$lib/family/steps.server', () => ({
  stepsBoard: async () => ({
    window: { day: '2026-09-28', from: 0, to: 0, tz: -60 },
    checkedAt: new Date('2026-09-28T10:15:00Z'),
    yesterday: { leaderName: 'Kid', steps: 14000 },
    board: [
      { id: 'f_kid', email: 'kid@example.test', name: 'Kid', steps: 9000, rank: 1, updatedAt: new Date(), reachedAt: new Date('2026-09-28T10:00:00Z') },
      { id: 'f_owner', email: 'owner@example.test', name: 'Owner', steps: 0, rank: 2, updatedAt: new Date(8.64e15), reachedAt: null },
    ],
  }),
}));

vi.mock('$lib/family/tasks.server', () => ({
  loadTasks: async () => [...h.tasks.values()],
  getTask: async (id: string) => {
    const t = h.tasks.get(id);
    return t && t.status !== 'deleted' ? t : null;
  },
  createTask: async (fields: Record<string, unknown>, createdByEmail: string) => {
    h.created.push({ ...fields, createdByEmail });
    return base({ id: 'new', ...fields, createdByEmail } as Partial<TaskRecord>);
  },
  applyTransition: async (id: string, t: { from: string; patch: Partial<TaskRecord> }) => {
    const cur = h.tasks.get(id);
    if (!cur || cur.status !== t.from) return null;
    const next = { ...cur, ...t.patch };
    h.tasks.set(id, next);
    return next;
  },
  notifyTaskChange: async (kind: string, _task: TaskRecord, actor: string, opts: { doerEmail?: string | null } = {}) => {
    h.notified.push({ kind, actor, doer: opts.doerEmail });
    return 1;
  },
}));

function base(over: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 't1', title: 'Bins', notes: null, deadline: null, assigneeEmail: null, createdByEmail: 'owner@example.test',
    status: 'open', doneByEmail: null, doneAt: null, sentBackNote: null, sentBackAt: null, confirmedByEmail: null,
    confirmedAt: null, rewardKind: null, rewardPence: null, rewardNote: null, rewardPaidAt: null, rewardPaidByEmail: null,
    createdAt: new Date('2026-09-20T00:00:00Z'), updatedAt: new Date('2026-09-20T00:00:00Z'), ...over,
  };
}

const steps = await import('./steps/+server');
const list = await import('./tasks/+server');
const one = await import('./tasks/[id]/+server');

type Handler = (e: unknown) => Promise<Response>;
function call(handler: unknown, opts: { method?: string; body?: unknown; id?: string } = {}) {
  const request = new Request('https://strangeramblings.com/api/native/family', {
    method: opts.method ?? 'GET',
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    headers: { 'content-type': 'application/json' },
  });
  const locals = { viewer: h.viewer ? Promise.resolve(h.viewer) : undefined };
  return (handler as Handler)({ request, locals, params: { id: opts.id ?? 't1' }, url: new URL(request.url) });
}

function asMember(email: string, grants: string[]) {
  h.role = 'member';
  h.viewer = { kind: 'member', principalId: 'p', email, grants: new Set(grants) };
}

beforeEach(() => {
  h.role = 'owner';
  h.viewer = null;
  h.tasks = new Map([['t1', base()]]);
  h.notified = [];
  h.created = [];
});

describe('family routes — who gets in', () => {
  it('refuses a member with no family grant, on every route', async () => {
    asMember('guest@example.test', ['games:self']);
    expect((await call(steps.GET)).status).toBe(403);
    expect((await call(list.GET)).status).toBe(403);
    expect((await call(list.POST, { method: 'POST', body: { title: 'x' } })).status).toBe(403);
    expect((await call(one.PATCH, { method: 'PATCH', body: { action: 'done' } })).status).toBe(403);
  });
});

describe('GET /api/native/family/steps', () => {
  it('answers the board with ranks and marks the caller, with no emails', async () => {
    asMember('kid@example.test', ['family:circle']);
    const res = await call(steps.GET);
    const body = await res.json();
    expect(body).toMatchObject({
      day: '2026-09-28',
      updatedAt: '2026-09-28T10:15:00.000Z',
      yesterday: { leaderName: 'Kid', steps: 14000 },
      people: [
        { id: 'f_kid', name: 'Kid', steps: 9000, rank: 1, me: true, updatedAt: '2026-09-28T10:00:00.000Z' },
        { id: 'f_owner', name: 'Owner', steps: 0, rank: 2, me: false, updatedAt: null },
      ],
    });
    expect(JSON.stringify(body)).not.toContain('@');
  });
});

describe('/api/native/family/tasks', () => {
  it('GET answers me, people and the three lists', async () => {
    const body = await (await call(list.GET)).json();
    expect(body.me).toEqual({ id: 'f_owner', parent: true });
    expect(body.people).toEqual([{ id: 'f_owner', name: 'Owner' }, { id: 'f_kid', name: 'Kid' }]);
    expect(body.open.map((t: { id: string }) => t.id)).toEqual(['t1']);
    expect(body.owed).toEqual({ totalPence: 0, items: [] });
    expect(JSON.stringify(body)).not.toContain('@');
  });

  it('POST creates, maps the assignee id, and pushes the assignee', async () => {
    asMember('kid@example.test', ['family:circle']);
    const res = await call(list.POST, {
      method: 'POST',
      body: { title: 'Walk dog', assigneeId: 'f_owner', reward: { kind: 'cash', pence: 200 } },
    });
    expect(res.status).toBe(201);
    expect(h.created[0]).toMatchObject({ title: 'Walk dog', assigneeEmail: 'owner@example.test', rewardKind: 'cash', rewardPence: 200, createdByEmail: 'kid@example.test' });
    expect((await res.json()).task).toMatchObject({ assignee: 'f_owner', createdBy: 'f_kid', reward: { kind: 'cash', pence: 200 } });
    expect(h.notified).toEqual([{ kind: 'assigned', actor: 'kid@example.test', doer: undefined }]);
  });

  it('POST refuses cash without an amount', async () => {
    const res = await call(list.POST, { method: 'POST', body: { title: 'x', reward: { kind: 'cash' } } });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/native/family/tasks/[id]', () => {
  it('done → confirm, pushing parents then the doer', async () => {
    asMember('kid@example.test', ['family:circle']);
    const done = await call(one.PATCH, { method: 'PATCH', body: { action: 'done' } });
    expect(done.status).toBe(200);
    expect((await done.json()).task).toMatchObject({ status: 'done', doneBy: 'f_kid' });
    expect((await call(one.PATCH, { method: 'PATCH', body: { action: 'confirm' } })).status).toBe(403);

    h.role = 'owner';
    h.viewer = null;
    const confirmed = await call(one.PATCH, { method: 'PATCH', body: { action: 'confirm' } });
    expect((await confirmed.json()).task).toMatchObject({ status: 'confirmed', confirmedBy: 'f_owner' });
    expect(h.notified).toEqual([
      { kind: 'done', actor: 'kid@example.test', doer: undefined },
      { kind: 'confirmed', actor: 'owner@example.test', doer: 'kid@example.test' },
    ]);
  });

  it('a family:admin member is a parent', async () => {
    h.tasks.set('t1', base({ status: 'done', doneByEmail: 'kid@example.test' }));
    asMember('parent2@example.test', ['family:circle', 'family:admin']);
    const res = await call(one.PATCH, { method: 'PATCH', body: { action: 'send_back', note: 'Try again' } });
    expect(res.status).toBe(200);
    expect((await res.json()).task).toMatchObject({ status: 'open', sentBackNote: 'Try again', doneBy: null });
    expect(h.notified).toEqual([{ kind: 'sent_back', actor: 'parent2@example.test', doer: 'kid@example.test' }]);
  });

  it('wrong state 409, unknown id 404, bad action 400', async () => {
    expect((await call(one.PATCH, { method: 'PATCH', body: { action: 'confirm' } })).status).toBe(409);
    expect((await call(one.PATCH, { method: 'PATCH', body: { action: 'done' }, id: 'nope' })).status).toBe(404);
    expect((await call(one.PATCH, { method: 'PATCH', body: { action: 'explode' } })).status).toBe(400);
  });

  it('edit validates fields and pushes a new assignee', async () => {
    const res = await call(one.PATCH, { method: 'PATCH', body: { action: 'edit', title: 'Bins out', assigneeId: 'f_kid' } });
    expect(res.status).toBe(200);
    expect((await res.json()).task).toMatchObject({ title: 'Bins out', assignee: 'f_kid' });
    expect(h.notified).toEqual([{ kind: 'assigned', actor: 'owner@example.test', doer: undefined }]);
    expect((await call(one.PATCH, { method: 'PATCH', body: { action: 'edit', title: '' } })).status).toBe(400);
  });

  it('paid marks a confirmed reward; delete is soft', async () => {
    h.tasks.set('t1', base({ status: 'confirmed', doneByEmail: 'kid@example.test', rewardKind: 'cash', rewardPence: 500 }));
    const paid = await call(one.PATCH, { method: 'PATCH', body: { action: 'paid' } });
    expect((await paid.json()).task.reward.paidAt).toEqual(expect.any(String));
    const del = await call(one.PATCH, { method: 'PATCH', body: { action: 'delete' } });
    expect(del.status).toBe(200);
    expect(h.tasks.get('t1')!.status).toBe('deleted');
    expect((await call(one.PATCH, { method: 'PATCH', body: { action: 'done' } })).status).toBe(404);
  });
});
