import { beforeEach, describe, expect, it, vi } from 'vitest';

// /welcome's load and its deleteData action, with every store faked. The
// deletion's own logic is tested in $lib/home/presence/delete-my-data.test.ts;
// this checks the page wires it to the SESSION's email and to nothing else.

vi.mock('$env/dynamic/private', () => ({ env: {} }));
const qrPayloads: string[] = [];
vi.mock('qrcode', () => ({
  default: {
    toDataURL: async (payload: string) => {
      qrPayloads.push(payload);
      return 'data:image/png;base64,';
    },
  },
}));
const createScanCode = vi.fn(async (_email: string) => ({ code: 'S'.repeat(43), expiresAt: new Date(1_900_000_000_000) }));
vi.mock('$lib/server/native-auth', () => ({ createScanCode }));
vi.mock('$lib/server/access', () => ({ getOwnerEmails: () => ['owner@example.test'] }));
vi.mock('$lib/server/access-requests', () => ({ submitAccessRequest: async () => ({ status: 'ok' }) }));
vi.mock('$lib/server/invites', () => ({ INVITE_COOKIE: 'sr_invite' }));
vi.mock('$lib/server/owner', () => ({ isOwnerRequest: async () => false }));
vi.mock('$lib/server/public-request-rate-limit', () => ({ clientIp: () => '203.0.113.9', hashIp: () => 'h' }));
vi.mock('$lib/server/viewer', () => ({
  viewerOf: async () => ({ kind: 'member', principalId: 'u_1', email: 'sam@example.test', grants: new Set(['family:circle']) }),
  viewerHolds: (v: { grants: Set<string> }, p: string) => v.grants.has(p),
}));
const users = vi.fn(async () => [{ email: 'sam@example.test', name: 'Sam', sharing: true }]);
vi.mock('$lib/home/presence/companion', () => ({ loadCompanionUsers: () => users() }));
vi.mock('$lib/home/presence/companion-accounts', () => ({
  pilotFailureText: () => 'x',
  pilotPairCode: vi.fn(),
  setPilotSharing: vi.fn(),
  upsertPilotUser: vi.fn(),
}));
const deleteMyUploadedData = vi.fn(async (_email: string, _confirm: unknown) => ({
  ok: true as const,
  pilot: { health: 1 },
  trailRows: 4,
}));
vi.mock('$lib/home/presence/delete-my-data', () => ({ deleteMyUploadedData }));

const { load, actions } = await import('./+page.server');

function event(email: string | null, form: Record<string, string> = {}) {
  const body = new FormData();
  for (const [k, v] of Object.entries(form)) body.set(k, v);
  return {
    locals: { auth: async () => (email ? { user: { email, name: 'Sam Example' } } : null) } as unknown as App.Locals,
    getClientAddress: () => '203.0.113.9',
    cookies: { delete: vi.fn() },
    request: new Request('https://strangeramblings.com/welcome?/deleteData', { method: 'POST', body }),
    url: new URL('https://strangeramblings.com/welcome'),
  } as never;
}

beforeEach(() => {
  deleteMyUploadedData.mockClear();
  users.mockClear();
  createScanCode.mockClear();
  qrPayloads.length = 0;
});

describe('/welcome — Pair your phone', () => {
  it('shows ONE code, minted for the person signed in here', async () => {
    const r = await actions.pair(event('Sam@Example.test'));
    expect(createScanCode).toHaveBeenCalledWith('sam@example.test');
    expect(qrPayloads).toHaveLength(1);
    expect(JSON.parse(qrPayloads[0])).toEqual({
      type: 'sr-pair',
      version: 1,
      server: 'https://strangeramblings.com',
      code: 'S'.repeat(43),
    });
    expect(r).toMatchObject({ pair: { code: 'S'.repeat(43), expiresAt: 1_900_000_000_000 } });
  });

  it("shows a signed-out visitor nobody's code: no secret in it", async () => {
    const r = await load(event(null));
    expect(r).toMatchObject({ signedIn: false, appQr: 'data:image/png;base64,' });
    expect(JSON.parse(qrPayloads.at(-1)!)).toEqual({ type: 'sr-pair', version: 1, server: 'https://strangeramblings.com' });
    expect(createScanCode).not.toHaveBeenCalled();
  });

  it('mints nothing for a signed-out visitor', async () => {
    expect(await actions.pair(event(null))).toMatchObject({ status: 401 });
    expect(createScanCode).not.toHaveBeenCalled();
  });
});

describe('/welcome — Your data', () => {
  it('offers the section only to someone with an app account', async () => {
    expect(await load(event('sam@example.test'))).toMatchObject({ signedIn: true, hasAppAccount: true });
    users.mockResolvedValueOnce([]);
    expect(await load(event('sam@example.test'))).toMatchObject({ signedIn: true, hasAppAccount: false });
    expect(await load(event(null))).toMatchObject({ signedIn: false, testflight: false });
  });

  it("deletes for the session's email — an email in the form is ignored", async () => {
    const r = await actions.deleteData(event('Sam@Example.test', { confirm: 'delete', email: 'owner@example.test' }));
    expect(deleteMyUploadedData).toHaveBeenCalledWith('sam@example.test', 'delete');
    expect(r).toEqual({ deleted: { trailRows: 4, pilot: { health: 1 } } });
  });

  it('refuses a signed-out visitor without calling anything', async () => {
    const r = await actions.deleteData(event(null, { confirm: 'delete' }));
    expect(r).toMatchObject({ status: 401 });
    expect(deleteMyUploadedData).not.toHaveBeenCalled();
  });

  it('passes a refusal back as a failure with its words', async () => {
    deleteMyUploadedData.mockResolvedValueOnce({ ok: false, status: 400, error: 'Type “delete” to confirm.' } as never);
    const r = await actions.deleteData(event('sam@example.test', { confirm: 'nope' }));
    expect(r).toMatchObject({ status: 400, data: { deleteError: 'Type “delete” to confirm.' } });
  });
});
