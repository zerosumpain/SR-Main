import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Workflow file nodes run as the owner. A member's files live under
 * members/<id>/ in the same table (see $lib/drive/namespace): the nodes must not
 * list them, and must refuse to read, write or delete a name under that root —
 * a write there would otherwise mint an owner row inside a member's folder.
 *
 * A real drizzle query builder over a driver that only records the SQL.
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
vi.mock('$lib/file-store/storage', () => ({
  readBuffer: vi.fn(),
  saveBuffer: vi.fn(),
  appendBuffer: vi.fn(),
  deleteFile: vi.fn(),
  newDiskPath: vi.fn(() => '/tmp/never'),
}));
vi.mock('$lib/jkai/intel/auto-extract', () => ({ queueDerivedIntelDelete: vi.fn() }));
vi.mock('$lib/jkai/extract', () => ({
  extractText: vi.fn(),
  synthesize: vi.fn(async () => ({ buffer: Buffer.from('x'), mimeType: 'text/csv', suggestedExtension: 'csv' })),
  ExtractError: class extends Error {},
}));

import { fileStoreExecutor } from '$lib/workflows/nodes/file-store';
import {
  fileDeleteExecutor,
  fileListExecutor,
  fileReadExecutor,
  fileWriteExecutor,
} from '$lib/workflows/nodes/file-ops';
import { fileBuildExecutor } from '$lib/workflows/nodes/file-build';
import { fileExtractExecutor } from '$lib/workflows/nodes/file-extract';
import { fileTextExtractExecutor } from '$lib/workflows/nodes/file-text-extract';
import type { ExecutionContext } from '$lib/workflows/types';

const ctx = {} as ExecutionContext;
const MEMBER = 'members/u_x/a.txt';
const MEMBERS_AREA = /members' area of the drive/;

function filtersToOwner(q: { sql: string; params: unknown[] }): boolean {
  const m = q.sql.match(/"workflow_files"\."principal_id" = \$(\d+)/);
  return !!m && q.params[Number(m[1]) - 1] === 'owner';
}

beforeEach(() => {
  queries.length = 0;
});

describe('a name under members/ is refused before any query', () => {
  it.each([
    ['file-store read', () => fileStoreExecutor.execute({}, { operation: 'read', fileName: MEMBER }, ctx)],
    ['file-store write', () => fileStoreExecutor.execute({ content: 'x' }, { operation: 'write', fileName: MEMBER }, ctx)],
    ['file-store append', () => fileStoreExecutor.execute({ content: 'x' }, { operation: 'append', fileName: MEMBER }, ctx)],
    ['file-store delete', () => fileStoreExecutor.execute({}, { operation: 'delete', fileName: MEMBER }, ctx)],
    ['file-read', () => fileReadExecutor.execute({}, { fileName: MEMBER }, ctx)],
    ['file-write', () => fileWriteExecutor.execute({ content: 'x' }, { fileName: MEMBER }, ctx)],
    ['file-delete', () => fileDeleteExecutor.execute({}, { fileName: MEMBER }, ctx)],
    [
      'file-build persist',
      () =>
        fileBuildExecutor.execute(
          { content: 'a,b' },
          { format: 'csv', source: 'csv', persist: true, outputName: MEMBER },
          ctx,
        ),
    ],
    [
      'file-build persist, leading slash',
      () =>
        fileBuildExecutor.execute(
          { content: 'a,b' },
          { format: 'csv', source: 'csv', persist: true, outputName: `/${MEMBER}` },
          ctx,
        ),
    ],
  ])('%s', async (_label, run) => {
    await expect(run()).rejects.toThrow(MEMBERS_AREA);
    expect(queries).toEqual([]);
  });
});

describe("listing and lookups see the owner's files only", () => {
  it('file-store list, with and without a prefix', async () => {
    await fileStoreExecutor.execute({}, { operation: 'list' }, ctx);
    await fileStoreExecutor.execute({}, { operation: 'list', prefix: 'members/' }, ctx);
    expect(queries).toHaveLength(2);
    for (const q of queries) expect(filtersToOwner(q), q.sql).toBe(true);
  });

  it('file-list, with and without a prefix', async () => {
    await fileListExecutor.execute({}, {}, ctx);
    await fileListExecutor.execute({}, { prefix: 'members/' }, ctx);
    expect(queries).toHaveLength(2);
    for (const q of queries) expect(filtersToOwner(q), q.sql).toBe(true);
  });

  it('a read by name looks only among the owner\'s files', async () => {
    await expect(fileReadExecutor.execute({}, { fileName: 'notes/a.txt' }, ctx)).rejects.toThrow(/not found/);
    await expect(fileTextExtractExecutor.execute({}, { fileName: 'notes/a.txt' }, ctx)).rejects.toThrow(/not found/);
    await expect(
      fileExtractExecutor.execute({}, { mode: 'extract', fileName: 'notes/a.txt' }, ctx),
    ).rejects.toThrow(/not found/);
    expect(queries).toHaveLength(3);
    for (const q of queries) expect(filtersToOwner(q), q.sql).toBe(true);
  });

  it('an owner write looks up and creates among the owner\'s files', async () => {
    // The recording driver's RETURNING is empty, so the node fails after the
    // insert; what matters is the lookup before it, and that the insert happened.
    await fileWriteExecutor.execute({ content: 'x' }, { fileName: 'notes/new.txt' }, ctx).catch(() => {});
    expect(filtersToOwner(queries[0]), queries[0].sql).toBe(true);
    expect(queries[1]?.sql).toMatch(/^insert into "workflow_files"/);
  });
});
