import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BacklogRecord } from '$lib/family/backlog';

const h = vi.hoisted(() => ({
  family: true,
  role: 'owner' as 'owner' | 'member',
  items: new Map<string, BacklogRecord>(),
  created: [] as Array<Record<string, unknown>>,
  described: [] as string[],
  reactions: [] as Array<{ itemId: string; email: string; emoji: string }>,
  pushed: [] as string[],
  digest: new Map<string, boolean>(),
  tasks: [] as Array<Record<string, unknown>>,
}));

vi.mock('$lib/server/native-handler', () => ({
  // The gate, handler called straight through, as the owner or a member.
  withNativeAccess:
    (_area: string, fn: (event: unknown, identity: unknown, role: string) => unknown) => async (event: unknown) => {
      const r = await fn(event, { ownerEmail: 'owner@example.test' }, h.role);
      return r instanceof Response ? r : Response.json(r);
    },
}));

vi.mock('$lib/family/access.server', () => ({
  familyCaller: async () =>
    !h.family ? null : h.role === 'owner' ? { email: 'owner@example.test', parent: true } : { email: 'kid@example.test', parent: false },
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

vi.mock('$lib/family/backlog.server', async () => {
  const pure = await import('$lib/family/backlog');
  return {
    loadItems: async () => [...h.items.values()],
    getItem: async (id: string) => {
      const i = h.items.get(id);
      return i && i.status !== 'deleted' ? i : null;
    },
    findByKey: async (key: string) => [...h.items.values()].find((i) => i.canonicalUrl === key && i.status !== 'deleted') ?? null,
    prepareLink: async (url: URL) => {
      const cleaned = pure.cleanUrl(url);
      return { url: cleaned, key: pure.canonicalKey(cleaned), target: new URL(cleaned) };
    },
    describeLink: async (url: string) => {
      h.described.push(url);
      return url.includes('youtube')
        ? { title: 'Volcanoes', siteName: 'YouTube', thumbnailUrl: 'https://i.ytimg.com/x.jpg' }
        : { title: null, siteName: null, thumbnailUrl: null };
    },
    createItem: async (values: Record<string, unknown>) => {
      h.created.push(values);
      const row = base({ id: `new${h.created.length}`, ...values } as Partial<BacklogRecord>);
      h.items.set(row.id, row);
      return row;
    },
    loadReactions: async (ids: string[]) => h.reactions.filter((r) => ids.includes(r.itemId)),
    setReaction: async (itemId: string, email: string, emoji: string | null) => {
      const i = h.reactions.findIndex((r) => r.itemId === itemId && r.email === email);
      const before = i >= 0 ? h.reactions[i].emoji : null;
      if (i >= 0) h.reactions.splice(i, 1);
      if (emoji) h.reactions.push({ itemId, email, emoji });
      return before !== emoji;
    },
    notifyForYou: async (item: BacklogRecord) => {
      if (item.forEmail && item.forEmail !== item.addedByEmail) h.pushed.push(`for:${item.forEmail}`);
      return 1;
    },
    notifyReaction: async (item: BacklogRecord, who: string, emoji: string) => {
      if (item.addedByEmail !== who) h.pushed.push(`react:${item.addedByEmail}:${emoji}`);
      return 1;
    },
    getDigest: async (email: string) => h.digest.get(email) ?? false,
    setDigest: async (email: string, on: boolean) => void h.digest.set(email, on),
    setTaskId: async (id: string, taskId: string) => {
      const cur = h.items.get(id)!;
      const next = { ...cur, taskId };
      h.items.set(id, next);
      return next;
    },
    applyTransition: async (id: string, t: { from: string; patch: Partial<BacklogRecord> }) => {
      const cur = h.items.get(id);
      if (!cur || cur.status !== t.from) return null;
      const next = { ...cur, ...t.patch };
      h.items.set(id, next);
      return next;
    },
  };
});

vi.mock('$lib/family/tasks.server', () => ({
  createTask: async (fields: Record<string, unknown>, by: string) => {
    h.tasks.push({ ...fields, by });
    return {
      id: '00000000-0000-4000-8000-000000000001', title: fields.title, notes: fields.notes ?? null, deadline: null,
      assigneeEmail: fields.assigneeEmail ?? null, createdByEmail: by, status: 'open', doneByEmail: null, doneAt: null,
      sentBackNote: null, sentBackAt: null, confirmedByEmail: null, confirmedAt: null, rewardKind: null, rewardPence: null,
      rewardNote: null, rewardPaidAt: null, rewardPaidByEmail: null, createdAt: new Date(), updatedAt: new Date(),
    };
  },
  notifyTaskChange: async () => 1,
}));

function base(over: Partial<BacklogRecord> = {}): BacklogRecord {
  return {
    id: 'b1', kind: 'page', url: 'https://example.com/a', canonicalUrl: 'example.com/a', provider: 'web', title: 'A page',
    siteName: null, thumbnailUrl: null, note: null, forEmail: null, addedByEmail: 'kid@example.test', status: 'new',
    doneByEmail: null, doneAt: null, taskId: null, createdAt: new Date('2026-10-10T00:00:00Z'), updatedAt: new Date('2026-10-10T00:00:00Z'),
    ...over,
  };
}

const list = await import('./+server');
const one = await import('./[id]/+server');
const react = await import('./[id]/reaction/+server');
const digest = await import('./digest/+server');

const post = (body: unknown) =>
  list.POST({ request: new Request('http://x/api/native/family/backlog', { method: 'POST', body: JSON.stringify(body) }), locals: {} } as never);
const patch = (id: string, body: unknown) =>
  one.PATCH({ params: { id }, request: new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }), locals: {} } as never);

beforeEach(() => {
  h.family = true;
  h.role = 'owner';
  h.items.clear();
  h.created.length = 0;
  h.described.length = 0;
  h.reactions.length = 0;
  h.pushed.length = 0;
  h.digest.clear();
  h.tasks.length = 0;
});

const reactTo = (id: string, body: unknown) =>
  react.POST({ params: { id }, request: new Request('http://x', { method: 'POST', body: JSON.stringify(body) }), locals: {} } as never);
const putDigest = (body: unknown) =>
  digest.PUT({ request: new Request('http://x', { method: 'PUT', body: JSON.stringify(body) }), locals: {} } as never);

describe('GET /api/native/family/backlog', () => {
  it('refuses anyone outside the family', async () => {
    h.family = false;
    const res = await list.GET({ locals: {} } as never);
    expect(res.status).toBe(403);
  });

  it('sends the list with ids, never addresses', async () => {
    h.items.set('b1', base());
    h.items.set('b2', base({ id: 'b2', status: 'done', doneByEmail: 'owner@example.test', doneAt: new Date() }));
    const res = await list.GET({ locals: {} } as never);
    const body = await res.json();
    expect(body.me).toEqual({ id: 'f_owner', parent: true });
    expect(body.items.map((i: { id: string }) => i.id)).toEqual(['b1']);
    expect(body.finished.map((i: { id: string }) => i.id)).toEqual(['b2']);
    expect(JSON.stringify(body)).not.toContain('@example.test');
  });
});

describe('POST /api/native/family/backlog', () => {
  it('adds a cleaned, described link', async () => {
    const res = await post({ url: 'https://youtu.be/abcdefghijk?si=SHARER', note: 'for Saturday', forId: 'f_kid' });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({
      duplicate: false,
      item: { kind: 'video', provider: 'youtube', url: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'Volcanoes', forId: 'f_kid', addedById: 'f_owner', note: 'for Saturday' },
    });
    expect(h.created[0]).toMatchObject({ canonicalUrl: 'youtube:abcdefghijk', forEmail: 'kid@example.test', addedByEmail: 'owner@example.test' });
    expect(JSON.stringify(h.created)).not.toContain('SHARER');
  });

  it('answers the existing item for the same video shared again, without fetching', async () => {
    await post({ url: 'https://youtu.be/abcdefghijk' });
    h.described.length = 0;
    const res = await post({ url: 'https://www.youtube.com/shorts/abcdefghijk?si=x' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ duplicate: true, item: { id: 'new1' } });
    expect(h.created).toHaveLength(1);
    expect(h.described).toEqual([]);
  });

  it('falls back to the shared caption when the link cannot be described', async () => {
    const res = await post({ text: 'Our walk https://example.com/walk?utm_source=x' });
    expect(await res.json()).toMatchObject({ item: { title: 'Our walk', url: 'https://example.com/walk', kind: 'page' } });
  });

  it('adds text with no link as an idea, and fetches nothing', async () => {
    h.role = 'member';
    const res = await post({ text: 'Go to Whitby' });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ item: { kind: 'idea', title: 'Go to Whitby', url: null, addedById: 'f_kid' } });
    expect(h.described).toEqual([]);
  });

  it('refuses a stranger, a bad body and someone outside the family as `for`', async () => {
    expect((await post({ url: 'file:///etc/passwd' })).status).toBe(400);
    expect((await post({ text: 'x', forId: 'f_nobody' })).status).toBe(400);
    h.family = false;
    expect((await post({ text: 'x' })).status).toBe(403);
    expect(h.created).toHaveLength(0);
  });
});

describe('PATCH /api/native/family/backlog/[id]', () => {
  it('marks done and back, recording who', async () => {
    h.items.set('b1', base());
    const done = await (await patch('b1', { action: 'done' })).json();
    expect(done.item).toMatchObject({ status: 'done', doneById: 'f_owner' });
    const back = await (await patch('b1', { action: 'reopen' })).json();
    expect(back.item).toMatchObject({ status: 'new', doneById: null });
  });

  it('lets only the sharer or a parent delete', async () => {
    h.items.set('b1', base({ addedByEmail: 'owner@example.test' }));
    h.role = 'member';
    expect((await patch('b1', { action: 'delete' })).status).toBe(403);
    h.role = 'owner';
    expect(await (await patch('b1', { action: 'delete' })).json()).toEqual({ deleted: 'b1' });
    expect((await patch('b1', { action: 'done' })).status).toBe(404);
  });

  it('409s the wrong state and 400s an unknown action', async () => {
    h.items.set('b1', base({ status: 'dismissed' }));
    expect((await patch('b1', { action: 'done' })).status).toBe(409);
    expect((await patch('b1', { action: 'explode' })).status).toBe(400);
  });
});

describe('pushes on share', () => {
  it('pushes the person it was for, and nobody when it is for everyone or yourself', async () => {
    await post({ text: 'Whitby', forId: 'f_kid' });
    await post({ text: 'Coast' });
    await post({ text: 'Mine', forId: 'f_owner' });
    expect(h.pushed).toEqual(['for:kid@example.test']);
  });
});

describe('reactions', () => {
  it('sets, replaces and takes back an emoji, pushing the sharer only for a change', async () => {
    h.items.set('b1', base());
    const first = await (await reactTo('b1', { emoji: '👍' })).json();
    expect(first.item.reactions).toEqual([{ emoji: '👍', by: ['f_owner'] }]);
    await reactTo('b1', { emoji: '👍' });
    await reactTo('b1', { emoji: '❤️' });
    expect(h.pushed).toEqual(['react:kid@example.test:👍', 'react:kid@example.test:❤️']);
    const gone = await (await reactTo('b1', { emoji: null })).json();
    expect(gone.item.reactions).toEqual([]);
  });

  it('never pushes you about your own share, and refuses odd emoji and strangers', async () => {
    h.items.set('b1', base());
    h.role = 'member';
    await reactTo('b1', { emoji: '😂' });
    expect(h.pushed).toEqual([]);
    expect((await reactTo('b1', { emoji: '🍕' })).status).toBe(400);
    expect((await reactTo('nope', { emoji: '👍' })).status).toBe(404);
    h.family = false;
    expect((await reactTo('b1', { emoji: '👍' })).status).toBe(403);
  });
});

describe('the evening round-up switch', () => {
  it('is off until turned on, and GET says which', async () => {
    let body = await (await list.GET({ locals: {} } as never)).json();
    expect(body.digest).toBe(false);
    expect(await (await putDigest({ on: true })).json()).toEqual({ digest: true });
    body = await (await list.GET({ locals: {} } as never)).json();
    expect(body.digest).toBe(true);
    expect(body.quickReactions).toContain('👍');
    expect((await putDigest({ on: 'yes' })).status).toBe(400);
  });
});

describe('to_task', () => {
  it('makes a family task for whoever it was for, with the note and link, and takes it off the list', async () => {
    h.items.set('b1', base({ kind: 'idea', title: 'Go to Whitby', url: null, note: 'Half term', forEmail: 'kid@example.test' }));
    const res = await (await patch('b1', { action: 'to_task' })).json();
    expect(res.item).toMatchObject({ status: 'done', taskId: '00000000-0000-4000-8000-000000000001' });
    expect(res.task).toMatchObject({ title: 'Go to Whitby' });
    expect(h.tasks[0]).toMatchObject({ title: 'Go to Whitby', notes: 'Half term', assigneeEmail: 'kid@example.test', by: 'owner@example.test' });
    expect((await patch('b1', { action: 'to_task' })).status).toBe(409);
    expect(h.tasks).toHaveLength(1);
  });

  it('puts the link in the notes of a task made from a link', async () => {
    h.items.set('b1', base({ title: null }));
    await patch('b1', { action: 'to_task' });
    expect(h.tasks[0]).toMatchObject({ title: 'example.com', notes: 'https://example.com/a' });
  });
});
