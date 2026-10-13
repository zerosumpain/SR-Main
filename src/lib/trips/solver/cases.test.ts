// Replays the shared solver cases (fixtures/cases/*.json). The iPhone app
// replays the same files against its Swift port of retimeDay/replanDay.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { replanDay, retimeDay } from './index';
import { buildCaseInputs, type SolverCase } from './fixtures/cases/build';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'cases');

function run(c: Omit<SolverCase, 'expected'> & { fn: SolverCase['fn'] }): unknown {
  if (c.fn === 'retimeDay') {
    const { day, fromIndex, startMin, ...rest } = c.input as Extract<
      SolverCase,
      { fn: 'retimeDay' }
    >['input'];
    return retimeDay(day, fromIndex, startMin, rest);
  }
  return replanDay(c.input as Extract<SolverCase, { fn: 'replanDay' }>['input']);
}

if (process.env.TRIPS_WRITE_CASES === '1') {
  mkdirSync(DIR, { recursive: true });
  for (const c of buildCaseInputs()) {
    const out = { name: c.name, description: c.description, fn: c.fn, input: c.input, expected: run(c) };
    writeFileSync(join(DIR, `${c.name}.json`), `${JSON.stringify(out, null, 2)}\n`);
  }
}

const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .sort();

describe('shared solver cases', () => {
  it('has at least six cases', () => {
    expect(files.length).toBeGreaterThanOrEqual(6);
  });

  for (const file of files) {
    it(file, () => {
      const c = JSON.parse(readFileSync(join(DIR, file), 'utf8')) as SolverCase;
      // Round-trip through JSON so the comparison is exactly what Swift sees.
      expect(JSON.parse(JSON.stringify(run(c)))).toEqual(c.expected);
    });
  }

  it('the case inputs still match what the Rome fixture builds', () => {
    const built = buildCaseInputs();
    expect(built.map((c) => `${c.name}.json`).sort()).toEqual(files);
    for (const c of built) {
      const stored = JSON.parse(readFileSync(join(DIR, `${c.name}.json`), 'utf8')) as SolverCase;
      expect(JSON.parse(JSON.stringify(c.input))).toEqual(stored.input);
    }
  });
});
