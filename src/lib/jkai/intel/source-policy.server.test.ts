import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A member's drive file (members/<id>/…, see $lib/drive/namespace) must never
 * reach the owner's intel graph. Drive → Intel runs through `spaceForDriveFile`
 * (drive-outbox's file-changed) and `syncSourcePolicy` (policy-resync), so both
 * see the owner's files only. A real drizzle query builder over a driver that
 * records the SQL and answers the workflow_files lookup from `fileRow`.
 */

const queries: Array<{ sql: string; params: unknown[] }> = [];
let fileRow: unknown[] | null = null;

vi.mock('$lib/db', async () => {
  const { drizzle } = await import('drizzle-orm/pg-proxy');
  return {
    db: drizzle(async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      if (sql.includes('from "workflow_files"') && fileRow) return { rows: [fileRow] };
      return { rows: [] };
    }),
  };
});
vi.mock('./cleanup.server', () => ({ cleanupIntelligence: vi.fn() }));

import { spaceForDriveFile, syncSourcePolicy } from './source-policy.server';

beforeEach(() => {
  queries.length = 0;
  fileRow = null;
});

describe('spaceForDriveFile', () => {
  it("answers null for a member's file, so the caller extracts nothing", async () => {
    fileRow = ['members/u_x/a.pdf', 'u_x'];
    expect(await spaceForDriveFile('f-member')).toBeNull();
  });

  it("resolves the owner's file through its folder policy, as before", async () => {
    fileRow = ['notes/a.pdf', 'owner'];
    expect(await spaceForDriveFile('f-owner')).toBe('owner');
  });

  it("reads a file already gone as the owner's, as it always has", async () => {
    expect(await spaceForDriveFile('f-gone')).toBe('owner');
  });
});

describe('syncSourcePolicy', () => {
  it("sweeps the owner's files only", async () => {
    await syncSourcePolicy('');
    const files = queries.find((q) => q.sql.includes('from "workflow_files"'));
    expect(files?.sql).toMatch(/"workflow_files"\."principal_id" = \$1/);
    expect(files?.params).toEqual(['owner']);
  });
});
