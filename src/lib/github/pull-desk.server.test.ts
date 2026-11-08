import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  closePull,
  consequenceOf,
  markSuperseded,
  mergePull,
  mergeVerdict,
  parseRepo,
  revertPull,
  touchesSchema,
  type DeskPull,
} from './pull-desk.server';

const HEAD = 'a'.repeat(40);

function rawPull(over: Record<string, unknown> = {}) {
  return {
    id: 'PR_node',
    state: 'OPEN',
    number: 7,
    title: 'Add a thing',
    url: 'https://github.com/zerosumpain/SR-Main/pull/7',
    isDraft: false,
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    mergedAt: null,
    author: { login: 'zerosumpain' },
    repository: { nameWithOwner: 'zerosumpain/SR-Main' },
    headRefName: 'feat/thing',
    headRefOid: HEAD,
    baseRefName: 'master',
    headRepository: { owner: { login: 'zerosumpain' } },
    mergeCommit: null,
    additions: 3,
    deletions: 1,
    changedFiles: 1,
    mergeable: 'MERGEABLE',
    body: 'why',
    files: { nodes: [{ path: 'src/a.ts', additions: 3, deletions: 1 }] },
    commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS', contexts: { nodes: [
      { __typename: 'CheckRun', name: 'Gate', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: null },
    ] } } } }] },
    ...over,
  };
}

/** A fake GitHub: GraphQL answers with `pull`, REST by method + path. */
function github(pull: Record<string, unknown>, rest: Record<string, () => Response> = {}) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith('/graphql')) {
      const q = JSON.parse(String(init?.body)).query as string;
      if (q.includes('revertPullRequest'))
        return Response.json({ data: { revertPullRequest: { revertPullRequest: { number: 99, url: 'https://github.com/zerosumpain/SR-Main/pull/99' } } } });
      return Response.json({ data: { repository: { pullRequest: pull } } });
    }
    const key = `${init?.method ?? 'GET'} ${u.replace('https://api.github.com', '').split('?')[0]}`;
    if (key.includes('/actions/runs')) return (rest['runs'] ?? (() => Response.json({ total_count: 0 })))();
    const handler = rest[key];
    return handler ? handler() : new Response('{}', { status: 200 });
  });
}

const calls = (f: ReturnType<typeof github>) => f.mock.calls.map(([u, i]) => `${(i as RequestInit)?.method ?? 'GET'} ${String(u)}`);

describe('pull desk scope', () => {
  it('only names the owner’s own repositories', () => {
    expect(parseRepo('zerosumpain/SR-Main')?.slug).toBe('zerosumpain/SR-Main');
    expect(parseRepo('someone/SR-Main')).toBeNull();
    expect(parseRepo('zerosumpain/..')).toBeNull();
    expect(parseRepo('zerosumpain/SR-Main/../x')).toBeNull();
    expect(parseRepo(42)).toBeNull();
  });

  it('says what a merge sets in motion', () => {
    expect(consequenceOf('zerosumpain/SR-Main', 'master')).toContain('deploys');
    expect(consequenceOf('zerosumpain/SR-AppleApp', 'main')).toContain('TestFlight');
    expect(consequenceOf('zerosumpain/SR-Infra', 'main')).toContain('main');
  });

  it('notices schema paths', () => {
    expect(touchesSchema(['src/lib/db/schema.ts'])).toBe(true);
    expect(touchesSchema(['drizzle/0001.sql'])).toBe(true);
    expect(touchesSchema(['src/routes/x/+page.svelte'])).toBe(false);
  });
});

describe('merge verdict', () => {
  const base = { isDraft: false, mergeable: 'MERGEABLE' as const, checkState: 'SUCCESS' as const, updatedAt: '2026-11-01T00:00:00Z', supersededBy: null };
  it('is ready only when green, clean and not a draft', () => {
    expect(mergeVerdict(base).ready).toBe(true);
    expect(mergeVerdict({ ...base, isDraft: true }).ready).toBe(false);
    expect(mergeVerdict({ ...base, checkState: 'FAILURE' }).reason).toBe('Checks failed.');
    expect(mergeVerdict({ ...base, checkState: 'PENDING' }).reason).toContain('running');
    expect(mergeVerdict({ ...base, mergeable: 'CONFLICTING' }).ready).toBe(false);
    expect(mergeVerdict({ ...base, supersededBy: 9 }).reason).toContain('#9');
  });
  it('does not read "no checks yet" on a fresh push as a pass', () => {
    const now = Date.parse('2026-11-01T00:05:00Z');
    expect(mergeVerdict({ ...base, checkState: null }, now).ready).toBe(false);
    expect(mergeVerdict({ ...base, checkState: null }, now + 3600_000).ready).toBe(true);
  });
});

describe('superseded bumps', () => {
  it('marks older automated bumps of the same package', () => {
    const p = (number: number, branch: string, repo = 'zerosumpain/SR-Main') => ({ number, branch, repo, supersededBy: null }) as unknown as DeskPull;
    const list = [p(1303, 'deps/codex-sdk-0.166.0'), p(1233, 'deps/codex-sdk-0.164.0'), p(1270, 'voice/card'), p(5, 'deps/codex-sdk-0.1.0', 'zerosumpain/Other')];
    markSuperseded(list);
    expect(list.map((x) => x.supersededBy)).toEqual([null, 1303, null, null]);
  });
});

describe('actions', () => {
  beforeEach(() => {
    process.env.GITHUB_API_TOKEN = 'test-token-not-real';
    delete process.env.GITHUB_DESK_API;
  });

  it('refuses another owner without calling GitHub', async () => {
    const f = github(rawPull());
    expect(await mergePull({ repo: 'evil/SR-Main', number: 7, sha: HEAD }, f)).toMatchObject({ ok: false, status: 400 });
    expect(f).not.toHaveBeenCalled();
  });

  it('squash-merges with the head sha, then deletes the branch', async () => {
    const f = github(rawPull(), { 'PUT /repos/zerosumpain/SR-Main/pulls/7/merge': () => Response.json({ sha: 'b'.repeat(40) }) });
    const r = await mergePull({ repo: 'zerosumpain/SR-Main', number: 7, sha: HEAD }, f);
    expect(r).toMatchObject({ ok: true });
    const put = f.mock.calls.find(([u]) => String(u).endsWith('/pulls/7/merge'))!;
    expect(JSON.parse(String((put[1] as RequestInit).body))).toMatchObject({ merge_method: 'squash', sha: HEAD });
    expect(calls(f)).toContain('DELETE https://api.github.com/repos/zerosumpain/SR-Main/git/refs/heads/feat%2Fthing');
  });

  it('refuses when the head moved since the page loaded', async () => {
    const f = github(rawPull());
    const r = await mergePull({ repo: 'zerosumpain/SR-Main', number: 7, sha: 'c'.repeat(40) }, f);
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(calls(f).some((c) => c.startsWith('PUT'))).toBe(false);
  });

  it('refuses red checks even when the page offered Merge', async () => {
    const red = rawPull({ commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE', contexts: { nodes: [] } } } }] } });
    const r = await mergePull({ repo: 'zerosumpain/SR-Main', number: 7, sha: HEAD }, github(red));
    expect(r).toMatchObject({ ok: false, message: 'Checks failed.' });
  });

  it('refuses while a release is already waiting, so it is not evicted', async () => {
    const f = github(rawPull(), { runs: () => Response.json({ total_count: 1 }) });
    const r = await mergePull({ repo: 'zerosumpain/SR-Main', number: 7, sha: HEAD }, f);
    expect(r).toMatchObject({ ok: false, status: 409 });
    expect(!r.ok && r.message).toContain('waiting');
    expect(calls(f).some((c) => c.startsWith('PUT'))).toBe(false);
  });

  it('reports GitHub refusing the merge, with the token redacted', async () => {
    const f = github(rawPull(), {
      'PUT /repos/zerosumpain/SR-Main/pulls/7/merge': () => Response.json({ message: 'Base branch was modified test-token-not-real' }, { status: 405 }),
    });
    const r = await mergePull({ repo: 'zerosumpain/SR-Main', number: 7, sha: HEAD }, f);
    expect(r).toMatchObject({ ok: false, status: 502 });
    expect(!r.ok && r.message).not.toContain('test-token-not-real');
  });

  it('closes an open PR only', async () => {
    expect(await closePull({ repo: 'zerosumpain/SR-Main', number: 7 }, github(rawPull()))).toMatchObject({ ok: true });
    expect(await closePull({ repo: 'zerosumpain/SR-Main', number: 7 }, github(rawPull({ state: 'CLOSED' })))).toMatchObject({ ok: false, status: 409 });
  });

  it('reverts a merged PR by opening a new one, and flags schema', async () => {
    const merged = rawPull({ state: 'MERGED', mergedAt: '2026-11-02T00:00:00Z', files: { nodes: [{ path: 'src/lib/db/schema.ts', additions: 1, deletions: 0 }] } });
    const f = github(merged);
    const r = await revertPull({ repo: 'zerosumpain/SR-Main', number: 7 }, f);
    expect(r).toMatchObject({ ok: true, number: 99 });
    expect(r.ok && r.message).toContain('schema');
    const mutation = JSON.parse(String((f.mock.calls.at(-1)![1] as RequestInit).body));
    expect(mutation.variables.title).toBe('Revert "Add a thing"');
    expect(mutation.variables.body).toContain('Schema');
  });

  it('will not revert something never merged', async () => {
    expect(await revertPull({ repo: 'zerosumpain/SR-Main', number: 7 }, github(rawPull()))).toMatchObject({ ok: false, status: 409 });
  });

  it('says so when there is no token', async () => {
    for (const k of ['GITHUB_API_TOKEN', 'FORGE_GITHUB_TOKEN', 'GITHUB_PAT', 'GITHUB_TOKEN', 'GH_TOKEN']) delete process.env[k];
    const f = github(rawPull());
    expect(await mergePull({ repo: 'zerosumpain/SR-Main', number: 7, sha: HEAD }, f)).toMatchObject({ ok: false, status: 503 });
    expect(f).not.toHaveBeenCalled();
  });
});
