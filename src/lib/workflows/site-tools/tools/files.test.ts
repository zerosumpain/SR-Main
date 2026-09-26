import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The agent's file tools are the owner's: a member's files share
 * `workflow_files` (under members/<id>/, see $lib/drive/namespace) and must
 * never be listed or read by them. These run the real handlers against a real
 * drizzle query builder whose driver only records the SQL it is handed.
 */

const queries: Array<{ sql: string; params: unknown[] }> = [];

vi.mock('$lib/db', async () => {
  const { drizzle } = await import('drizzle-orm/pg-proxy');
  return {
    db: drizzle(async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      return { rows: [] };
    }),
  };
});
vi.mock('$lib/file-store/storage', () => ({ readBuffer: vi.fn() }));
vi.mock('$lib/jkai/extract', () => ({
  extractText: vi.fn(),
  kindFromMime: vi.fn(),
  ExtractError: class extends Error {},
}));
vi.mock('$lib/file-index/search', () => ({ searchFiles: vi.fn(async () => []) }));

async function handler(name: string) {
  await import('./files');
  const { tools } = await import('../registry-internal');
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`${name} is not registered`);
  return tool.handler;
}

/** True when the one query recorded filters on principal_id = 'owner'. */
function filtersToOwner(q: { sql: string; params: unknown[] }): boolean {
  const m = q.sql.match(/"workflow_files"\."principal_id" = \$(\d+)/);
  return !!m && q.params[Number(m[1]) - 1] === 'owner';
}

beforeEach(() => {
  queries.length = 0;
});

describe("file_list lists the owner's files only", () => {
  it('without a prefix', async () => {
    const list = await handler('file_list');
    const out = await list({}, undefined as never);
    expect(out.success).toBe(true);
    expect(queries).toHaveLength(1);
    expect(filtersToOwner(queries[0]), queries[0].sql).toBe(true);
  });

  it('with a prefix — including one that names the member root', async () => {
    const list = await handler('file_list');
    await list({ prefix: 'members/' }, undefined as never);
    expect(queries).toHaveLength(1);
    expect(filtersToOwner(queries[0]), queries[0].sql).toBe(true);
    expect(queries[0].params).toContain('members/%');
  });
});

describe("file_read reads the owner's files only", () => {
  it('by id: a member file is not found', async () => {
    const read = await handler('file_read');
    const out = await read({ id: 'member-file-id' }, undefined as never);
    expect(out).toEqual({ success: false, error: 'file not found' });
    expect(filtersToOwner(queries[0]), queries[0].sql).toBe(true);
    expect(queries[0].params).toContain('member-file-id');
  });

  it('by name: a member file is not found', async () => {
    const read = await handler('file_read');
    const out = await read({ name: 'members/u_x/a.pdf' }, undefined as never);
    expect(out).toEqual({ success: false, error: 'file not found' });
    expect(filtersToOwner(queries[0]), queries[0].sql).toBe(true);
  });
});
