import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ userRows: [] as Array<{ id: string }>, throws: false }));

vi.mock('$lib/db', () => {
  const builder: Record<string, unknown> = {};
  builder.from = () => builder;
  builder.where = () => builder;
  builder.limit = () => (h.throws ? Promise.reject(new Error('db down')) : Promise.resolve(h.userRows));
  return { db: { select: () => builder } };
});

import { isUserActive } from './idle';

beforeEach(() => {
  h.userRows = [];
  h.throws = false;
});

describe('isUserActive (idle gate)', () => {
  it('returns true when a recent user message exists', async () => {
    h.userRows = [{ id: 'm1' }];
    expect(await isUserActive()).toBe(true);
  });

  it('returns false when there is no recent user message', async () => {
    expect(await isUserActive(10 * 60_000)).toBe(false);
  });

  it('fails CLOSED — a db error reads as active, so nothing spends budget', async () => {
    h.throws = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await isUserActive()).toBe(true);
  });
});
