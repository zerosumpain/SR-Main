import { describe, expect, it } from 'vitest';
import { failureKindFor, verificationExcerpt } from '../../scripts/development-verification.mjs';

// Shape of the real tests log from build f3a6c096 (2026-09-27): a long run of
// stderr from tests that PASSED, then the one failing suite, with bare colour
// codes whose escape byte was lost.
const jokesLog = [
  ...Array.from({ length: 40 }, () => '[90mstderr[2m | tests/lib/jkai/tool-bridge.test.ts[2m > [22m[2minvokeTool\n[22m[39m[scheduler] Boot failed: Cannot access \'__vite_ssr_import_7__\' before initialization\n'),
  '[31m⎯⎯⎯⎯⎯⎯[39m[1m[41m Failed Suites 1 [49m[22m[31m⎯⎯⎯⎯⎯⎯⎯[39m',
  '[41m[1m FAIL [22m[49m src/lib/home/presence/feed-checks.test.ts[2m > [22mfeed checks against test PostgreSQL',
  '[31m[1mError[22m: Requires a loopback test database[39m',
  ' Test Files  1 failed | 592 passed (593)',
].join('\n');

describe('failureKindFor', () => {
  it('files the jsdom lru-cache require() flake as infrastructure', () => {
    expect(failureKindFor("Error: Cannot require() ES Module /workspace/node_modules/lru-cache/dist/esm/index.js in a cycle")).toBe('infrastructure');
    expect(failureKindFor('could not write init file')).toBe('infrastructure');
  });

  it('leaves an ordinary test failure with the caller', () => {
    expect(failureKindFor(jokesLog)).toBe('feature');
    expect(failureKindFor('AssertionError: expected 1 to be 2', 'deadline')).toBe('deadline');
  });
});

describe('verificationExcerpt', () => {
  it('puts the failing file first even when passing-test noise fills the tail', () => {
    const excerpt = verificationExcerpt(jokesLog, 600);
    expect(excerpt.indexOf('FAIL')).toBeLessThan(200);
    expect(excerpt).toContain('src/lib/home/presence/feed-checks.test.ts');
    expect(excerpt).toContain('Requires a loopback test database');
    expect(excerpt).not.toMatch(/\[\d+m/);
    expect(excerpt.length).toBeLessThanOrEqual(620);
  });

  it('falls back to the tail when nothing reads as a verdict', () => {
    expect(verificationExcerpt('just some output', 100)).toBe('just some output');
  });
});
