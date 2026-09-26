import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { sql, type SQL } from 'drizzle-orm';

type Member = { principalId: string; grants: Set<string> } | null;
const loadMember = vi.fn<(email: string) => Promise<Member>>(async () => null);
vi.mock('$lib/server/grants', () => ({ loadMember: (e: string) => loadMember(e) }));
vi.mock('$lib/server/access', () => ({ isOwnerEmail: (e: string) => e === 'owner@example.test' }));
vi.mock('$lib/db', () => ({ db: {} }));

const { areaAccess, readable, writable, canRead, canWrite, OWNER_ACCESS } = await import('./area-scope');

const col = sql.identifier('principal_id');
const render = (s: SQL) => {
  const { sql: text, params } = new PgDialect().sqlToQuery(s);
  return { sql: text, params };
};
const event = (email: string | null) => ({
  locals: { auth: async () => (email ? { user: { email } } : null) } as unknown as App.Locals,
});
const at = (level: 'self' | 'all' | 'admin') => ({ level, own: 'u_me' }) as const;

describe('areaAccess', () => {
  it('gives the owner, and an owner-grade sessionless lane, everything without a lookup', async () => {
    expect(await areaAccess(event('owner@example.test'), 'research')).toBe(OWNER_ACCESS);
    expect(await areaAccess(event(null), 'research')).toBe(OWNER_ACCESS);
    expect(loadMember).not.toHaveBeenCalled();
  });

  it("gives a member their highest level in the area and their own principal", async () => {
    loadMember.mockResolvedValueOnce({ principalId: 'u_me', grants: new Set(['research:self', 'research:all', 'news:admin']) });
    expect(await areaAccess(event('m@example.test'), 'research')).toEqual({ level: 'all', own: 'u_me' });
  });

  it('refuses a member without the area, and a guest', async () => {
    loadMember.mockResolvedValueOnce({ principalId: 'u_me', grants: new Set(['news:admin']) });
    await expect(areaAccess(event('m2@example.test'), 'research')).rejects.toMatchObject({ status: 403 });
    loadMember.mockResolvedValueOnce(null);
    await expect(areaAccess(event('g@example.test'), 'research')).rejects.toMatchObject({ status: 403 });
  });
});

describe('the row predicates', () => {
  it('owner: no filter', () => {
    expect(render(readable(col, OWNER_ACCESS)).sql).toBe('true');
    expect(render(writable(col, OWNER_ACCESS)).sql).toBe('true');
  });

  it('self: reads own + household, writes own', () => {
    expect(render(readable(col, at('self')))).toEqual({ sql: '"principal_id" in ($1, $2)', params: ['u_me', 'household'] });
    expect(render(writable(col, at('self')))).toEqual({ sql: '"principal_id" = $1', params: ['u_me'] });
  });

  it("all: reads everything but the owner's, writes own", () => {
    expect(render(readable(col, at('all')))).toEqual({ sql: '"principal_id" <> $1', params: ['owner'] });
    expect(render(writable(col, at('all')))).toEqual({ sql: '"principal_id" = $1', params: ['u_me'] });
  });

  it("admin: reads and writes everything but the owner's", () => {
    expect(render(readable(col, at('admin')))).toEqual({ sql: '"principal_id" <> $1', params: ['owner'] });
    expect(render(writable(col, at('admin')))).toEqual({ sql: '"principal_id" <> $1', params: ['owner'] });
  });
});

describe('canRead / canWrite agree with the predicates', () => {
  const rows = ['owner', 'household', 'u_me', 'u_other'];
  const table: Record<string, [string[], string[]]> = {
    self: [['household', 'u_me'], ['u_me']],
    all: [['household', 'u_me', 'u_other'], ['u_me']],
    admin: [['household', 'u_me', 'u_other'], ['household', 'u_me', 'u_other']],
  };
  for (const [level, [reads, writes]] of Object.entries(table)) {
    it(level, () => {
      const a = at(level as 'self');
      expect(rows.filter((r) => canRead(r, a))).toEqual(reads);
      expect(rows.filter((r) => canWrite(r, a))).toEqual(writes);
    });
  }
  it('owner reads and writes every row', () => {
    expect(rows.every((r) => canRead(r, OWNER_ACCESS) && canWrite(r, OWNER_ACCESS))).toBe(true);
  });
});
