import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq, inArray } from 'drizzle-orm';
import { db } from '$lib/db';
import { conversations, jkaiAttachments, orchestratorChats } from '$lib/db/schema';

// Thread lists, the thread handlers and uploads, scoped to the reader. A real
// owner thread and a real member thread; the real handlers.
//
// The `jkai.chat` area is still closed, so the hook would never let a member
// reach these routes — the viewer is mocked to a member holding
// `jkai.chat:self`, and the real `areaAccess` → `requireConversation` seam
// resolves it from there.
//
// Touches only rows it creates (tagged), and deletes them after. Uploads go to
// a throwaway media root; the /drive mirror is a tripwire.

vi.hoisted(() => {
  // Importing the routes reaches $lib/workflows; a builder process boots no
  // WhatsApp or Home Assistant.
  process.env.JKAI_SERVICE_ROLE = 'builder';
});

const TAG = `s${Math.random().toString(36).slice(2, 10)}`;
const MEMBER = `u_${TAG}`;
const viewer = vi.hoisted(() => ({ as: 'owner' as 'owner' | 'member', principalId: '' }));
vi.mock('$lib/server/viewer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/server/viewer')>()),
  viewerOf: async () =>
    viewer.as === 'owner'
      ? { kind: 'owner' }
      : { kind: 'member', principalId: viewer.principalId, email: 'm@example.test', grants: new Set(['jkai.chat:self']) },
}));

const mirrorCalls = vi.hoisted(() => ({ n: 0 }));
vi.mock('$lib/jkai/media/drive-link', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/jkai/media/drive-link')>()),
  mirrorAndLink: vi.fn(async () => {
    mirrorCalls.n++;
    return null;
  }),
}));

const ids: { owner?: string; member?: string; created?: string; ownerAttachment?: string } = {};
let mediaRoot = '';

function event(opts: { url?: string; params?: Record<string, string>; method?: string; body?: unknown; form?: FormData } = {}) {
  const url = new URL(opts.url ?? 'http://test.local/');
  const body = opts.form ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body));
  return {
    url,
    request: new Request(url, {
      method: opts.method ?? (body === undefined ? 'GET' : 'POST'),
      headers: opts.form ? undefined : { 'content-type': 'application/json' },
      body,
    }),
    params: opts.params ?? {},
    route: { id: null },
    locals: {},
  } as any;
}

async function run(fn: () => unknown): Promise<{ status: number; body: any }> {
  try {
    const out = await fn();
    if (out instanceof Response) {
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

const asOwner = () => { viewer.as = 'owner'; };
const asMember = () => { viewer.as = 'member'; viewer.principalId = MEMBER; };

describe.skipIf(!process.env.DATABASE_URL)('jkai threads are scoped to the reader', () => {
  beforeAll(async () => {
    mediaRoot = await mkdtemp(join(tmpdir(), `jkai-scope-${TAG}-`));
    vi.stubEnv('JKAI_MEDIA_ROOT', mediaRoot);
    const now = Date.now();
    const [owner] = await db.insert(conversations).values({ title: `Owner${TAG}` }).returning({ id: conversations.id });
    const [member] = await db
      .insert(conversations)
      .values({ title: `Member${TAG}`, principalId: MEMBER })
      .returning({ id: conversations.id });
    ids.owner = owner.id;
    ids.member = member.id;
    await db.insert(orchestratorChats).values([
      { conversationId: owner.id, role: 'user', content: `owner secret ${TAG}` },
      { conversationId: member.id, role: 'user', content: `member words ${TAG}` },
    ]);
    // Newest in the table, so an unscoped first page would carry both.
    await db.update(conversations).set({ updatedAt: new Date(now + 60_000) }).where(eq(conversations.id, owner.id));
    await db.update(conversations).set({ updatedAt: new Date(now + 120_000) }).where(eq(conversations.id, member.id));
    const [att] = await db
      .insert(jkaiAttachments)
      .values({ conversationId: owner.id, source: 'web', kind: 'text', mimeType: 'text/plain', sizeBytes: 1, diskPath: `missing-${TAG}.txt` })
      .returning({ id: jkaiAttachments.id });
    ids.ownerAttachment = att.id;
  });

  afterAll(async () => {
    asOwner();
    const all = [ids.owner, ids.member, ids.created].filter((x): x is string => !!x);
    // Messages and attachments cascade with their thread.
    if (all.length) await db.delete(conversations).where(inArray(conversations.id, all));
    vi.unstubAllEnvs();
    if (mediaRoot) await rm(mediaRoot, { recursive: true, force: true });
  });

  it("the owner's list never carries a member's thread", async () => {
    const { getConversationList, searchConversationList } = await import('$lib/jkai/queries');
    const page = await getConversationList({ limit: 200 });
    const listed = page.items.map((i) => i.id);
    expect(listed).toContain(ids.owner);
    expect(listed).not.toContain(ids.member);
    const found = (await searchConversationList({ q: TAG })).items.map((i) => i.id);
    expect(found).toContain(ids.owner);
    expect(found).not.toContain(ids.member);
  });

  it("a member's list is their own threads, never the owner's", async () => {
    const { GET } = await import('../../routes/api/jkai/conversations/+server');
    asMember();
    const res = await run(() => GET(event({ url: 'http://test.local/api/jkai/conversations?limit=200' })));
    expect(res.status).toBe(200);
    const listed = (res.body.items as Array<{ id: string }>).map((i) => i.id);
    expect(listed).toContain(ids.member);
    expect(listed).not.toContain(ids.owner);
    const search = await run(() => GET(event({ url: `http://test.local/api/jkai/conversations?q=${TAG}` })));
    const found = (search.body.items as Array<{ id: string }>).map((i) => i.id);
    expect(found).toEqual([ids.member]);
  });

  it("a member gets a 404 on the owner's thread from every handler", async () => {
    const thread = await import('../../routes/api/jkai/conversations/[id]/+server');
    const messages = await import('../../routes/api/jkai/conversations/[id]/messages/+server');
    asMember();
    const params = { id: ids.owner! };
    expect((await run(() => thread.GET(event({ params })))).status).toBe(404);
    expect((await run(() => messages.GET(event({ params })))).status).toBe(404);
    expect((await run(() => thread.PATCH(event({ params, method: 'PATCH', body: { title: 'hijack' } })))).status).toBe(404);
    expect((await run(() => thread.DELETE(event({ params, method: 'DELETE' })))).status).toBe(404);
    const [still] = await db.select().from(conversations).where(eq(conversations.id, ids.owner!));
    expect(still?.title).toBe(`Owner${TAG}`);
  });

  it('a member may rename their own thread but not set its thinking level, sharing, intel or model', async () => {
    const thread = await import('../../routes/api/jkai/conversations/[id]/+server');
    asMember();
    const params = { id: ids.member! };
    const read = await run(() => thread.GET(event({ params })));
    expect(read.status).toBe(200);
    for (const body of [
      { thinkingLevel: 'high' },
      { shareVisibility: 'public' },
      { intelEnabled: false },
      { modelProvider: 'openrouter', modelId: 'openai/gpt-5' },
      { title: 'ok', thinkingLevel: 'high' },
    ]) {
      expect((await run(() => thread.PATCH(event({ params, method: 'PATCH', body })))).status, JSON.stringify(body)).toBe(403);
    }
    const renamed = await run(() => thread.PATCH(event({ params, method: 'PATCH', body: { title: `Renamed${TAG}`, pinned: true } })));
    expect(renamed.status).toBe(200);
    const [row] = await db.select().from(conversations).where(eq(conversations.id, ids.member!));
    expect(row.title).toBe(`Renamed${TAG}`);
    expect(row.thinkingLevel).toBeNull();
    expect(row.shareVisibility).toBe('private');
  });

  it("a member's new thread is theirs and ignores owner-only fields", async () => {
    const { POST } = await import('../../routes/api/jkai/conversations/+server');
    asMember();
    const res = await run(() =>
      POST(event({ body: { title: `New${TAG}`, source: 'whatsapp', whatsappPhoneNumber: '+440000000000', modelProvider: 'openrouter', modelId: 'openai/gpt-5' } })),
    );
    expect(res.status).toBe(201);
    ids.created = res.body.id;
    expect(res.body.principalId).toBe(MEMBER);
    expect(res.body.source).toBe('web');
    expect(res.body.whatsappPhoneNumber).toBeNull();
    expect(res.body.thinkingLevel).toBeNull();
    expect(res.body.modelPinnedByUser).toBe(false);
  });

  it("a member's upload is stamped theirs, never mirrored to /drive, and refused in the owner's thread", async () => {
    const { POST } = await import('../../routes/api/jkai/attachments/+server');
    asMember();
    const upload = (conversationId: string) => {
      const fd = new FormData();
      fd.append('conversationId', conversationId);
      fd.append('file', new Blob([`hello ${TAG}`], { type: 'text/plain' }), 'note.txt');
      return run(() => POST(event({ form: fd })));
    };
    const before = mirrorCalls.n;
    const mine = await upload(ids.member!);
    expect(mine.status).toBe(200);
    expect(mine.body.principalId).toBe(MEMBER);
    const [row] = await db.select().from(jkaiAttachments).where(eq(jkaiAttachments.id, mine.body.id));
    expect(row.principalId).toBe(MEMBER);
    expect(mirrorCalls.n).toBe(before);

    expect((await upload(ids.owner!)).status).toBe(404);
    const ownerRows = await db.select().from(jkaiAttachments).where(eq(jkaiAttachments.conversationId, ids.owner!));
    expect(ownerRows.map((r) => r.id)).toEqual([ids.ownerAttachment]);
  });

  it("a member cannot read or delete the owner's attachment", async () => {
    const att = await import('../../routes/api/jkai/attachments/[id]/+server');
    asMember();
    const params = { id: ids.ownerAttachment! };
    expect((await run(() => att.GET(event({ params })))).status).toBe(404);
    expect((await run(() => att.DELETE(event({ params, method: 'DELETE' })))).status).toBe(404);
    const [still] = await db.select().from(jkaiAttachments).where(eq(jkaiAttachments.id, ids.ownerAttachment!));
    expect(still).toBeDefined();
  });

  it('the owner still reaches everything', async () => {
    const thread = await import('../../routes/api/jkai/conversations/[id]/+server');
    asOwner();
    expect((await run(() => thread.GET(event({ params: { id: ids.owner! } })))).status).toBe(200);
  });
});
