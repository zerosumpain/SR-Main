// THE PROBE LIST IS COMPLETE, OR THIS FAILS.
//
// A probe that is missing looks exactly like a probe that passes: the receipt
// says "none" for a table it never asked about. So completeness is checked
// against `schema.ts` rather than reviewed — a new table carrying an
// `analysis_id` fails here until somebody decides whether a purge must reach it.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PROBE_TABLES } from './census';

/** Every table in the schema with a column that points at a policy analysis. */
function tablesReferencingAnAnalysis(): string[] {
  const schema = readFileSync('src/lib/db/schema.ts', 'utf8');
  const out: string[] = [];
  for (const m of schema.matchAll(/pgTable\('([a-z_0-9]+)',\s*\{/g)) {
    const start = m.index ?? 0;
    const end = schema.indexOf('\n}', start);
    const block = schema.slice(start, end);
    if (/analysisId:\s*uuid\('analysis_id'\)/.test(block)) out.push(m[1]);
  }
  return out.sort();
}

describe('the census asks everywhere a reference can live', () => {
  it('covers every table that names an analysis', () => {
    const missing = tablesReferencingAnAnalysis().filter((t) => !PROBE_TABLES.includes(t));
    expect(missing, 'add a probe in census.ts for each of these').toEqual([]);
  });

  it('also reaches the two places no foreign key does', () => {
    // `workflow_runs` holds the analysis id inside `input_data` and has no
    // cascade; a cross-policy finding about this paper lives on somebody ELSE's
    // analysis row. Both survived every delete this feature did for two months,
    // and neither is reachable by walking foreign keys.
    expect(PROBE_TABLES).toContain('workflow_runs');
    expect(PROBE_TABLES.some((t) => t.startsWith('policy_artefacts (other'))).toBe(true);
  });

  it('is the eleven the receipt and the dashboard both promise', () => {
    expect(PROBE_TABLES).toHaveLength(11);
  });
});
