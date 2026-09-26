import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The owner lane of `workflow_files`: every reader and writer here runs as John
 * (agent tools, workflow nodes, search, intel, the deck editor, the chat's
 * drive link), so each must filter to `principal_id = 'owner'`. A member's
 * files share the table, under `members/<id>/` (see ./namespace), and an
 * unfiltered listing in any of these would hand them to the owner's agent, his
 * graph or a public deck.
 *
 * Static on purpose: the failure is a query that is MISSING a clause, which no
 * behavioural test of the existing clauses would notice. A file that stops
 * naming `principalId` has almost certainly dropped the filter.
 */
const OWNER_LANE = [
  'src/lib/workflows/site-tools/tools/files.ts',
  'src/lib/workflows/nodes/file-store.ts',
  'src/lib/workflows/nodes/file-ops.ts',
  'src/lib/workflows/nodes/file-build.ts',
  'src/lib/workflows/nodes/file-extract.ts',
  'src/lib/workflows/nodes/file-text-extract.ts',
  'src/lib/workflows/orchestrator/workspace-grounding.ts',
  'src/routes/api/decks/media/drive/+server.ts',
  'src/lib/jkai/media/drive-link.ts',
  'src/lib/jkai/intel/source-policy.server.ts',
] as const;

/** Writers that take a name from a workflow's config: each refuses the member root. */
const NAMED_WRITERS = [
  'src/lib/workflows/nodes/file-store.ts',
  'src/lib/workflows/nodes/file-ops.ts',
  'src/lib/workflows/nodes/file-build.ts',
  'src/lib/workflows/nodes/file-extract.ts',
  'src/lib/workflows/nodes/file-text-extract.ts',
] as const;

describe("the owner lane reads and writes the owner's files only", () => {
  it.each(OWNER_LANE)('%s filters on principalId', (file) => {
    expect(readFileSync(file, 'utf8')).toMatch(/principalId/);
  });

  it.each(NAMED_WRITERS)('%s refuses a name under members/', (file) => {
    expect(readFileSync(file, 'utf8')).toMatch(/isReservedForOwnerLane\(/);
  });

  it('search matches owner files only (raw SQL, so it names the column)', () => {
    expect(readFileSync('src/lib/file-index/search.ts', 'utf8')).toMatch(/principal_id = 'owner'/);
  });
});
