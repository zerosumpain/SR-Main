import { describe, it, expect } from 'vitest';
import { looksFailed, fingerprintOf, fingerprintsIn, gateOf, stripAnsi } from './fingerprint';

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
