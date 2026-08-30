import { describe, it, expect } from 'vitest';
import {
  assertionMatcherIn, looksFailed, fingerprintOf, fingerprintsIn, gateOf, stripAnsi } from './fingerprint';

const ESC = String.fromCharCode(27);
const red = (s: string) => `${ESC}[31m${s}${ESC}[39m`;

describe('the false-positive corpus — green runs must never read as failures', () => {
  // This block exists because the first version of this classifier called
  // `svelte-check found 0 errors` a FAILURE, and it was the most common
  // "failure" in the whole corpus: 30 hits, every one a passing run. A guard
  // that flags everything is as useless as one that flags nothing.
  it.each([
    'svelte-check found 0 errors and 758 warnings',
    'svelte-check found 0 errors',
    'Test Files  12 passed (12)\nTests  231 passed (231)',
    'Tests: 0 failed, 231 passed',
    '0 errors',
    'exit code 0',
    'COMPLETED 7029 FILES 0 ERRORS 758 WARNINGS',
    '',
    '   \n  ',
    'Build complete in 42s',
  ])('does not flag %j as a failure', (text) => {
    expect(looksFailed(text)).toBe(false);
  });

  it('still flags a real count even when a zero appears elsewhere', () => {
    // "0 warnings" must not rescue "3 errors".
    expect(looksFailed('svelte-check found 3 errors and 0 warnings')).toBe(true);
    expect(looksFailed('Tests: 2 failed, 0 skipped, 229 passed')).toBe(true);
  });
});

describe('genuine failures are detected', () => {
  it.each([
    'src/a.ts:3:1 - error TS2345: Argument of type X is not assignable',
    'FAIL src/lib/codegraph/query.test.ts',
    'AssertionError: expected 8 to be +0',
    "Error: Cannot find package '@openai/codex-sdk' imported from /opt/x",
    'Traceback (most recent call last):\n  File "x.py", line 1',
    'command failed with exit code 1',
    'svelte-check found 12 errors',
  ])('flags %j', (text) => {
    expect(looksFailed(text)).toBe(true);
  });

  it('sees through ANSI colouring', () => {
    // Vitest colours its banner, which fragmented 246 "distinct" signatures in
    // the raw corpus until stripping was done first.
    const coloured = `${ESC}[41m${ESC}[1m FAIL ${ESC}[22m${ESC}[49m packages/x/src/errors.test.ts`;
    expect(stripAnsi(coloured)).toContain('FAIL');
    expect(looksFailed(coloured)).toBe(true);
  });
});

describe('fingerprints are stable, low-cardinality error CLASSES', () => {
  it('keys a TypeScript diagnostic on its code, not its message', () => {
    // Two TS2345s on different files must collide — that is the point.
    const a = fingerprintOf("src/a.ts:3:1 - error TS2345: Argument of type 'string'", 'npm run gate:check');
    const b = fingerprintOf('src/totally/other.ts:99:2 - error TS2345: Argument of type X', 'npm run gate:check');
    expect(a).toBe('typecheck:TS2345');
    expect(a).toBe(b);
  });

  it('is unchanged by ANSI codes, line numbers and paths', () => {
    const plain = fingerprintOf('FAIL src/lib/a.test.ts', 'npx vitest run');
    const noisy = fingerprintOf(red('FAIL src/lib/a.test.ts'), 'npx vitest run');
    expect(noisy).toBe(plain);
  });

  it('keys a missing module on the package, not the importing file', () => {
    const fp = fingerprintOf("Error: Cannot find package '@openai/codex-sdk' imported from /opt/a", 'npm run build');
    expect(fp).toBe('build:missing-module:@openai/codex-sdk');
    const fp2 = fingerprintOf("Error: Cannot find package '@openai/codex-sdk' imported from /somewhere/else", 'npm run build');
    expect(fp).toBe(fp2);
  });

  it('names the gate from the command', () => {
    expect(gateOf('npx svelte-check --tsconfig ./tsconfig.json')).toBe('svelte-check');
    expect(gateOf('NODE_OPTIONS=--max-old-space-size=4096 npx vitest run x')).toBe('vitest');
    expect(gateOf('npm run gate:build')).toBe('build');
    expect(gateOf('npm run gate')).toBe('gate');
    expect(gateOf('ls -la')).toBe('cmd');
  });

  it('returns null when there is nothing to key on', () => {
    // Null means "no question to ask", which the caller logs as empty rather
    // than as a failure — the two must stay distinguishable.
    expect(fingerprintOf('', '')).toBeNull();
    expect(fingerprintOf('all good here', 'ls')).toBeNull();
  });

  it('collects every fingerprint in a multi-failure gate run, bounded', () => {
    const out = fingerprintsIn(
      [
        'src/a.ts:1:1 - error TS2345: no',
        'src/b.ts:2:2 - error TS2551: nope',
        "Error: Cannot find module 'left-pad'",
      ].join('\n'),
      'npm run gate:check',
    );
    expect(out).toContain('typecheck:TS2345');
    expect(out).toContain('typecheck:TS2551');
    expect(out.some((f) => f.includes('missing-module:left-pad'))).toBe(true);
    expect(out.length).toBeLessThanOrEqual(8);
  });

  it('caps a catastrophic run rather than seeding a huge query', () => {
    const many = Array.from({ length: 40 }, (_, i) => `error TS${4000 + i}: x`).join('\n');
    expect(fingerprintsIn(many, 'npm run gate:check')).toHaveLength(8);
  });

  it('produces nothing for clean output', () => {
    expect(fingerprintsIn('svelte-check found 0 errors', 'npm run gate:check')).toEqual([]);
  });
});

/*
 * The strings below are REAL production output, pulled from `jkai_logs` and
 * `jkai_iterations.evaluation` on 2026-08-18. They are here because the hot
 * lane looked correct against invented examples and had, in fact, never fired
 * once: all 16 push serves used the file lane and `served_for` was empty on
 * every row.
 */
describe('the gate summary, which is what a failed gate actually says', () => {
  const REAL_EVALUATION =
    'The gate FAILED. Fix these before doing anything else — a focused test run does not ' +
    'typecheck, so passing vitest is not passing the gate:\n' +
    'The gate failed in `gate:sync`. Run that stage, not a narrower one.\n' +
    '> strange-rambling-svelte@0.0.1 gate:public-routes\n> node scripts/check-public-routes.mjs';

  it('keys on the stage, where it once returned nothing', () => {
    // Build 42244cc0 ran eight consecutive iterations on this exact text, each
    // following a failed gate, and planned a non-fingerprint query every time.
    expect(fingerprintsIn(REAL_EVALUATION, 'npm run gate')).toContain('gate:sync-failed');
    expect(fingerprintOf(REAL_EVALUATION, 'npm run gate')).toBe('gate:sync-failed');
  });

  it('covers the other stages the gate can die in', () => {
    for (const stage of ['gate:build', 'gate:test', 'gate:check', 'gate:public-routes']) {
      const text = `FAIL Tests: 0/1 passed (1 failed)\nThe gate failed in \`${stage}\`. Run that stage, not a narrower one.`;
      expect(fingerprintsIn(text, 'npm run gate')).toContain(`${stage}-failed`);
    }
  });

  it('never outranks a real error class', () => {
    // The stage is the coarsest key we have. A TS code says what is actually
    // wrong; the stage only says where the build tripped.
    const withCode = 'The gate failed in `gate:check`.\nsrc/a.ts:3:1 - error TS2345: Argument of type X';
    expect(fingerprintOf(withCode, 'npm run gate')).toBe('gate:TS2345');
    // …but both are queryable, because the stage is what recurs.
    const all = fingerprintsIn(withCode, 'npm run gate');
    expect(all).toContain('typecheck:TS2345');
    expect(all).toContain('gate:check-failed');
  });

  it('is not fooled by a passing gate', () => {
    expect(fingerprintsIn('svelte-check found 0 errors', 'npm run gate')).toEqual([]);
  });
});

describe('ANSI that arrived without its escape byte', () => {
  it('strips orphaned colour codes', () => {
    // Zero of 827 production error logs contain an escape byte; 42 contain bare
    // `[31m`-style codes. Without this the key was `gate:1mError`, and every
    // colour variant would have become its own key.
    const real = '[31m❯[39m src/lib/a.test.ts [2m([22m[31m1 failed[39m[2m)[22m\n[41m[1m FAIL [22m[49m TypeError: x is not a function';
    expect(stripAnsi(real)).not.toContain('[31m');
    expect(stripAnsi(real)).not.toContain('[1m');
    expect(fingerprintsIn(real, 'npm run gate')).toContain('gate:TypeError');
    expect(fingerprintsIn(real, 'npm run gate').some((f) => /\dm/.test(f))).toBe(false);
  });

  it('leaves text that merely looks like a code alone', () => {
    // Narrower than the escape-prefixed form on purpose: `[2J` or `[1A` are
    // plausible in prose, and a strip that eats real text is the worse failure.
    expect(stripAnsi('see note [12] and appendix [2A]')).toBe('see note [12] and appendix [2A]');
  });
});

/*
 * Subdividing the assertion bucket.
 *
 * `vitest:AssertionError` was 57 of 108 production episodes — 53% — so the hot
 * lane handed a build every assertion this codebase had ever failed. Every
 * string below is REAL output pulled from `codegraph_episodes.problem`, not a
 * constructed example, because this file's whole premise is that the rules are
 * written against measured output.
 */
describe('assertion matcher subdivision', () => {
  const REAL = [
    ['expected "vi.fn()" to be called 3 times, but got 2 times', 'toHaveBeenCalledTimes'],
    ['expected +0 to be 1 // Object.is equality', 'toBe'],
    ["expected 'IBCA · Data Strategy' to be 'IBCA · John Kelly' // Object.is equality", 'toBe'],
    ['expected 2 to be greater than 3', 'toBeGreaterThan'],
    ["expected undefined to be '{{input}}' // Object.is equality", 'toBe'],
  ] as const;

  for (const [text, matcher] of REAL) {
    it(`reads ${matcher} out of production output`, () => {
      expect(assertionMatcherIn(text)).toBe(matcher);
    });
  }

  it('puts the matcher in the fingerprint', () => {
    expect(
      fingerprintOf('FAIL src/lib/daydream/budget.test.ts\nAssertionError: expected +0 to be 1 // Object.is equality', 'npx vitest run'),
    ).toBe('vitest:AssertionError:toBe');
  });

  /*
   * Order is the whole rule. "to be called 3 times" and "to be greater than"
   * both CONTAIN "to be", so a generic-first check would collapse the entire
   * vocabulary back into `toBe` and undo this change without failing anything.
   */
  it('does not let the generic matcher swallow a specific one', () => {
    expect(assertionMatcherIn('expected "vi.fn()" to be called 3 times')).not.toBe('toBe');
    expect(assertionMatcherIn('expected 2 to be greater than 3')).not.toBe('toBe');
    expect(assertionMatcherIn('expected [] to have length 2')).toBe('toHaveLength');
    expect(assertionMatcherIn('expected fn to throw an error')).toBe('toThrow');
  });

  it('falls back to the bare class when no matcher is readable', () => {
    expect(fingerprintOf('AssertionError: something unparseable', 'vitest')).toBe(
      'vitest:AssertionError',
    );
  });

  it('is not fooled by a matcher word in the test NAME', () => {
    // The window is anchored on `expected`, so "should contain" in a describe
    // block cannot classify the failure.
    expect(
      assertionMatcherIn('FAIL x.test.ts > formatter > should contain the unit\nexpected 1 to be 2 // Object.is equality'),
    ).toBe('toBe');
  });

  it('emits BOTH the sharp and coarse keys in the query set', () => {
    // Sharp so it matches failures of the same matcher; coarse so episodes
    // recorded before the subdivision existed stay reachable.
    const set = fingerprintsIn('AssertionError: expected 2 to be greater than 3', 'npx vitest run');
    expect(set).toContain('vitest:AssertionError:toBeGreaterThan');
    expect(set).toContain('vitest:AssertionError');
  });

  it('leaves other named errors alone', () => {
    expect(fingerprintOf('TypeError: x is not a function', 'vitest')).toBe('vitest:TypeError');
  });
});
