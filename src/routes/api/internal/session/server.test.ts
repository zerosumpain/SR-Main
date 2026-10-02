import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The session authority's claims: what the edge gateway signs for Drive (the
 * member's principal, drive level, grants and visible names) and for the
 * project apps (the visibility/share decision). The database is a queue of
 * answers; each test says what the rows hold in the order the code asks.
 */

const state = vi.hoisted(() => ({
  queue: [] as unknown[],
  ops: [] as string[],
  email: null as string | null,
  allowed: new Set<string>(),
  driveOpen: true,
  shareValid: false,
  shareCalls: [] as [string, string][],
}));

vi.mock('$lib/db', () => {
  const chain = (op: string) => {
    state.ops.push(op);
    let settled: Promise<unknown> | null = null;
    const proxy: object = new Proxy(
      {},
      {
        get(_, key) {
          if (key === 'then') {
            settled ??= (() => {
              const next = state.queue.shift();
              return next instanceof Error ? Promise.reject(next) : Promise.resolve(next ?? []);
            })();
            return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => settled!.then(res, rej);
          }
          return () => proxy;
        },
      },
    );
    return proxy;
  };
  return { db: { select: () => chain('select'), update: () => chain('update') } };
});
vi.mock('$env/dynamic/private', () => ({
  env: {
    AUTH_SECRET: 's'.repeat(40),
    AUTH_ALLOWED_EMAILS: 'owner@x.test',
    SESSION_INTROSPECTION_KEYS: JSON.stringify({
      'sr-drive': 'd'.repeat(40),
      'sr-policy-engine': 'p'.repeat(40),
      'sr-health': 'h'.repeat(40),
    }),
  },
}));
vi.mock('$lib/server/session-introspection', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/server/session-introspection')>()),
  browserSessionEmail: async () => state.email,
}));
vi.mock('$lib/server/access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/server/access')>()),
  isEmailAllowedToSignIn: async (e: string) => e === 'owner@x.test' || state.allowed.has(e),
}));
vi.mock('$lib/server/view-as', () => ({
  verifyViewAs: (_s: string, _owner: string, value: string | undefined) =>
    value === 'signed-for-ada' ? { email: 'ada@x.test', expiresAt: 0 } : null,
}));
vi.mock('$lib/projects/shares', () => ({
  shareCookieName: (key: string) => `psh_${key}`,
  validateProjectShare: async (key: string, token: string) => {
    state.shareCalls.push([key, token]);
    return state.shareValid;
  },
}));
vi.mock('$lib/access/catalogue', async (importOriginal) => {
  const real = await importOriginal<typeof import('$lib/access/catalogue')>();
  return {
    ...real,
    isOpenPermission: (p: string) => (p.startsWith('drive:') ? state.driveOpen : real.isOpenPermission(p as never)),
  };
});

const { POST } = await import('./+server');

function call(audience: string, key: string, extra: Record<string, string> = {}) {
  const request = new Request('http://127.0.0.1/api/internal/session', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'x-sr-session-audience': audience, ...extra },
  });
  return POST({ request } as never) as Promise<Response>;
}

const memberRow = (over: Record<string, unknown> = {}) => ({
  role: 'guest', groups: [], grants: ['drive:all'], principalId: 'u_ada', label: 'Ada', ...over,
});

beforeEach(() => {
  state.queue.length = 0;
  state.ops.length = 0;
  state.email = null;
  state.allowed = new Set(['ada@x.test', 'bo@x.test']);
  state.driveOpen = true;
  state.shareValid = false;
  state.shareCalls.length = 0;
});

describe('session authority claims', () => {
  it('refuses a caller without its own audience key', async () => {
    expect((await call('sr-drive', 'p'.repeat(40))).status).toBe(401);
    expect((await call('sr-drive', 'short')).status).toBe(401);
    expect(state.ops).toHaveLength(0);
  });

  it('gives Drive a member principal, level, grants and the names they may see', async () => {
    state.email = 'ada@x.test';
    state.queue.push([memberRow()], [{ id: 'u_ada', label: 'Ada' }, { id: 'u_bo', label: 'Bo' }, { id: 'bad id', label: 'x' }]);
    const body = await (await call('sr-drive', 'd'.repeat(40))).json();
    expect(body.email).toBe('ada@x.test');
    expect(body.claims).toEqual({
      pid: 'u_ada',
      drive: { level: 'all', grants: ['drive:all'], people: { u_ada: 'Ada', u_bo: 'Bo' } },
    });
    expect(state.ops.every((op) => op === 'select')).toBe(true);
  });

  it('a self-level member learns only their own name', async () => {
    state.email = 'ada@x.test';
    state.queue.push([memberRow({ grants: ['drive:self'] })]);
    const body = await (await call('sr-drive', 'd'.repeat(40))).json();
    expect(body.claims.drive).toEqual({ level: 'self', grants: ['drive:self'], people: { u_ada: 'Ada' } });
    expect(state.ops).toEqual(['select']);
  });

  it('no drive claims for the owner, a closed drive, a missing principal, or another audience', async () => {
    state.email = 'owner@x.test';
    expect((await (await call('sr-drive', 'd'.repeat(40))).json()).claims).toEqual({});
    expect(state.ops).toHaveLength(0);

    state.email = 'ada@x.test';
    state.driveOpen = false;
    state.queue.push([memberRow()]);
    expect((await (await call('sr-drive', 'd'.repeat(40))).json()).claims).toEqual({});

    state.driveOpen = true;
    state.queue.push([memberRow({ principalId: null })]);
    expect((await (await call('sr-drive', 'd'.repeat(40))).json()).claims).toEqual({});

    state.ops.length = 0;
    expect((await (await call('sr-health', 'h'.repeat(40))).json()).claims).toEqual({});
    expect(state.ops).toHaveLength(0);
  });

  it('a failed member lookup is no claim, never a grant', async () => {
    state.email = 'ada@x.test';
    state.queue.push(new Error('db down'));
    const res = await call('sr-drive', 'd'.repeat(40));
    expect(res.status).toBe(200);
    expect((await res.json()).claims).toEqual({});
  });

  it('view-as: the owner viewing as a member receives that member\'s claims', async () => {
    state.email = 'owner@x.test';
    state.queue.push([memberRow({ grants: ['drive:self'] })]);
    const body = await (await call('sr-drive', 'd'.repeat(40), { cookie: 'sr_view_as=signed-for-ada' })).json();
    expect(body.viewingAs).toBe('ada@x.test');
    expect(body.claims.pid).toBe('u_ada');
  });

  it('decides a public project without a session or a share', async () => {
    state.queue.push([]); // no visibility row: policy-engine defaults public
    const body = await (await call('sr-policy-engine', 'p'.repeat(40))).json();
    expect(body).toEqual({ email: null, viewingAs: null, claims: { project: { key: 'policy-engine', access: 'public' } } });
    expect(state.shareCalls).toHaveLength(0);
  });

  it('a private project: owner preview, URL share before cookie, otherwise none', async () => {
    const priv = [{ projectKey: 'policy-engine', isPublic: false }];
    state.email = 'owner@x.test';
    state.queue.push(priv);
    expect((await (await call('sr-policy-engine', 'p'.repeat(40))).json()).claims.project.access).toBe('owner');

    state.email = 'bo@x.test';
    state.queue.push(priv);
    expect((await (await call('sr-policy-engine', 'p'.repeat(40))).json()).claims.project.access).toBe('none');

    state.email = null;
    state.shareValid = true;
    state.queue.push(priv);
    const viaUrl = await call('sr-policy-engine', 'p'.repeat(40), {
      'x-sr-session-share': 'url-token', cookie: 'psh_policy-engine=cookie-token',
    });
    expect((await viaUrl.json()).claims.project.access).toBe('share');
    expect(state.shareCalls.at(-1)).toEqual(['policy-engine', 'url-token']);

    state.queue.push(priv);
    await call('sr-policy-engine', 'p'.repeat(40), { cookie: 'a=b; psh_policy-engine=cookie-token' });
    expect(state.shareCalls.at(-1)).toEqual(['policy-engine', 'cookie-token']);

    state.shareValid = false;
    state.queue.push(priv);
    expect((await (await call('sr-policy-engine', 'p'.repeat(40), { 'x-sr-session-share': 'stale' })).json()).claims.project.access).toBe('none');
  });

  it('only ever answers for the audience\'s own project, and an outage is a 503', async () => {
    state.queue.push([]);
    const body = await (await call('sr-policy-engine', 'p'.repeat(40), { 'x-sr-session-project': 'dfe-data-strategy' })).json();
    expect(body.claims.project.key).toBe('policy-engine');
    state.queue.push(new Error('db down'));
    expect((await call('sr-policy-engine', 'p'.repeat(40))).status).toBe(503);
  });
});
