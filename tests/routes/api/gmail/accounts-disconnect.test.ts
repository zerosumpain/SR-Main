import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * DELETE /api/gmail/accounts — disconnecting a mailbox hands SR-Jkai-Core a
 * `mail-purge` job, in the same transaction as the delete, so /privacy's
 * "disconnecting deletes what was taken from it" is true.
 */

let deleted: Array<{ id: number; email: string; principalId: string }> = [];
const inserts: Array<{ table: unknown; values: unknown }> = [];
let transactions = 0;

vi.mock('$lib/db', () => {
  const tx = {
    delete: () => ({ where: () => ({ returning: async () => deleted }) }),
    insert: (table: unknown) => ({
      values: async (values: unknown) => {
        inserts.push({ table, values });
      },
    }),
  };
  return {
    db: {
      transaction: async (fn: (t: typeof tx) => Promise<unknown>) => {
        transactions++;
        return fn(tx);
      },
    },
  };
});
vi.mock('$lib/integrations/gmail/owner-accounts', () => ({ ownerGmailWhere: (x: unknown) => x }));

async function del(query: string) {
  const mod = await import('../../../../src/routes/api/gmail/accounts/+server');
  const url = new URL(`http://x/api/gmail/accounts${query}`);
  return (mod.DELETE as (e: unknown) => Promise<Response>)({ url, request: new Request(url, { method: 'DELETE' }) });
}

beforeEach(() => {
  deleted = [];
  inserts.length = 0;
  transactions = 0;
});

describe('DELETE /api/gmail/accounts', () => {
  it('400s without an id and touches nothing', async () => {
    expect((await del('')).status).toBe(400);
    expect(transactions).toBe(0);
  });

  it('enqueues a mail-purge for the deleted account, in its own space', async () => {
    const { driveIntelOutbox } = await import('$lib/db/schema');
    deleted = [{ id: 7, email: 'someone@example.com', principalId: 'owner' }];
    const res = await del('?id=7');
    expect(res.status).toBe(200);
    expect(inserts).toEqual([
      {
        table: driveIntelOutbox,
        values: { kind: 'mail-purge', ref: '7', payload: { email: 'someone@example.com', spaceId: 'owner' } },
      },
    ]);
  });

  it('enqueues nothing when no owner account matched', async () => {
    const res = await del('?id=99');
    expect(res.status).toBe(200);
    expect(transactions).toBe(1);
    expect(inserts).toEqual([]);
  });
});
