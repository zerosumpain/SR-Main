import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkSharePassword } from './share-password';

/**
 * What a share row keeps about its password: the scrypt verifier when the
 * owner set one, null otherwise, and what the access decision reads back. The
 * database is a queue of answers; inserted values are captured.
 */

const state = vi.hoisted(() => ({
  queue: [] as unknown[],
  inserted: [] as Record<string, unknown>[],
  sets: [] as Record<string, unknown>[],
  recorded: [] as [string, unknown][],
  statsFail: false,
}));

vi.mock('$lib/db', () => {
  const chain = (): object => {
    const proxy: object = new Proxy(
      {},
      {
        get(_, key) {
          if (key === 'then') {
            const next = state.queue.shift() ?? [];
            return (res: (v: unknown) => unknown) => Promise.resolve(next).then(res);
          }
          if (key === 'catch') return () => proxy;
          if (key === 'values') return (v: Record<string, unknown>) => (state.inserted.push(v), proxy);
          if (key === 'set') return (v: Record<string, unknown>) => (state.sets.push(v), proxy);
          return () => proxy;
        },
      },
    );
    return proxy;
  };
  return { db: { select: chain, insert: chain, update: chain } };
});

vi.mock('./share-visits', () => ({
  recordShareVisit: async (id: string, visit: unknown) => {
    state.recorded.push([id, visit]);
  },
  shareVisitStats: async () => {
    if (state.statsFail) throw new Error('permission denied for table project_share_visit');
    return new Map();
  },
}));

const { createShare, listSharesWithVisits, validateProjectShare } = await import('./shares');

beforeEach(() => {
  state.queue.length = 0;
  state.inserted.length = 0;
  state.sets.length = 0;
  state.recorded.length = 0;
  state.statsFail = false;
});

describe('share link rows', () => {
  it('a link minted without a password stores no verifier', async () => {
    state.queue.push([{ id: 's1' }]);
    const { token } = await createShare({ projectKey: 'spine', createdBy: 'owner' });
    expect(token.length).toBeGreaterThan(40);
    expect(state.inserted[0].passwordHash).toBeNull();

    state.queue.push([{ id: 's2' }]);
    await createShare({ projectKey: 'spine', createdBy: 'owner', password: null });
    expect(state.inserted[1].passwordHash).toBeNull();
  });

  it('a link minted with a password stores only its scrypt verifier', async () => {
    state.queue.push([{ id: 's1' }]);
    await createShare({ projectKey: 'spine', createdBy: 'owner', password: 'open sesame' });
    const stored = state.inserted[0].passwordHash as string;
    expect(stored).toMatch(/^scrypt\$/);
    expect(stored).not.toContain('open sesame');
    expect(await checkSharePassword('open sesame', stored)).toBe(true);
  });

  it('a live link answers with its verifier; no live link answers null', async () => {
    const verifier = 'scrypt$' + 'a'.repeat(22) + '$' + 'b'.repeat(43);
    state.queue.push([{ id: 's1', expiresAt: null, revokedAt: null, passwordHash: verifier }]);
    expect(await validateProjectShare('spine', 't'.repeat(43))).toEqual({ passwordHash: verifier });

    state.queue.push([{ id: 's2', expiresAt: null, revokedAt: null, passwordHash: null }]);
    expect(await validateProjectShare('spine', 't'.repeat(43))).toEqual({ passwordHash: null });

    state.queue.push([{ id: 's3', expiresAt: null, revokedAt: new Date(), passwordHash: null }]);
    expect(await validateProjectShare('spine', 't'.repeat(43))).toBeNull();
    state.queue.push([]);
    expect(await validateProjectShare('spine', 't'.repeat(43))).toBeNull();
    expect(await validateProjectShare('spine', 'short')).toBeNull();
  });

  it('counts every request toward use when the gateway does not say which open a page', async () => {
    const live = { id: 's1', expiresAt: null, revokedAt: null, passwordHash: null };
    for (let i = 0; i < 2; i++) state.queue.push([live]);
    await validateProjectShare('spine', 't'.repeat(43));
    const older = { open: null, visitorHash: null, networkHash: '', agent: null, country: null };
    await validateProjectShare('spine', 't'.repeat(43), older);
    expect(state.sets).toHaveLength(2);
    for (const set of state.sets) expect(set).toHaveProperty('useCount');
    // Nothing to tell visitors apart by: no visitor row.
    expect(state.recorded).toHaveLength(0);
  });

  it('counts only page opens toward use once the gateway says, and records the visitor either way', async () => {
    const live = { id: 's1', expiresAt: null, revokedAt: null, passwordHash: null };
    const visit = { visitorHash: 'h'.repeat(32), networkHash: 'n'.repeat(16), agent: 'Chrome · Windows', country: 'GB' };
    state.queue.push([live], [live]);
    await validateProjectShare('spine', 't'.repeat(43), { ...visit, open: true });
    await validateProjectShare('spine', 't'.repeat(43), { ...visit, open: false });
    expect(state.sets[0]).toHaveProperty('useCount');
    expect(state.sets[0]).toHaveProperty('lastUsedAt');
    expect(state.sets[1]).not.toHaveProperty('useCount');
    expect(state.sets[1]).toHaveProperty('lastUsedAt');
    expect(state.recorded.map(([id, v]) => [id, (v as { open: boolean }).open])).toEqual([
      ['s1', true],
      ['s1', false],
    ]);
  });

  it('a dead link counts nothing and records no one', async () => {
    state.queue.push([{ id: 's1', expiresAt: new Date(Date.now() - 1000), revokedAt: null, passwordHash: null }]);
    const visit = { open: true, visitorHash: 'h'.repeat(32), networkHash: '', agent: null, country: null };
    expect(await validateProjectShare('spine', 't'.repeat(43), visit)).toBeNull();
    expect(state.sets).toHaveLength(0);
    expect(state.recorded).toHaveLength(0);
  });

  it('still lists every link, with its own use count, when the visitor numbers fail', async () => {
    state.statsFail = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    state.queue.push([{ id: 's1', label: null, createdAt: new Date(), expiresAt: null, revokedAt: null, lastUsedAt: null, useCount: 6, hasPassword: false }]);
    const [only] = await listSharesWithVisits('spine');
    expect(only).toMatchObject({ id: 's1', opens: 6, browsers: 0, likelyForwarded: false, visitors: [] });
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
