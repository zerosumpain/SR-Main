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
          return () => proxy;
        },
      },
    );
    return proxy;
  };
  return { db: { select: chain, insert: chain, update: chain } };
});

const { createShare, validateProjectShare } = await import('./shares');

beforeEach(() => {
  state.queue.length = 0;
  state.inserted.length = 0;
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
    state.queue.push([{ id: 's1', expiresAt: null, revokedAt: null, passwordHash: 'sha256$' + 'a'.repeat(64) }]);
    expect(await validateProjectShare('spine', 't'.repeat(43))).toEqual({ passwordHash: 'sha256$' + 'a'.repeat(64) });

    state.queue.push([{ id: 's2', expiresAt: null, revokedAt: null, passwordHash: null }]);
    expect(await validateProjectShare('spine', 't'.repeat(43))).toEqual({ passwordHash: null });

    state.queue.push([{ id: 's3', expiresAt: null, revokedAt: new Date(), passwordHash: null }]);
    expect(await validateProjectShare('spine', 't'.repeat(43))).toBeNull();
    state.queue.push([]);
    expect(await validateProjectShare('spine', 't'.repeat(43))).toBeNull();
    expect(await validateProjectShare('spine', 'short')).toBeNull();
  });
});
