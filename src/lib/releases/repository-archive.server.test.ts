import { beforeEach, describe, expect, it, vi } from 'vitest';

const rows: Record<string, unknown> = {};
vi.mock('$lib/db', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => (rows.v ? [{ value: rows.v }] : []) }) }) }),
    insert: () => ({ values: (v: { value: unknown }) => ({ onConflictDoUpdate: async () => { rows.v = v.value; } }) }),
  },
}));

const { archiveRepository, loadArchivedRepositories } = await import('./repository-archive.server');

const list = [
  { id: 'main', name: 'SR-Main', url: 'https://github.com/zerosumpain/SR-Main' },
  { id: 'smashamole', name: 'smashamole', url: 'https://github.com/zerosumpain/smashamole' },
];

describe('archiving a footprint repository', () => {
  beforeEach(() => {
    delete rows.v;
    process.env.GITHUB_API_TOKEN = 'test-token-not-real';
  });

  it('never archives SR-Main or anything off the list, and never calls GitHub for them', async () => {
    const fetcher = vi.fn();
    expect(await archiveRepository('main', list, fetcher)).toMatchObject({ ok: false, status: 400 });
    expect(await archiveRepository('../SR-Main', list, fetcher)).toMatchObject({ ok: false, status: 404 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('archives the listed slug on GitHub and remembers the id', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 }));
    expect(await archiveRepository('smashamole', list, fetcher)).toEqual({ ok: true, id: 'smashamole', name: 'smashamole' });
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/zerosumpain/smashamole');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ archived: true });
    expect([...(await loadArchivedRepositories())]).toEqual(['smashamole']);
  });

  it('reports a GitHub refusal without remembering the id', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ message: 'Resource not accessible by personal access token' }), { status: 403 }));
    const result = await archiveRepository('smashamole', list, fetcher);
    expect(result).toMatchObject({ ok: false, status: 502 });
    expect(!result.ok && result.message).toContain('admin rights');
    expect((await loadArchivedRepositories()).size).toBe(0);
  });
});
