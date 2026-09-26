import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db } from '$lib/db';
import { activityPrincipals, allowedUser, daydreamNotebook, daydreamNotebookAudio } from '$lib/db/schema';

// P4 proof for the notebook and /home: real notes of the owner and of member
// A, real member rows through the real seam, the real handlers. A member never
// reads, changes or reviews the owner's notebook; an `all` reader reads A's but
// cannot change it; home:self does not reach the voice log.
//
// Touches only rows it creates (tagged), deletes them after. No review, weave
// or transcription runs: those are refused before they start, or mocked.

vi.mock('$lib/daydream/notebook/review', () => ({
  reviewNote: vi.fn(async () => { throw new Error('tripwire: a review ran'); }),
}));
vi.mock('$lib/daydream/notebook/cards', () => ({
  weaveNote: vi.fn(async () => { throw new Error('tripwire: a weave ran'); }),
}));
vi.mock('$lib/alexa/store.server', () => ({
  voiceSummary: vi.fn(async () => ({})),
  searchUtterances: vi.fn(async () => []),
  emptyVoiceSummary: () => ({}),
  houseSummary: vi.fn(async () => ({ now: [] })),
  emptyHouseSummary: () => ({ now: [] }),
}));

const TAG = `n${Math.random().toString(36).slice(2, 10)}`;
const OWNER_SECRET = `Ownernote${TAG}`;
const A_WORD = `Membernote${TAG}`;
const A_EMAIL = `a-${TAG}@example.test`;
const B_EMAIL = `b-${TAG}@example.test`;
const H_EMAIL = `h-${TAG}@example.test`;
const A = `u_a${TAG}`;
const B = `u_b${TAG}`;
const H = `u_h${TAG}`;
const ids: Record<string, string> = {};

function event(email: string | null, opts: { url?: string; params?: Record<string, string>; body?: unknown } = {}) {
  const url = new URL(opts.url ?? 'http://test.local/');
  return {
    url,
    request: new Request(url, {
      method: opts.body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    }),
    params: opts.params ?? {},
    route: { id: null },
    locals: { auth: async () => (email ? { user: { email } } : null) },
    getClientAddress: () => '203.0.113.9',
  } as any;
}

async function run<T>(fn: () => Promise<T> | T): Promise<{ status: number; body: unknown }> {
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

const leaks = (body: unknown) =>
  [OWNER_SECRET, ids.owner].filter((s) => s && JSON.stringify(body ?? null).includes(s));

describe.skipIf(!process.env.DATABASE_URL)('the notebook is scoped to the reader', () => {
  beforeAll(async () => {
    await db.insert(allowedUser).values([
      { email: A_EMAIL, grants: ['jkai.notes:self'], note: 'notes-access.integration' },
      { email: B_EMAIL, grants: ['jkai.notes:all'], note: 'notes-access.integration' },
      { email: H_EMAIL, grants: ['home:self'], note: 'notes-access.integration' },
    ]);
    await db.insert(activityPrincipals).values([
      { id: A, kind: 'user', externalRef: A_EMAIL, label: 'test a' },
      { id: B, kind: 'user', externalRef: B_EMAIL, label: 'test b' },
      { id: H, kind: 'user', externalRef: H_EMAIL, label: 'test h' },
    ]);
    const [owner] = await db
      .insert(daydreamNotebook)
      .values({ title: `${OWNER_SECRET} title`, body: `${OWNER_SECRET} private`, folder: `Secret${TAG}` })
      .returning({ id: daydreamNotebook.id });
    const [mine] = await db
      .insert(daydreamNotebook)
      .values({ title: `${A_WORD} title`, body: 'mine', principalId: A })
      .returning({ id: daydreamNotebook.id });
    ids.owner = owner.id;
    ids.mine = mine.id;
    const [rec] = await db
      .insert(daydreamNotebookAudio)
      .values({ noteId: owner.id, mimeType: 'audio/webm', sizeBytes: 1, diskPath: `test/${TAG}.webm` })
      .returning({ id: daydreamNotebookAudio.id });
    ids.ownerRecording = rec.id;
  });

  afterAll(async () => {
    await db.delete(daydreamNotebook).where(inArray(daydreamNotebook.principalId, [A, B]));
    if (ids.owner) await db.delete(daydreamNotebook).where(eq(daydreamNotebook.id, ids.owner));
    await db.delete(activityPrincipals).where(inArray(activityPrincipals.id, [A, B, H]));
    await db.delete(allowedUser).where(inArray(allowedUser.email, [A_EMAIL, B_EMAIL, H_EMAIL]));
  });

  it("lists a member's own notes and folders, never the owner's", async () => {
    const api = await import('../../../routes/api/daydream/notes/+server');
    const res = await run(() => api.GET(event(A_EMAIL)));
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain(A_WORD);
    expect(leaks(res.body)).toEqual([]);
    expect(JSON.stringify(res.body)).not.toContain(`Secret${TAG}`);

    const page = await import('../../../routes/jkai/notes/+page.server');
    const loaded = await run(() => page.load(event(A_EMAIL)));
    expect(leaks(loaded.body)).toEqual([]);
    expect(loaded.body).toMatchObject({ ownerTools: false });
  });

  it("refuses the owner's note by id on every action, and changes nothing", async () => {
    const api = await import('../../../routes/api/daydream/notes/+server');
    for (const action of ['get', 'delete', 'clear_supporting']) {
      const res = await run(() => api.POST(event(A_EMAIL, { body: { action, id: ids.owner } })));
      expect(res.status, action).toBe(404);
      expect(leaks(res.body), action).toEqual([]);
    }
    const save = await run(() => api.POST(event(A_EMAIL, { body: { action: 'save', id: ids.owner, body: 'overwritten' } })));
    expect(save.status).toBe(404);
    for (const action of ['review_now', 'weave']) {
      const res = await run(() => api.POST(event(A_EMAIL, { body: { action, id: ids.mine } })));
      expect(res.status, action).toBe(403);
    }
    const [still] = await db.select().from(daydreamNotebook).where(eq(daydreamNotebook.id, ids.owner));
    expect(still.body).toBe(`${OWNER_SECRET} private`);
  });

  it("a new note is the member's", async () => {
    const api = await import('../../../routes/api/daydream/notes/+server');
    const res = await run(() => api.POST(event(A_EMAIL, { body: { action: 'save', title: `New${TAG}` } })));
    expect((res.body as { note: { principalId: string } }).note.principalId).toBe(A);
  });

  it("an `all` reader reads A's note but cannot change it", async () => {
    const api = await import('../../../routes/api/daydream/notes/+server');
    const read = await run(() => api.POST(event(B_EMAIL, { body: { action: 'get', id: ids.mine } })));
    expect(read.status).toBe(200);
    const write = await run(() => api.POST(event(B_EMAIL, { body: { action: 'save', id: ids.mine, body: 'x' } })));
    expect(write.status).toBe(403);
  });

  it("the owner's recording is not found for a member", async () => {
    const rec = await import('../../../routes/api/daydream/notes/audio/[id]/+server');
    expect((await run(() => rec.GET(event(A_EMAIL, { params: { id: ids.ownerRecording } })))).status).toBe(404);
    expect((await run(() => rec.DELETE(event(A_EMAIL, { params: { id: ids.ownerRecording } })))).status).toBe(404);
  });

  it('home:self reaches the house but not the voice log', async () => {
    const voice = await import('../../../routes/home/voice/+page.server');
    expect((await run(() => voice.load(event(H_EMAIL)))).status).toBe(403);
    const echoes = await import('../../../routes/home/echoes/+page.server');
    expect((await run(() => echoes.load(event(H_EMAIL)))).status).toBe(200);
    // Notes are not theirs to reach at all.
    const api = await import('../../../routes/api/daydream/notes/+server');
    expect((await run(() => api.GET(event(H_EMAIL)))).status).toBe(403);
  });
});
