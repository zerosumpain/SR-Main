import { afterEach, describe, expect, it, vi } from 'vitest';
import { on } from '$lib/events/platform-bus';
import { openPullRequest, repoSlugFromUrl } from './pr';

// The bus writes each event down; nothing here has a database.
vi.mock('$lib/events/store', () => ({ recordPlatformEvent: async () => true }));

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('repoSlugFromUrl', () => {
  it('reads SSH and HTTPS remotes', () => {
    expect(repoSlugFromUrl('git@github.com:zerosumpain/SR-Main.git')).toBe('zerosumpain/SR-Main');
    expect(repoSlugFromUrl('https://github.com/o/brass-and-rails.git')).toBe('o/brass-and-rails');
    expect(repoSlugFromUrl('https://github.com/o/r')).toBe('o/r');
  });
});

describe('openPullRequest', () => {
  it('posts to the given repo with the given base, head and draft flag', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(201, { html_url: 'https://github.com/o/r/pull/7', number: 7 }));
    vi.stubGlobal('fetch', fetchMock);
    const said: unknown[] = [];
    const off = on('pull.opened', (e) => said.push(e.payload));
    const pr = await openPullRequest({ repo: 'o/r', head: 'agent/x', base: 'main', title: 't', body: 'b', draft: true, token: 'tok', userAgent: 'ua' });
    off();
    expect(pr).toEqual({ number: 7, url: 'https://github.com/o/r/pull/7', reused: false });
    // The bus hears a pull request the site opened: which one, not its body or the token.
    expect(said).toEqual([{ repo: 'o/r', number: 7, title: 't' }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/o/r/pulls');
    expect(JSON.parse(init.body)).toMatchObject({ head: 'agent/x', base: 'main', draft: true });
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(init.headers['User-Agent']).toBe('ua');
  });

  it('reuses the open pull request GitHub says already exists for the head', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(422, { message: 'Validation Failed', errors: [{ message: 'A pull request already exists for o:agent/x.' }] }))
      .mockResolvedValueOnce(json(200, [{ html_url: 'https://github.com/o/r/pull/3', number: 3 }]));
    vi.stubGlobal('fetch', fetchMock);
    const said: unknown[] = [];
    const off = on('pull.opened', (e) => said.push(e.payload));
    const pr = await openPullRequest({ repo: 'o/r', head: 'agent/x', base: 'main', title: 't', body: 'b', token: 'tok' });
    off();
    expect(pr).toEqual({ number: 3, url: 'https://github.com/o/r/pull/3', reused: true });
    expect(said).toEqual([]);
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.github.com/repos/o/r/pulls?head=o%3Aagent%2Fx&base=main&state=open');
  });

  it('throws a redacted error when GitHub refuses and nothing exists to reuse', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(new Response('bad creds ghp_ABCDEFGHIJKLMNOPQRSTUVWX', { status: 401 })),
    );
    await expect(openPullRequest({ repo: 'o/r', head: 'h', base: 'b', title: 't', body: 'b', token: 'tok' })).rejects.toThrow(
      /GitHub refused the pull request \(401\): bad creds <redacted>/,
    );
  });

  it('refuses up front with no token', async () => {
    await expect(openPullRequest({ repo: 'o/r', head: 'h', base: 'b', title: 't', body: 'b', token: '' })).rejects.toThrow(/not configured/);
  });
});
