import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensurePiCodexAuth, isCodexAuthRejection, jwtExpiryMs, mergeRefreshed, refreshReason } from './pi-codex-auth';
import { isTransientProviderFailure } from './transient-failure';
import { CODEX_SIGNIN_RENEWED } from './pi-runner';

const jwt = (expSeconds: number) => `h.${Buffer.from(JSON.stringify({ exp: expSeconds })).toString('base64url')}.s`;
const NOW = Date.parse('2026-10-01T07:30:00Z');
const inDays = (d: number) => Math.floor((NOW + d * 86_400_000) / 1000);

describe('refreshReason', () => {
  it('trusts the token claim, not the stored expires field', () => {
    // pi's own field says a week; the claim says ten minutes.
    const entry = { access: jwt(Math.floor(NOW / 1000) + 600), refresh: 'r', expires: NOW + 7 * 86_400_000 };
    expect(refreshReason(entry, NOW)).toBe('expiring');
    expect(refreshReason({ ...entry, access: jwt(inDays(6)) }, NOW)).toBeNull();
  });

  it('refreshes a refused token only while it is still the one on disk', () => {
    // 2026-10-01: refused as expired with six days left on the claim.
    const entry = { access: jwt(inDays(6)), refresh: 'r' };
    expect(refreshReason(entry, NOW, entry.access)).toBe('rejected');
    expect(refreshReason(entry, NOW, 'an older token someone already replaced')).toBeNull();
  });

  it('does nothing without a refresh token to spend', () => {
    expect(refreshReason({ access: jwt(1) }, NOW)).toBeNull();
    expect(refreshReason(undefined, NOW)).toBeNull();
  });
});

describe('mergeRefreshed', () => {
  it('keeps every other field and never blanks the refresh token', () => {
    const entry = { type: 'oauth', access: 'old', refresh: 'keep-me', accountId: 'acct', expires: 1 };
    const next = mergeRefreshed(entry, { access_token: jwt(inDays(10)) }, NOW);
    expect(next).toMatchObject({ type: 'oauth', accountId: 'acct', refresh: 'keep-me' });
    // pi is told slightly less than the server will allow.
    expect(next.expires).toBe(jwtExpiryMs(next.access as string)! - 5 * 60_000);
    expect(mergeRefreshed(entry, { access_token: jwt(inDays(10)), refresh_token: 'rotated' }, NOW).refresh).toBe('rotated');
    expect(() => mergeRefreshed(entry, {}, NOW)).toThrow();
  });
});

describe('isCodexAuthRejection', () => {
  it('recognises the refusals pi surfaces', () => {
    expect(isCodexAuthRejection('Provided authentication token is expired.')).toBe(true);
    expect(isCodexAuthRejection('codex responses 401')).toBe(true);
    expect(isCodexAuthRejection('anything', 401)).toBe(true);
    expect(isCodexAuthRejection('server_is_overloaded')).toBe(false);
  });

  it('is transient only once the sign-in has been renewed', () => {
    const refused = { kind: 'provider_error', message: 'Provided authentication token is expired.' };
    expect(isTransientProviderFailure(refused)).toBe(false);
    expect(isTransientProviderFailure({ ...refused, message: `${refused.message} ${CODEX_SIGNIN_RENEWED}` })).toBe(true);
  });
});

describe('ensurePiCodexAuth', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pi-auth-'));
    vi.stubEnv('PI_CODING_AGENT_DIR', dir);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    await rm(dir, { recursive: true, force: true });
  });
  const write = (entry: Record<string, unknown>) => writeFile(join(dir, 'auth.json'), JSON.stringify({ other: { keep: true }, 'openai-codex': entry }), { mode: 0o600 });
  const read = async () => JSON.parse(await readFile(join(dir, 'auth.json'), 'utf8'));

  it('renews a refused token, atomically, leaving other providers alone', async () => {
    const refused = jwt(Math.floor(Date.now() / 1000) + 6 * 86_400);
    await write({ type: 'oauth', access: refused, refresh: 'r1', accountId: 'acct' });
    const fresh = jwt(Math.floor(Date.now() / 1000) + 10 * 86_400);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ access_token: fresh, refresh_token: 'r2' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await ensurePiCodexAuth({ rejectedAccess: refused });
    expect(result).toMatchObject({ access: fresh, refreshed: 'rejected' });
    const saved = await read();
    expect(saved.other).toEqual({ keep: true });
    expect(saved['openai-codex']).toMatchObject({ access: fresh, refresh: 'r2', accountId: 'acct' });
    expect((await stat(join(dir, 'auth.json'))).mode & 0o777).toBe(0o600);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(JSON.parse(init.body)).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'r1' });
  });

  it('leaves the file untouched when the refresh fails', async () => {
    const refused = jwt(Math.floor(Date.now() / 1000) + 6 * 86_400);
    await write({ access: refused, refresh: 'r1' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('invalid_grant', { status: 400 })));
    const result = await ensurePiCodexAuth({ rejectedAccess: refused });
    expect(result.refreshed).toBeNull();
    expect(result.error).toContain('400');
    expect((await read())['openai-codex']).toEqual({ access: refused, refresh: 'r1' });
  });

  it('never throws on a missing file', async () => {
    await expect(ensurePiCodexAuth()).resolves.toMatchObject({ access: null, refreshed: null });
  });
});
