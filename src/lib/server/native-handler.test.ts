import { error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The member device lane, end to end below the route: which credential gets
// through which wrapper, and — the part that matters — who the REST of the
// request then believes it is talking to. A member's phone that reached a
// handler looking sessionless would be read as the owner by every helper that
// asks `viewerOf`, so these assert on `viewerOf` and `chatAccess` themselves,
// not on a flag the wrapper set.

const OWNER = 'owner@example.test';
const ANN = 'ann@example.test';

const h = vi.hoisted(() => ({
  identity: null as null | { id: string; ownerEmail: string; label: string | null; expiresAt: Date },
  members: new Map<string, { principalId: string; grants: Set<string> }>(),
  memberLookupFails: false,
}));

vi.mock('$env/dynamic/private', () => ({ env: { AUTH_ALLOWED_EMAILS: 'owner@example.test' } }));
vi.mock('$lib/db', () => ({ db: {} }));
vi.mock('./native-auth', () => ({
  identifyDevice: async () => h.identity,
  touchDevice: async () => {},
}));
vi.mock('./access', () => ({ isOwnerEmail: (e: string | null | undefined) => (e ?? '').trim().toLowerCase() === OWNER }));
vi.mock('./grants', () => ({
  loadMember: async (e: string) => {
    if (h.memberLookupFails) throw new Error('db down');
    return h.members.get(e) ?? null;
  },
}));
// chat-access.server reaches for these at import; nothing here calls them.
vi.mock('$lib/server/models/settings', () => ({ getSetting: async () => null }));
vi.mock('$lib/workflows/chat/job-store', () => ({ getJob: () => null }));

const { withDevice, withNativeAccess } = await import('./native-handler');
const { actAsDeviceMember, memberDevice, nativeDevice } = await import('./native-gate');
const { viewerOf } = await import('./viewer');
const { chatAccess } = await import('$lib/jkai/chat-access.server');

function device(email: string) {
  return { id: `dev-${email}`, ownerEmail: email, label: 'iPhone', expiresAt: new Date('2026-12-01T00:00:00Z') };
}

function makeEvent(opts: { bearer?: boolean; session?: string | null } = {}): RequestEvent {
  const headers: Record<string, string> = {};
  if (opts.bearer !== false) headers.authorization = `Bearer ${'x'.repeat(43)}`;
  const url = new URL('https://site.test/api/native/me');
  const session = opts.session ? { user: { email: opts.session }, expires: '2027-01-01T00:00:00Z' } : null;
  return {
    request: new Request(url, { headers }),
    url,
    locals: { auth: async () => session },
  } as unknown as RequestEvent;
}

async function body(res: Response) {
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  h.identity = null;
  h.members.clear();
  h.memberLookupFails = false;
});

describe('withNativeAccess', () => {
  it('401s a missing, unknown or expired token, as withDevice does', async () => {
    const handler = vi.fn(() => ({ ok: true }));
    const res = await body(await withNativeAccess('news', handler)(makeEvent()));
    expect(res).toEqual({ status: 401, json: { error: 'Pair this iPhone again.' } });
    expect(handler).not.toHaveBeenCalled();
  });

  it('lets the owner through exactly as before: role owner, locals untouched, the seam reads OWNER', async () => {
    h.identity = device(OWNER);
    const event = makeEvent();
    let seen: unknown;
    const res = await withNativeAccess('jkai.chat', async (e, identity, role) => {
      seen = { role, email: identity.ownerEmail, viewer: await viewerOf(e), access: await chatAccess(e) };
      return { ok: true };
    })(event);
    expect(res.status).toBe(200);
    expect(seen).toEqual({
      role: 'owner',
      email: OWNER,
      viewer: { kind: 'anonymous' },
      access: { level: 'owner', own: 'owner' },
    });
  });

  it("lets a member holding the area through, and the request then IS that member", async () => {
    h.identity = device(ANN);
    h.members.set(ANN, { principalId: 'u_ann', grants: new Set(['jkai.chat:self', 'news:self']) });
    const event = makeEvent();
    let seen: Record<string, unknown> = {};
    const res = await withNativeAccess('jkai.chat', async (e, _identity, role) => {
      seen = {
        role,
        viewer: await viewerOf(e),
        session: (await e.locals.auth())?.user?.email,
        access: await chatAccess(e),
      };
      return { ok: true };
    })(event);
    expect(res.status).toBe(200);
    expect(seen.role).toBe('member');
    expect(seen.viewer).toMatchObject({ kind: 'member', principalId: 'u_ann', email: ANN });
    expect(seen.session).toBe(ANN);
    // Not the owner's access — the whole point.
    expect(seen.access).toEqual({ level: 'self', own: 'u_ann' });
  });

  it('403s a member who does not hold the area, before the handler runs', async () => {
    h.identity = device(ANN);
    h.members.set(ANN, { principalId: 'u_ann', grants: new Set(['news:self']) });
    const handler = vi.fn(() => ({ ok: true }));
    const res = await body(await withNativeAccess('jkai.chat', handler)(makeEvent()));
    expect(res).toEqual({ status: 403, json: { error: 'Your access does not include that.' } });
    expect(handler).not.toHaveBeenCalled();
  });

  it('403s an email that holds nothing any more, and fails closed when the lookup fails', async () => {
    h.identity = device(ANN);
    const handler = vi.fn(() => ({ ok: true }));
    expect((await withNativeAccess('any', handler)(makeEvent())).status).toBe(403);
    h.members.set(ANN, { principalId: 'u_ann', grants: new Set(['news:self']) });
    h.memberLookupFails = true;
    expect((await withNativeAccess('news', handler)(makeEvent())).status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });

  it("'any' answers a member whatever they hold", async () => {
    h.identity = device(ANN);
    h.members.set(ANN, { principalId: 'u_ann', grants: new Set(['research:self']) });
    const res = await withNativeAccess('any', (_e, _i, role) => ({ role }))(makeEvent());
    expect(await body(res)).toEqual({ status: 200, json: { role: 'member' } });
  });

  it('never lets a stray session cookie widen a member device', async () => {
    h.identity = device(ANN);
    h.members.set(ANN, { principalId: 'u_ann', grants: new Set(['jkai.chat:self']) });
    const event = makeEvent({ session: OWNER });
    const res = await withNativeAccess('jkai.chat', async (e) => ({
      email: (await e.locals.auth())?.user?.email,
      level: (await chatAccess(e)).level,
    }))(event);
    expect((await body(res)).json).toEqual({ email: ANN, level: 'self' });
  });

  it('returns a thrown refusal as { error } with its status, and flattens anything else', async () => {
    h.identity = device(ANN);
    h.members.set(ANN, { principalId: 'u_ann', grants: new Set(['jkai.chat:self']) });
    const capped = withNativeAccess('jkai.chat', () => {
      throw error(429, 'That is 30 files today — the limit.');
    });
    expect(await body(await capped(makeEvent()))).toEqual({ status: 429, json: { error: 'That is 30 files today — the limit.' } });
    const broken = withNativeAccess('jkai.chat', () => {
      throw new Error('internal detail');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await body(await broken(makeEvent()))).toEqual({ status: 500, json: { error: 'Something went wrong. Try again.' } });
  });
});

describe('withDevice stays owner-only', () => {
  it('403s a member device whatever it holds', async () => {
    h.identity = device(ANN);
    h.members.set(ANN, { principalId: 'u_ann', grants: new Set(['jkai.chat:admin', 'news:admin']) });
    const handler = vi.fn(() => ({ ok: true }));
    const res = await body(await withDevice(handler)(makeEvent()));
    expect(res).toEqual({ status: 403, json: { error: 'This account can no longer use the app.' } });
    expect(handler).not.toHaveBeenCalled();
  });

  it('still serves the owner', async () => {
    h.identity = device(OWNER);
    expect((await withDevice(() => ({ ok: true }))(makeEvent())).status).toBe(200);
  });
});

describe('the hook helpers', () => {
  it('nativeDevice answers only for the owner; memberDevice only for a member', async () => {
    h.members.set(ANN, { principalId: 'u_ann', grants: new Set(['jkai.chat:self']) });
    h.identity = device(OWNER);
    expect(await nativeDevice(makeEvent().request)).toMatchObject({ ownerEmail: OWNER });
    expect(await memberDevice(makeEvent().request)).toBeNull();

    h.identity = device(ANN);
    expect(await nativeDevice(makeEvent().request)).toBeNull();
    expect(await memberDevice(makeEvent().request)).toMatchObject({ principalId: 'u_ann', identity: { ownerEmail: ANN } });

    h.identity = device('guest@example.test');
    expect(await memberDevice(makeEvent().request)).toBeNull();
  });

  it('memberDevice never touches the database for a request with no bearer', async () => {
    h.identity = device(ANN);
    h.members.set(ANN, { principalId: 'u_ann', grants: new Set(['jkai.chat:self']) });
    expect(await memberDevice(makeEvent({ bearer: false }).request)).toBeNull();
  });

  it('memberDevice reads a failed lookup as no member', async () => {
    h.identity = device(ANN);
    h.memberLookupFails = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await memberDevice(makeEvent().request)).toBeNull();
  });

  /**
   * The orchestrator lane: a member's phone on /api/workflows/orchestrator/chat
   * is made to look like the member signed in, then falls through to the
   * member gate. What the chat handler then sees is `chatAccess(event)` — this
   * is that call, on locals set exactly as the hook sets them.
   */
  it("makes the orchestrator handler's chatAccess answer for the member, not the owner", async () => {
    h.identity = device(ANN);
    h.members.set(ANN, { principalId: 'u_ann', grants: new Set(['jkai.chat:self']) });
    const event = makeEvent();
    // Something earlier in the request had already cached a sessionless answer.
    event.locals.viewer = Promise.resolve({ kind: 'anonymous' });
    const held = await memberDevice(event.request);
    expect(held).not.toBeNull();
    actAsDeviceMember(event.locals, held!);
    expect(await viewerOf(event)).toMatchObject({ kind: 'member', principalId: 'u_ann' });
    expect((await event.locals.auth())?.user?.email).toBe(ANN);
    expect(await chatAccess(event)).toEqual({ level: 'self', own: 'u_ann' });
  });
});
