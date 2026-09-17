/**
 * One ledger, many readers — held honest by a grep, in the shape
 * `estate.test.ts` uses against `hooks.server.ts`.
 *
 * The three surfaces that show "today's spend" each had their own query, and the
 * three disagreed on both the window and the rows:
 *
 *   /admin           Node's local midnight, NO action_type filter
 *   /admin/ops/costs Postgres date_trunc('day'), filtered to llm_call
 *   /jkai            a ROLLING 24 HOURS
 *
 * A type cannot catch a fourth copy appearing, because a fourth copy compiles
 * perfectly. Only reading the files can.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/** Every surface that reports a spend figure to a human. */
const READERS = [
  'src/routes/admin/+page.server.ts',
  'src/routes/jkai/+layout.server.ts',
  'src/routes/admin/ops/costs/+page.server.ts',
];

describe('the spend ledger', () => {
  it('is the only place midnight is decided', () => {
    for (const rel of READERS) {
      const src = read(rel);
      expect(
        /setHours\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/.test(src),
        `${rel} zeroes the hours on the NODE clock. Midnight is the database's — ` +
          'deriving it from the process clock made the costs page disagree with its own chart, ' +
          'silently, and only for part of the year. Use DAY_START from $lib/costs/ledger.server.',
      ).toBe(false);
    }
  });

  it('is not bypassed by a rolling window pretending to be a day', () => {
    for (const rel of ['src/routes/admin/+page.server.ts', 'src/routes/jkai/+layout.server.ts']) {
      const src = read(rel);
      expect(
        /Date\.now\(\)\s*-\s*86_?400_?000/.test(src),
        `${rel} computes a rolling 24 hours. Beside a figure labelled "today" that is a ` +
          'different window under the same word.',
      ).toBe(false);
    }
  });

  it('is what the two summary surfaces actually call', () => {
    for (const rel of ['src/routes/admin/+page.server.ts', 'src/routes/jkai/+layout.server.ts']) {
      expect(read(rel), `${rel} does not read the shared ledger`).toContain('$lib/costs/ledger.server');
    }
  });

  it('applies the action_type filter, because the table is shared', () => {
    // agent_actions was the external-agent action log before it was the LLM
    // billing ledger. Without this filter a reader sums different species —
    // which is exactly what /admin did.
    expect(read('src/lib/costs/ledger.server.ts')).toContain("eq(agentActions.actionType, 'llm_call')");
  });
});
