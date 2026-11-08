import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The owner lane of `workflow_files`: every reader and writer here runs as John
 * (agent tools, search, intel, the chat's drive link), so each must filter to `principal_id = 'owner'`. A member's
 * files share the table, under `members/<id>/` (see ./namespace), and an
 * unfiltered listing in any of these would hand them to the owner's agent, his
 * graph.
 *
 * Static on purpose: the failure is a query that is MISSING a clause, which no
 * behavioural test of the existing clauses would notice. A file that stops
 * naming `principalId` has almost certainly dropped the filter.
 */
const OWNER_LANE = [
  'src/lib/tools/tools/files.ts',
  'src/lib/jkai/media/drive-link.ts',
  'src/routes/api/drive/folders/+server.ts',
  'src/lib/file-index/store.ts',
] as const;

describe("the owner lane reads and writes the owner's files only", () => {
  it.each(OWNER_LANE)('%s filters on principalId', (file) => {
    expect(readFileSync(file, 'utf8')).toMatch(/principalId/);
  });

  it('search matches owner files only (raw SQL, so it names the column)', () => {
    expect(readFileSync('src/lib/file-index/search.ts', 'utf8')).toMatch(/principal_id = 'owner'/);
  });
});

describe("a member's file never feeds the owner's intel graph", () => {
  // The backfill sweep that used to be checked here lives in SR-Jkai-Core now;
  // Main's one remaining writer is the file index, which only queues the owner's.
  it('the file index queues intel extraction for owner files only', () => {
    expect(readFileSync('src/lib/file-index/store.ts', 'utf8')).toMatch(/row\.principalId !== 'owner'/);
  });
});

