// Linked TVs: a waiting TV shows a code, the owner approves it, the stream
// hands over a token that verifies; revoked and forged tokens do not.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ env: { AUTH_SECRET: 'test-secret-for-tvs' } as Record<string, string> }));
vi.mock('$env/dynamic/private', () => ({ env: h.env }));
vi.mock('$lib/datastore', () => ({
  DatastoreError: class extends Error {},
  ensureCollection: vi.fn(),
  getRecordByKey: vi.fn(),
  queryRecords: vi.fn(),
  upsertRecord: vi.fn(),
}));

import { _resetTvLinks, _setTvStore, approveLink, cleanTvName, linkStream, listTvs, memoryTvStore, revokeTv, tvFromToken } from './tv-devices.server';
import { issueTvToken } from './party';

type Frame = { type: string; [k: string]: unknown };

function reader(res: Response) {
  const r = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const queue: Frame[] = [];
  return {
    async next(): Promise<Frame> {
      while (!queue.length) {
        const { value, done } = await r.read();
        if (done) throw new Error('stream ended');
        buffer += decoder.decode(value, { stream: true });
        let i: number;
        while ((i = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, i);
          buffer = buffer.slice(i + 2);
          const line = block.split('\n').find((l) => l.startsWith('data: '));
          if (line) queue.push(JSON.parse(line.slice(6)) as Frame);
        }
      }
      return queue.shift()!;
    },
    async done(): Promise<boolean> {
      const { done } = await r.read();
      return done;
    },
    cancel: () => r.cancel(),
  };
}

beforeEach(() => _setTvStore(memoryTvStore()));
afterEach(() => {
  _resetTvLinks();
  _setTvStore(null);
});

describe('linking a TV', () => {
  it('shows a code, and an approved code hands the TV a token that verifies', async () => {
    const stream = reader(linkStream());
    const first = await stream.next();
    expect(first.type).toBe('code');
    const row = await approveLink(first.code, ' Living room  Bravia ');
    expect(row.name).toBe('Living room Bravia');
    const linked = await stream.next();
    expect(linked.type).toBe('linked');
    expect(await stream.done()).toBe(true);
    const tv = await tvFromToken(linked.token as string);
    expect(tv?.id).toBe(row.id);
    expect((await listTvs()).map((t) => t.id)).toEqual([row.id]);
  });

  it('refuses a code nobody is showing, and a malformed one', async () => {
    await expect(approveLink('ZZZZ', 'TV')).rejects.toMatchObject({ status: 404 });
    await expect(approveLink('no', 'TV')).rejects.toMatchObject({ status: 400 });
  });

  it('a code works once', async () => {
    const stream = reader(linkStream());
    const { code } = await stream.next();
    await approveLink(code, 'TV');
    await expect(approveLink(code, 'TV')).rejects.toMatchObject({ status: 404 });
  });
});

describe('verifying a TV', () => {
  it('a revoked TV stops at once', async () => {
    const stream = reader(linkStream());
    const { code } = await stream.next();
    await approveLink(code, 'TV');
    const { token } = (await stream.next()) as unknown as { token: string };
    const tv = await tvFromToken(token);
    expect(tv).not.toBeNull();
    await revokeTv(tv!.id);
    expect(await tvFromToken(token)).toBeNull();
  });

  it('a well-signed token for a TV that was never linked is refused', async () => {
    const { token } = issueTvToken('tv_0123456789ab', h.env.AUTH_SECRET);
    expect(await tvFromToken(token)).toBeNull();
  });

  it('a forged token is refused', async () => {
    expect(await tvFromToken('tv_0123456789ab.9999999999.' + 'a'.repeat(24) + '.' + 'b'.repeat(64))).toBeNull();
    expect(await tvFromToken(undefined)).toBeNull();
  });

  it('names are tidied and never empty', () => {
    expect(cleanTvName('<b>Den</b>')).toBe('b Den /b');
    expect(cleanTvName('   ')).toBe('TV');
    expect(cleanTvName(undefined)).toBe('TV');
  });
});
