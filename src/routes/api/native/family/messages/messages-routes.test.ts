import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageRecord } from '$lib/family/messages';

const OWNERS = ['owner@example.test'];

const h = vi.hoisted(() => ({
  role: 'owner' as 'owner' | 'member',
  viewer: null as null | { kind: 'member'; principalId: string; email: string; grants: Set<string> },
  rows: [] as MessageRecord[],
  sent: [] as Array<{ email: string; body: string }>,
  replied: [] as Array<{ to: string; email: string; body: string }>,
  limited: false,
}));

vi.mock('$lib/server/native-handler', () => ({
  withNativeAccess:
    (_area: string, fn: (event: unknown, identity: unknown, role: string) => unknown) => async (event: unknown) => {
      const r = await fn(event, { ownerEmail: 'owner@example.test' }, h.role);
      return r instanceof Response ? r : Response.json(r);
    },
}));

vi.mock('$lib/server/access', () => ({ isOwnerEmail: (e: string) => OWNERS.includes(e.trim().toLowerCase()) }));
vi.mock('$lib/family/roster.server', () => ({ familyId: (e: string) => `f_${e.split('@')[0]}` }));

function row(over: Partial<MessageRecord> = {}): MessageRecord {
  return {
    id: 'm1', fromEmail: 'kid@example.test', fromName: 'Kid', body: 'Dinner?', replyTo: null,
    recipientCount: 2, pushedCount: 2, createdAt: new Date('2026-10-05T17:00:00Z'), ...over,
  };
}

vi.mock('$lib/family/messages.server', () => ({
  recentMessages: async () => h.rows,
  getMessage: async (id: string) => h.rows.find((r) => r.id === id) ?? null,
  sendMessage: async (email: string, _parent: boolean, body: string) => {
    if (h.limited) return { kind: 'limited', retryAfterSeconds: 60 };
    h.sent.push({ email, body });
    return { kind: 'sent', message: row({ id: 'm-new', fromEmail: email, body }), pushed: 3, recipients: 2 };
  },
  replyToMessage: async (message: MessageRecord, email: string, _parent: boolean, body: string) => {
    h.replied.push({ to: message.id, email, body });
    return { reply: row({ id: 'r-new', fromEmail: email, body, replyTo: message.id }), pushed: 1 };
  },
}));

const list = await import('./+server');
const replies = await import('./[id]/replies/+server');

type Handler = (e: unknown) => Promise<Response>;
function call(handler: unknown, opts: { method?: string; body?: unknown; id?: string } = {}) {
  const request = new Request('https://strangeramblings.com/api/native/family/messages', {
    method: opts.method ?? 'GET',
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    headers: { 'content-type': 'application/json' },
  });
  const locals = { viewer: h.viewer ? Promise.resolve(h.viewer) : undefined };
  return (handler as Handler)({ request, locals, url: new URL(request.url), params: { id: opts.id ?? '' } });
}

function asMember(email: string, grants: string[]) {
  h.role = 'member';
  h.viewer = { kind: 'member', principalId: 'p', email, grants: new Set(grants) };
}

beforeEach(() => {
  h.role = 'owner';
  h.viewer = null;
  h.rows = [row(), row({ id: 'r1', fromEmail: 'owner@example.test', fromName: 'John', body: '👍', replyTo: 'm1' })];
  h.sent = [];
  h.replied = [];
  h.limited = false;
});

describe('family messages — who gets in', () => {
  it('refuses a member with no family grant, on every route', async () => {
    asMember('guest@example.test', ['games:self', 'chat:self']);
    expect((await call(list.GET)).status).toBe(403);
    expect((await call(list.POST, { method: 'POST', body: { body: 'hi' } })).status).toBe(403);
    expect((await call(replies.POST, { method: 'POST', body: { body: '👍' }, id: 'm1' })).status).toBe(403);
    expect(h.sent).toEqual([]);
    expect(h.replied).toEqual([]);
  });
});

describe('GET /api/native/family/messages', () => {
  it('lists messages with replies and the quick replies, without emails', async () => {
    asMember('kid@example.test', ['family:circle']);
    const body = await (await call(list.GET)).json();
    expect(body.me).toEqual({ id: 'f_kid' });
    expect(body.reactions).toContain('👍');
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]).toMatchObject({ id: 'm1', fromId: 'f_kid', mine: true });
    expect(body.messages[0].replies[0]).toMatchObject({ id: 'r1', fromName: 'John', mine: false, reaction: true });
    expect(JSON.stringify(body)).not.toContain('@');
  });
});

describe('POST /api/native/family/messages', () => {
  it('sends as the caller', async () => {
    asMember('kid@example.test', ['family:circle']);
    const res = await call(list.POST, { method: 'POST', body: { body: ' Home at 6 ' } });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ message: { id: 'm-new', body: 'Home at 6', mine: true }, pushed: 3, recipients: 2 });
    expect(h.sent).toEqual([{ email: 'kid@example.test', body: 'Home at 6' }]);
  });

  it('is 400 for an empty message and 429 when limited', async () => {
    expect((await call(list.POST, { method: 'POST', body: { body: '  ' } })).status).toBe(400);
    h.limited = true;
    const res = await call(list.POST, { method: 'POST', body: { body: 'again' } });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('60');
  });
});

describe('POST /api/native/family/messages/:id/replies', () => {
  it('replies with an emoji or text', async () => {
    asMember('kid@example.test', ['family:admin']);
    const res = await call(replies.POST, { method: 'POST', body: { body: '👍' }, id: 'm1' });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ reply: { id: 'r-new', body: '👍', reaction: true }, pushed: 1 });
    expect(h.replied).toEqual([{ to: 'm1', email: 'kid@example.test', body: '👍' }]);
  });

  it('is 404 for an unknown message or a reply, and 400 for nothing', async () => {
    expect((await call(replies.POST, { method: 'POST', body: { body: 'x' }, id: 'nope' })).status).toBe(404);
    expect((await call(replies.POST, { method: 'POST', body: { body: 'x' }, id: 'r1' })).status).toBe(404);
    expect((await call(replies.POST, { method: 'POST', body: {}, id: 'm1' })).status).toBe(400);
    expect(h.replied).toEqual([]);
  });
});
