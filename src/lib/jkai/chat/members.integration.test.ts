import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq, inArray, or } from 'drizzle-orm';
import { db } from '$lib/db';
import {
  accessUsage,
  activityPrincipals,
  allowedUser,
  conversations,
  jkaiAttachments,
  orchestratorChats,
} from '$lib/db/schema';

// The P5b proof: `jkai.chat` is OPEN, so a member reaches the chat routes
// through the hook. Real allowed_user rows, real principals, the real viewer
// seam (`viewerOf` → `loadMember`), the real handlers and the real page load.
//
//   A  jkai.chat:self   reads and posts in their own threads
//   R  jkai.chat:all    reads A's, may not post in them
//   M  jkai.chat:admin  manages A's (rename, delete), never the owner-only fields
//   G  guest            holds nothing: the hook's check refuses every chat route
//
// The chat loop is a spy: no model is ever called. Every owner-context reader a
// member turn must never reach (model client, memory, cluster roster, /drive
// mirror, daily alerts) is a tripwire.
//
// Touches only rows it creates (tagged), and deletes them after. Never runs a
// cleanup, purge or sweep; no schema push.

vi.hoisted(() => {
  // Importing the routes reaches $lib/workflows; a builder process boots no
  // WhatsApp or Home Assistant.
  process.env.JKAI_SERVICE_ROLE = 'builder';
});

const trips = vi.hoisted(() => ({ llm: 0, memory: 0, roster: 0, mirror: 0, alerts: 0 }));
vi.mock('$lib/llm/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/llm/client')>()),
  getLLMClient: vi.fn(async () => {
    trips.llm++;
    throw new Error('tripwire: no model call in this test');
  }),
}));
vi.mock('$lib/jkai/memory/retrieve.server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/jkai/memory/retrieve.server')>()),
  retrieveMemories: vi.fn(async () => {
    trips.memory++;
    throw new Error('tripwire: no memory read for a member');
  }),
}));
vi.mock('$lib/jkai/intel/context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/jkai/intel/context')>()),
  loadClusterRoster: vi.fn(async () => {
    trips.roster++;
    throw new Error('tripwire: no cluster roster for a member');
  }),
}));
vi.mock('$lib/jkai/media/drive-link', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/jkai/media/drive-link')>()),
  mirrorAndLink: vi.fn(async () => {
    trips.mirror++;
    throw new Error('tripwire: no /drive mirror for a member');
  }),
}));
// The owner's digest reaches out to live feeds; a chat-only member never loads it.
vi.mock('$lib/jkai/intel/daily-alerts.server', () => ({
  loadDailyAlerts: vi.fn(async () => {
    trips.alerts++;
    throw new Error('tripwire: no daily alerts for a chat-only member');
  }),
}));

// The chat loop: records exactly what the route hands it, answers at once.
const chatCalls = vi.hoisted(() => [] as Array<{ input: unknown; options: Record<string, unknown> }>);
vi.mock('$lib/workflows/chat/general-chat', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/workflows/chat/general-chat')>()),
  generalChat: vi.fn(async (input: unknown, _history: unknown, options: Record<string, unknown>) => {
    chatCalls.push({ input, options });
    return {
      response: 'spy reply',
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        reasoningTokens: 0,
        rounds: 0,
        provider: null,
        model: null,
        reportedCostUsd: null,
      },
      memory: null,
    };
  }),
}));

const TAG = `c${Math.random().toString(36).slice(2, 10)}`;
const OWNER_SECRET = `Ownerchat${TAG}`;
const A_WORD = `Memberchat${TAG}`;
const EMAIL = {
  A: `a-${TAG}@example.test`,
  R: `r-${TAG}@example.test`,
  M: `m-${TAG}@example.test`,
  G: `g-${TAG}@example.test`,
};
const A = `u_a${TAG}`;
const R = `u_r${TAG}`;
const M = `u_m${TAG}`;
const F = `u_f${TAG}`; // the cap's fresh principal
const PRINCIPALS = [A, R, M, F];
const ids: Record<string, string> = {};

function event(
  email: string | null,
  opts: { url?: string; params?: Record<string, string>; method?: string; body?: unknown; routeId?: string } = {},
) {
  const url = new URL(opts.url ?? 'http://test.local/');
  return {
    url,
    request: new Request(url, {
      method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
      headers: { 'content-type': 'application/json' },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    }),
    params: opts.params ?? {},
    route: { id: opts.routeId ?? null },
    // Fresh per event: `viewerOf` caches on locals, once per request.
    locals: { auth: async () => (email ? { user: { email } } : null) },
    fetch,
    parent: async () => ({}),
    depends: () => {},
    setHeaders: () => {},
    getClientAddress: () => '203.0.113.9',
    cookies: { get: () => undefined, getAll: () => [], set: () => {}, delete: () => {}, serialize: () => '' },
  } as any;
}

async function run(fn: () => unknown): Promise<{ status: number; body: any }> {
  try {
    const out = await fn();
    if (out instanceof Response) {
      if ((out.headers.get('content-type') ?? '').includes('text/event-stream')) {
        // An SSE stream never ends: read the opening frame and hang up.
        const reader = out.body!.getReader();
        const { value } = await reader.read();
        await reader.cancel();
        return { status: out.status, body: new TextDecoder().decode(value) };
      }
      const text = await out.text();
      let body: unknown = text;
      try { body = JSON.parse(text); } catch { /* not JSON */ }
      return { status: out.status, body };
    }
    return { status: 200, body: out };
  } catch (err) {
    const status = (err as { status?: unknown }).status;
    if (typeof status === 'number') return { status, body: (err as { body?: unknown }).body };
    throw err;
  }
}

/** Every trace of the owner's thread a body may carry. */
const leaks = (body: unknown) =>
  [OWNER_SECRET, ids.owner, ids.ownerAttachment].filter((s) => s && JSON.stringify(body ?? null).includes(s));

async function waitFor<T>(probe: () => T | undefined | null | false, ms = 10_000): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const v = probe();
    if (v) return v;
    if (Date.now() > until) throw new Error('waitFor: timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe.skipIf(!process.env.DATABASE_URL)('jkai chat for members, end to end', () => {
  beforeAll(async () => {
    await db.insert(allowedUser).values([
      { email: EMAIL.A, grants: ['jkai.chat:self'], note: 'chat members.integration' },
      { email: EMAIL.R, grants: ['jkai.chat:all'], note: 'chat members.integration' },
      { email: EMAIL.M, grants: ['jkai.chat:admin'], note: 'chat members.integration' },
      { email: EMAIL.G, grants: [], note: 'chat members.integration' },
    ]);
    await db.insert(activityPrincipals).values([
      { id: A, kind: 'user', externalRef: EMAIL.A, label: 'test a' },
      { id: R, kind: 'user', externalRef: EMAIL.R, label: 'test r' },
      { id: M, kind: 'user', externalRef: EMAIL.M, label: 'test m' },
      { id: F, kind: 'user', externalRef: `f-${TAG}@example.test`, label: 'test f' },
    ]);

    const now = Date.now();
    const [owner] = await db
      .insert(conversations)
      .values({ title: `${OWNER_SECRET} title`, source: 'web' })
      .returning({ id: conversations.id });
    const [mine] = await db
      .insert(conversations)
      .values({ title: `${A_WORD} title`, source: 'web', principalId: A })
      .returning({ id: conversations.id });
    const [second] = await db
      .insert(conversations)
      .values({ title: `Second${TAG}`, source: 'web', principalId: A })
      .returning({ id: conversations.id });
    ids.owner = owner.id;
    ids.mine = mine.id;
    ids.second = second.id;
    await db.insert(orchestratorChats).values([
      { conversationId: owner.id, role: 'user', content: `${OWNER_SECRET} the owner's words` },
      { conversationId: mine.id, role: 'user', content: `${A_WORD} a member's words` },
    ]);
    // The owner's thread is the newest in the table, so an unscoped first page
    // or search would carry it.
    await db.update(conversations).set({ updatedAt: new Date(now + 60 * 60_000) }).where(eq(conversations.id, owner.id));
    const [att] = await db
      .insert(jkaiAttachments)
      .values({
        conversationId: owner.id,
        source: 'web',
        kind: 'text',
        mimeType: 'text/plain',
        originalName: `${OWNER_SECRET}.txt`,
        sizeBytes: 1,
        diskPath: `missing-${TAG}.txt`,
      })
      .returning({ id: jkaiAttachments.id });
    ids.ownerAttachment = att.id;
  });

  afterAll(async () => {
    const threads = [ids.owner, ids.mine, ids.second, ids.created].filter((x): x is string => !!x);
    await db.delete(accessUsage).where(inArray(accessUsage.principalId, PRINCIPALS));
    // Messages and attachments cascade with their thread; a stray upload of
    // ours with no thread goes by its principal.
    await db.delete(jkaiAttachments).where(inArray(jkaiAttachments.principalId, PRINCIPALS));
    if (threads.length) {
      await db
        .delete(conversations)
        .where(or(inArray(conversations.id, threads), inArray(conversations.principalId, PRINCIPALS)));
    } else {
      await db.delete(conversations).where(inArray(conversations.principalId, PRINCIPALS));
    }
    await db.delete(activityPrincipals).where(inArray(activityPrincipals.id, PRINCIPALS));
    await db.delete(allowedUser).where(inArray(allowedUser.email, Object.values(EMAIL)));
  });

  it("(a) A reaches nothing of the owner's: list, search, thread, messages, attachment, events", async () => {
    const list = await import('../../../routes/api/jkai/conversations/+server');
    const thread = await import('../../../routes/api/jkai/conversations/[id]/+server');
    const messages = await import('../../../routes/api/jkai/conversations/[id]/messages/+server');
    const attachment = await import('../../../routes/api/jkai/attachments/[id]/+server');
    const events = await import('../../../routes/api/jkai/events/+server');

    const listed = await run(() => list.GET(event(EMAIL.A, { url: 'http://test.local/api/jkai/conversations?limit=200' })));
    expect(listed.status).toBe(200);
    const listedIds = (listed.body.items as Array<{ id: string }>).map((i) => i.id);
    expect(listedIds).toContain(ids.mine);
    expect(listedIds).not.toContain(ids.owner);
    expect(leaks(listed.body)).toEqual([]);

    const search = await run(() => list.GET(event(EMAIL.A, { url: `http://test.local/api/jkai/conversations?q=${OWNER_SECRET}` })));
    expect(search.status).toBe(200);
    expect(search.body.items).toEqual([]);
    expect(leaks(search.body)).toEqual([]);

    const params = { id: ids.owner };
    const cases: Array<[string, () => unknown]> = [
      ['thread GET', () => thread.GET(event(EMAIL.A, { params }))],
      ['messages GET', () => messages.GET(event(EMAIL.A, { params }))],
      ['attachment GET', () => attachment.GET(event(EMAIL.A, { params: { id: ids.ownerAttachment } }))],
    ];
    for (const [name, call] of cases) {
      const res = await run(call);
      expect(res.status, name).toBe(404);
      expect(leaks(res.body), name).toEqual([]);
    }

    // Events: the owner's thread alone subscribes to nothing; alongside A's own
    // it is dropped from the subscription.
    const alone = await run(() => events.GET(event(EMAIL.A, { url: `http://test.local/api/jkai/events?conversationId=${ids.owner}` })));
    expect(alone.status).toBe(400);
    expect(leaks(alone.body)).toEqual([]);
    const mixed = await run(() =>
      events.GET(event(EMAIL.A, { url: `http://test.local/api/jkai/events?conversationIds=${ids.mine},${ids.owner}` })),
    );
    expect(mixed.status).toBe(200);
    expect(mixed.body).toContain(ids.mine);
    expect(leaks(mixed.body)).toEqual([]);
  });

  it("(b) R reads A's thread but may not post in it; M manages it but never the owner-only fields", async () => {
    const thread = await import('../../../routes/api/jkai/conversations/[id]/+server');
    const chat = await import('../../../routes/api/workflows/orchestrator/chat/+server');

    const read = await run(() => thread.GET(event(EMAIL.R, { params: { id: ids.mine } })));
    expect(read.status).toBe(200);
    expect(JSON.stringify(read.body)).toContain(A_WORD);
    expect((await run(() => thread.GET(event(EMAIL.R, { params: { id: ids.owner } })))).status).toBe(404);

    const before = chatCalls.length;
    const post = await run(() => chat.POST(event(EMAIL.R, { body: { message: `hello ${TAG}`, conversationId: ids.mine } })));
    expect(post.status).toBe(403);
    expect(chatCalls.length).toBe(before);
    // Refused before the meter.
    expect(await db.select().from(accessUsage).where(eq(accessUsage.principalId, R))).toEqual([]);

    // R may not rename it either: `all` reads, it does not write.
    expect(
      (await run(() => thread.PATCH(event(EMAIL.R, { method: 'PATCH', params: { id: ids.mine }, body: { title: 'r' } })))).status,
    ).toBe(403);

    const renamed = await run(() =>
      thread.PATCH(event(EMAIL.M, { method: 'PATCH', params: { id: ids.mine }, body: { title: `Renamed ${A_WORD}` } })),
    );
    expect(renamed.status).toBe(200);
    const [row] = await db.select().from(conversations).where(eq(conversations.id, ids.mine));
    expect(row.title).toBe(`Renamed ${A_WORD}`);
    expect(row.principalId).toBe(A);

    for (const body of [
      { thinkingLevel: 'high' },
      { shareVisibility: 'public' },
      { modelProvider: 'openrouter', modelId: 'openai/gpt-5' },
    ]) {
      const res = await run(() => thread.PATCH(event(EMAIL.M, { method: 'PATCH', params: { id: ids.mine }, body })));
      expect(res.status, JSON.stringify(body)).toBe(403);
    }
    const [after] = await db.select().from(conversations).where(eq(conversations.id, ids.mine));
    expect(after.thinkingLevel).toBeNull();
    expect(after.shareVisibility).toBe('private');
    expect(after.shareToken).toBeNull();
    expect(after.modelPinnedByUser).toBe(false);

    // M never reaches the owner's thread.
    expect((await run(() => thread.DELETE(event(EMAIL.M, { method: 'DELETE', params: { id: ids.owner } })))).status).toBe(404);
    const del = await run(() => thread.DELETE(event(EMAIL.M, { method: 'DELETE', params: { id: ids.second } })));
    expect(del.status).toBe(200);
    expect(await db.select().from(conversations).where(eq(conversations.id, ids.second))).toEqual([]);
    const [ownerStill] = await db.select().from(conversations).where(eq(conversations.id, ids.owner));
    expect(ownerStill?.title).toBe(`${OWNER_SECRET} title`);
  });

  it("(c) /jkai loads A's own hub: member, no WhatsApp, no briefing, no owner thread, no intel needed", async () => {
    const page = await import('../../../routes/jkai/+page.server');
    const res = await run(() => page.load(event(EMAIL.A, { url: 'http://test.local/jkai', routeId: '/jkai' })));
    expect(res.status).toBe(200);
    const data = res.body as Record<string, any>;
    expect(data.member).toBe(true);
    expect(data.whatsappThread).toBeNull();
    expect(data.freshBriefing).toBeNull();
    expect(data.chatAltOpenRouterModel).toBeNull();
    const threads = (data.conversations as Array<{ id: string; principalId?: string }>).map((c) => c.id);
    expect(threads).toContain(ids.mine);
    expect(threads).not.toContain(ids.owner);
    expect(leaks(data)).toEqual([]);
    expect(data.dailyAlerts).toMatchObject({ status: 'empty', total: 0, items: [] });
    expect(trips.alerts).toBe(0);
  });

  it("(d) A's new thread is A's, and A's turn runs restricted on the default whatever the row says", async () => {
    const list = await import('../../../routes/api/jkai/conversations/+server');
    const chat = await import('../../../routes/api/workflows/orchestrator/chat/+server');
    const { getJob } = await import('$lib/workflows/chat/job-store');
    const { MEMBER_CHAT_TOOLS } = await import('$lib/jkai/member-chat/policy');

    const created = await run(() =>
      list.POST(event(EMAIL.A, { body: { title: `New${TAG}`, modelProvider: 'openrouter', modelId: 'openai/gpt-5' } })),
    );
    expect(created.status).toBe(201);
    ids.created = created.body.id;
    expect(created.body.principalId).toBe(A);
    expect(created.body.modelPinnedByUser).toBe(false);
    expect(created.body.thinkingLevel).toBeNull();

    // Hand-edit the row as if A had picked an expensive model and a thinking level.
    await db
      .update(conversations)
      .set({ modelProvider: 'openrouter', modelId: `openai/hand-edited-${TAG}`, modelPinnedByUser: true, thinkingLevel: 'high' })
      .where(eq(conversations.id, ids.created));

    const before = chatCalls.length;
    const res = await run(() => chat.POST(event(EMAIL.A, { body: { message: `hello ${TAG}`, conversationId: ids.created } })));
    expect(res.status).toBe(200);
    const jobId = res.body.jobId as string;
    expect(jobId).toBeTruthy();

    const call = await waitFor(() => chatCalls[before]);
    expect(call.options.conversationId).toBe(ids.created);
    expect(call.options.restriction).toEqual({ principalId: A, allow: [...MEMBER_CHAT_TOOLS] });
    expect(call.options.sessionModel).toBeNull();
    expect(call.options.thinkingLevel).toBeNull();
    expect(call.options.useIntelContext).toBe(false);
    expect((call.options.modelContext as { modelId: string }).modelId).not.toBe(`openai/hand-edited-${TAG}`);

    // Let the turn finish writing before the next test (and cleanup) runs.
    await waitFor(() => {
      const s = getJob(jobId)?.status;
      return s === 'done' || s === 'error' ? s : undefined;
    });
    expect(getJob(jobId)?.status).toBe('done');
    const turnRows = await db.select().from(orchestratorChats).where(eq(orchestratorChats.conversationId, ids.created));
    expect(turnRows.map((r) => r.role).sort()).toEqual(['assistant', 'user']);

    // The turn was metered against A.
    const used = await db.select().from(accessUsage).where(eq(accessUsage.principalId, A));
    expect(used.filter((u) => u.kind === 'chat')).toHaveLength(1);

    // And A still cannot post into the owner's thread.
    const into = await run(() => chat.POST(event(EMAIL.A, { body: { message: `x ${TAG}`, conversationId: ids.owner } })));
    expect(into.status).toBe(404);
    expect(leaks(into.body)).toEqual([]);

    expect(trips).toMatchObject({ llm: 0, memory: 0, roster: 0, mirror: 0 });
  });

  it('(e) a guest holds none of the chat routes the catalogue opens', async () => {
    const { requiredFor, routeIdsFor } = await import('$lib/access/catalogue');
    const { viewerOf, viewerHolds } = await import('$lib/server/viewer');
    const routes = routeIdsFor('jkai.chat');
    expect(routes).toContain('/api/workflows/orchestrator/chat');
    const guest = await viewerOf(event(EMAIL.G));
    expect(guest.kind).toBe('guest');
    const member = await viewerOf(event(EMAIL.A));
    expect(member.kind).toBe('member');

    let checked = 0;
    for (const routeId of routes) {
      for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']) {
        const required = requiredFor(routeId, method);
        if (!required) continue;
        checked++;
        expect(viewerHolds(guest, required), `${method} ${routeId}`).toBe(false);
        // The same check lets A through, so the refusal above is not vacuous.
        expect(viewerHolds(member, required), `${method} ${routeId} (A)`).toBe(true);
      }
    }
    expect(checked).toBeGreaterThan(10);

    // And the handler seam refuses a guest who got past the hook anyway.
    const list = await import('../../../routes/api/jkai/conversations/+server');
    expect((await run(() => list.GET(event(EMAIL.G)))).status).toBe(403);
  });

  it('(f) the daily cap lets exactly the cap through, in parallel', async () => {
    const { reserveChatTurn, CHAT_DAILY_TURNS } = await import('$lib/jkai/chat-access.server');
    const { getSetting } = await import('$lib/server/models/settings');
    // Read, never written: a global setting is not this test's to change.
    const setting = await getSetting<number>('access.chat.dailyTurns').catch(() => null);
    // 50 unless the owner has set `access.chat.dailyTurns`; a cap of hundreds
    // would make this slow, not wrong.
    const cap = typeof setting === 'number' && setting > 0 ? setting : CHAT_DAILY_TURNS;

    const access = { level: 'self' as const, own: F };
    const results = await Promise.allSettled(Array.from({ length: cap + 1 }, () => reserveChatTurn(access)));
    const ok = results.filter((r) => r.status === 'fulfilled');
    const refused = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(cap);
    expect(refused).toHaveLength(1);
    expect((refused[0].reason as { status?: number }).status).toBe(429);
    const rows = await db.select().from(accessUsage).where(eq(accessUsage.principalId, F));
    expect(rows).toHaveLength(cap);

    await db.delete(accessUsage).where(eq(accessUsage.principalId, F));
  });
});
