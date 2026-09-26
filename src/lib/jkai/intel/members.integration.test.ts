import { describe, it, expect, afterAll, beforeAll, vi } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db } from '$lib/db';
import {
  activityPrincipals,
  allowedUser,
  intelEntities,
  intelEntityTypes,
  intelNotes,
  intelRelationships,
  intelTimelineEvents,
} from '$lib/db/schema';
import { resolveRequestScope } from './scope.server';
import { ensureBuiltInGroups } from '$lib/server/grants';

// The PR B proof: a MEMBER session — a real allowed_user row with role
// 'member' and a real principal, resolved by the REAL `resolveRequestScope` —
// reaches every route `isMemberAllowedRoute` opens and gets none of the owner's
// rows back from any of them. Nothing here mocks the scope seam: the
// route-scope test proves each file CALLS it, this proves what comes back.
//
// Touches only rows it creates (all named with this run's tag), and deletes
// them after. No cleanup, purge, merge or engine path is run.

vi.mock('./embed', () => ({
  embedNote: vi.fn(),
  embedEntity: vi.fn(),
  generateEmbedding: vi.fn(async () => { throw new Error('offline'); }),
}));
vi.mock('$lib/llm/client', () => ({
  getLLMClient: vi.fn(() => { throw new Error('offline'); }),
}));
// The roster is shared machinery a member must never trigger.
vi.mock('./cluster-roster', () => ({
  buildClusterRoster: vi.fn(async () => { throw new Error('tripwire: roster rebuilt for a member'); }),
  recalculateClusterRoster: vi.fn(async () => { throw new Error('tripwire: roster recalculated for a member'); }),
}));

const TAG = `m${Math.random().toString(36).slice(2, 10)}`;
const MEMBER_EMAIL = `member-${TAG}@example.test`;
const GUEST_EMAIL = `guest-${TAG}@example.test`;
const PRINCIPAL = `u_${TAG}`;
// A second member holding `jkai.intel:all` through a one-off grant, and a third
// holding only Family Circle: the groups era's two new shapes of member.
const READER_EMAIL = `reader-${TAG}@example.test`;
const READER = `u_r${TAG}`;
const FAMILY_EMAIL = `family-${TAG}@example.test`;
const FAMILY = `u_f${TAG}`;
/** Words that appear in the owner's seeded rows and nowhere else. */
const OWNER_SECRET = `Ownersecret${TAG}`;
const MEMBER_WORD = `Memberthing${TAG}`;

const ids: Record<string, string> = {};

function event(email: string | null, opts: { url?: string; params?: Record<string, string>; method?: string; body?: unknown } = {}) {
  const url = new URL(opts.url ?? 'http://test.local/');
  const request = new Request(url, {
    method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
    headers: { 'content-type': 'application/json' },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return {
    url,
    request,
    params: opts.params ?? {},
    route: { id: null },
    locals: { auth: async () => (email ? { user: { email } } : null) },
    fetch,
    parent: async () => ({}),
    depends: () => {},
    setHeaders: () => {},
    untrack: <T>(fn: () => T) => fn(),
    getClientAddress: () => '203.0.113.9',
    cookies: { get: () => undefined, getAll: () => [], set: () => {}, delete: () => {}, serialize: () => '' },
  } as any;
}

/** Run a handler or load; a thrown HttpError becomes `{ status }`. */
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

function leaks(body: unknown): string[] {
  const text = JSON.stringify(body ?? null);
  return [OWNER_SECRET, ids.ownerNote, ids.ownerEntity, ids.ownerMail].filter((s) => s && text.includes(s));
}

describe.skipIf(!process.env.DATABASE_URL)('a member session sees only its own space and household', () => {
  beforeAll(async () => {
    await db.insert(allowedUser).values([
      { email: MEMBER_EMAIL, role: 'member', note: 'members.integration' },
      { email: GUEST_EMAIL, role: 'guest', note: 'members.integration' },
      { email: READER_EMAIL, grants: ['jkai.intel:all'], note: 'members.integration' },
      { email: FAMILY_EMAIL, groups: ['family-circle'], note: 'members.integration' },
    ]);
    await db.insert(activityPrincipals).values([
      { id: PRINCIPAL, kind: 'user', externalRef: MEMBER_EMAIL, label: 'test member' },
      { id: READER, kind: 'user', externalRef: READER_EMAIL, label: 'test reader' },
      { id: FAMILY, kind: 'user', externalRef: FAMILY_EMAIL, label: 'test family' },
    ]);
    await ensureBuiltInGroups();

    const [type] = await db.select({ id: intelEntityTypes.id }).from(intelEntityTypes).limit(1);

    const [ownerNote] = await db.insert(intelNotes).values({
      title: `${OWNER_SECRET} note`, rawContent: `${OWNER_SECRET} private notes.`, source: 'web', spaceId: 'owner',
    }).returning({ id: intelNotes.id });
    ids.ownerNote = ownerNote.id;
    const [ownerEntity] = await db.insert(intelEntities).values({
      name: `${OWNER_SECRET} Ltd`, typeId: type.id, spaceId: 'owner', firstSeenIn: ownerNote.id,
    }).returning({ id: intelEntities.id });
    ids.ownerEntity = ownerEntity.id;
    const [ownerOther] = await db.insert(intelEntities).values({
      name: `${OWNER_SECRET} Person`, typeId: type.id, spaceId: 'owner', firstSeenIn: ownerNote.id,
    }).returning({ id: intelEntities.id });
    ids.ownerOther = ownerOther.id;
    await db.insert(intelRelationships).values({
      sourceEntityId: ownerEntity.id, targetEntityId: ownerOther.id, type: 'employs',
      sourceNoteId: ownerNote.id, spaceId: 'owner',
    });
    await db.insert(intelTimelineEvents).values({
      noteId: ownerNote.id, type: 'milestone', title: `${OWNER_SECRET} event`, date: new Date().toISOString().slice(0, 10), spaceId: 'owner',
    });
    // A held owner thread: the member's mail queue must not show it.
    const [ownerMail] = await db.insert(intelNotes).values({
      title: `${OWNER_SECRET} thread`, rawContent: `${OWNER_SECRET} mail`, source: 'email',
      graphState: 'pending', status: 'held', spaceId: 'owner',
      metadata: { autoKind: 'file', refId: `gmail:${TAG}`, gmailThreadId: TAG },
    }).returning({ id: intelNotes.id });
    ids.ownerMail = ownerMail.id;

    const [memberNote] = await db.insert(intelNotes).values({
      title: `${MEMBER_WORD} note`, rawContent: `${MEMBER_WORD} notes.`, source: 'web', spaceId: PRINCIPAL,
    }).returning({ id: intelNotes.id });
    ids.memberNote = memberNote.id;
    const [memberEntity] = await db.insert(intelEntities).values({
      name: `${MEMBER_WORD} Club`, typeId: type.id, spaceId: PRINCIPAL, firstSeenIn: memberNote.id,
    }).returning({ id: intelEntities.id });
    ids.memberEntity = memberEntity.id;
  });

  afterAll(async () => {
    const notes = [ids.ownerNote, ids.ownerMail, ids.memberNote].filter(Boolean);
    const entities = [ids.ownerEntity, ids.ownerOther, ids.memberEntity].filter(Boolean);
    if (notes.length) await db.delete(intelTimelineEvents).where(inArray(intelTimelineEvents.noteId, notes));
    if (notes.length) await db.delete(intelRelationships).where(inArray(intelRelationships.sourceNoteId, notes));
    if (entities.length) await db.delete(intelEntities).where(inArray(intelEntities.id, entities));
    if (notes.length) await db.delete(intelNotes).where(inArray(intelNotes.id, notes));
    await db.delete(activityPrincipals).where(inArray(activityPrincipals.id, [PRINCIPAL, READER, FAMILY]));
    await db.delete(allowedUser).where(inArray(allowedUser.email, [MEMBER_EMAIL, GUEST_EMAIL, READER_EMAIL, FAMILY_EMAIL]));
  });

  it('resolves the member to their own space then household, and a guest to 403', async () => {
    expect([...(await resolveRequestScope(event(MEMBER_EMAIL)))]).toEqual([PRINCIPAL, 'household']);
    await expect(resolveRequestScope(event(GUEST_EMAIL))).rejects.toMatchObject({ status: 403 });
  });

  it("an `all` reader reads the member's space and never the owner's; writes stay its own", async () => {
    const scope = [...(await resolveRequestScope(event(READER_EMAIL)))];
    expect(scope.slice(0, 2)).toEqual([READER, 'household']);
    expect(scope).toContain(PRINCIPAL);
    expect(scope).not.toContain('owner');
    expect([...(await resolveRequestScope(event(READER_EMAIL), 'write'))]).toEqual([READER, 'household']);

    const network = await import('../../../routes/api/jkai/intel/network/+server');
    const res = await run(() => network.GET(event(READER_EMAIL, { url: 'http://test.local/api/jkai/intel/network' })));
    expect(res.status).toBe(200);
    expect(leaks(res.body)).toEqual([]);
    expect(JSON.stringify(res.body)).toContain(MEMBER_WORD);
  });

  it('a member holding only Family Circle gets no intel at all', async () => {
    await expect(resolveRequestScope(event(FAMILY_EMAIL))).rejects.toMatchObject({ status: 403 });
  });

  it('read APIs return none of the owner rows', async () => {
    const network = await import('../../../routes/api/jkai/intel/network/+server');
    const evidence = await import('../../../routes/api/jkai/intel/evidence-network/+server');
    const entities = await import('../../../routes/api/jkai/intel/entities/+server');
    const notes = await import('../../../routes/api/jkai/intel/notes/+server');
    const mail = await import('../../../routes/api/jkai/intel/mail/+server');

    const cases: Array<[string, { status: number; body: unknown }]> = [
      ['network', await run(() => network.GET(event(MEMBER_EMAIL, { url: 'http://test.local/api/jkai/intel/network' })))],
      ['evidence-network', await run(() => evidence.GET(event(MEMBER_EMAIL, { url: 'http://test.local/api/jkai/intel/evidence-network' })))],
      ['entities', await run(() => entities.GET(event(MEMBER_EMAIL, { url: 'http://test.local/api/jkai/intel/entities?limit=500' })))],
      ['notes', await run(() => notes.GET(event(MEMBER_EMAIL, { url: 'http://test.local/api/jkai/intel/notes?limit=500' })))],
      ['mail queue', await run(() => mail.GET(event(MEMBER_EMAIL, { url: 'http://test.local/api/jkai/intel/mail' })))],
    ];
    for (const [name, res] of cases) {
      expect(res.status, name).toBe(200);
      expect(leaks(res.body), name).toEqual([]);
    }
    // Positive control: the member's own entity is in their graph, so the
    // absences above are the scope and not an empty response.
    expect(JSON.stringify(cases[0][1].body)).toContain(MEMBER_WORD);
  });

  it('by-id reads 404 on an owner row and answer on their own', async () => {
    const card = await import('../../../routes/api/jkai/intel/entity-card/+server');
    const entity = await import('../../../routes/api/jkai/intel/entities/[id]/+server');
    const note = await import('../../../routes/api/jkai/intel/notes/[id]/+server');

    const ownerCard = await run(() => card.GET(event(MEMBER_EMAIL, { url: `http://test.local/api/jkai/intel/entity-card?id=${ids.ownerEntity}` })));
    expect(ownerCard.status).toBe(404);
    expect(leaks(ownerCard.body)).toEqual([]);
    const ownCard = await run(() => card.GET(event(MEMBER_EMAIL, { url: `http://test.local/api/jkai/intel/entity-card?id=${ids.memberEntity}` })));
    expect(ownCard.status).toBe(200);

    const ownerEntity = await run(() => entity.GET(event(MEMBER_EMAIL, { params: { id: ids.ownerEntity } })));
    expect(ownerEntity.status).toBe(404);
    expect(leaks(ownerEntity.body)).toEqual([]);
    const ownerNote = await run(() => note.GET(event(MEMBER_EMAIL, { params: { id: ids.ownerNote } })));
    expect(ownerNote.status).toBe(404);
    expect(leaks(ownerNote.body)).toEqual([]);
  });

  it('page loads carry none of the owner rows', async () => {
    const loads: Array<[string, () => Promise<unknown>]> = [
      ['intel layout', async () => (await import('../../../routes/jkai/intel/+layout.server')).load(event(MEMBER_EMAIL, { url: 'http://test.local/jkai/intel' }))],
      ['intel page', async () => (await import('../../../routes/jkai/intel/+page.server')).load(event(MEMBER_EMAIL, { url: 'http://test.local/jkai/intel' }))],
      ['notes', async () => (await import('../../../routes/jkai/intel/notes/+page.server')).load(event(MEMBER_EMAIL, { url: 'http://test.local/jkai/intel/notes' }))],
      ['entities', async () => (await import('../../../routes/jkai/intel/entities/+page.server')).load(event(MEMBER_EMAIL, { url: 'http://test.local/jkai/intel/entities' }))],
      ['timeline', async () => (await import('../../../routes/jkai/intel/timeline/+page.server')).load(event(MEMBER_EMAIL, { url: 'http://test.local/jkai/intel/timeline' }))],
      ['mail', async () => (await import('../../../routes/jkai/intel/mail/+page.server')).load(event(MEMBER_EMAIL, { url: 'http://test.local/jkai/intel/mail' }))],
    ];
    for (const [name, load] of loads) {
      const res = await run(load);
      expect(res.status, name).toBe(200);
      expect(leaks(res.body), name).toEqual([]);
    }

    const entityPage = await import('../../../routes/jkai/intel/entities/[id]/+page.server');
    expect((await run(() => entityPage.load(event(MEMBER_EMAIL, { params: { id: ids.ownerEntity } })))).status).toBe(404);
    const notePage = await import('../../../routes/jkai/intel/notes/[id]/+page.server');
    expect((await run(() => notePage.load(event(MEMBER_EMAIL, { params: { id: ids.ownerNote } })))).status).toBe(404);
  });

  it("the /jkai shell hands a member none of the owner's hub metrics", async () => {
    const { load } = await import('../../../routes/jkai/+layout.server');
    const data = (await load(event(MEMBER_EMAIL, { url: 'http://test.local/jkai/intel' }))) as {
      member: boolean;
      hub: Record<string, unknown>;
    };
    expect(data.member).toBe(true);
    expect(data.hub).toMatchObject({ spendTodayUsd: 0, credit: null, codex: null, workflowCount: 0 });
  });

  it('mail triage refuses an owner thread as not-found and records nothing for it', async () => {
    const mail = await import('../../../routes/api/jkai/intel/mail/+server');
    const res = await run(() => mail.POST(event(MEMBER_EMAIL, { body: { action: 'reject', noteIds: [ids.ownerMail] } })));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ rejected: 0 });
    const [row] = await db.select({ state: intelNotes.graphState }).from(intelNotes).where(eq(intelNotes.id, ids.ownerMail));
    expect(row.state).toBe('pending');
  });
});
