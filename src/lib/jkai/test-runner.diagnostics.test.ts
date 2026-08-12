import { describe, expect, it } from 'vitest';
import { extractDiagnostics, formatTestSummary } from './test-runner';

// The real thing, reconstructed from build 81ac1714 (change request #216).
// 2,034 characters, first `Error:` at 1,185 — past the 1,000-character head
// slice the agent used to be handed.
const GATE_216 = [
  'FAIL Tests: 0/1 passed (1 failed)',
  '> strange-rambling-svelte@0.0.1 gate',
  '> npm run gate:public-routes && npm run gate:font-sizes && npm run gate:check && npm run gate:test && npm run gate:build',
  '',
  '> strange-rambling-svelte@0.0.1 gate:public-routes',
  '> node scripts/check-public-routes.mjs',
  '',
  'check-public-routes: OK — 182 anonymously-reachable routes, unchanged.',
  '',
  '> strange-rambling-svelte@0.0.1 gate:font-sizes',
  '> node scripts/check-font-sizes.mjs',
  '',
  'check-font-sizes: OK — 2208 declarations across 252 files, none below 12px.',
  '',
  '> strange-rambling-svelte@0.0.1 gate:check',
  '> npm run gate:sync && npm run gate:check:only',
  '',
  '`config.kit.csrf.checkOrigin` has been deprecated in favour of `csrf.trustedOrigins`.',
  '',
  'Loading svelte-check in workspace: /home/jkai/workspace/81ac1714/dev',
  'Getting Svelte diagnostics...',
  '',
  '/home/jkai/workspace/81ac1714/dev/src/lib/workflows/nodes/apple-calendar.ts:66:30',
  'Error: Expected 2 arguments, but got 1.',
  '  const date = value.match(/^(\\d{4})(\\d{2})(\\d{2})$/);',
  '',
  'svelte-check found 1 error and 743 warnings',
].join('\n');

describe('formatTestSummary', () => {
  it('includes the supplied gate duration in whole seconds only for a passing test gate', () => {
    expect(formatTestSummary({ passed: true, testCount: 1, failCount: 0 }, 114_000)).toBe('PASS Tests: 1/1 passed (114s)');
    expect(formatTestSummary({ passed: false, testCount: 1, failCount: 1 }, 114_000)).toBe('FAIL Tests: 0/1 passed (1 failed)');
  });
});

describe('extractDiagnostics', () => {
  it('finds the error that the head of the log hides', () => {
    const d = extractDiagnostics(GATE_216);
    expect(d).toContain('Expected 2 arguments, but got 1.');
    // The file:line lives on the line ABOVE the message — useless without it.
    expect(d).toContain('apple-calendar.ts:66:30');
  });

  it('drops the passing preamble that made a failed gate read as a success', () => {
    const d = extractDiagnostics(GATE_216);
    expect(d).not.toContain('check-public-routes: OK');
    expect(d).not.toContain('check-font-sizes: OK');
    expect(d).not.toContain('Getting Svelte diagnostics');
  });

  it('is smaller than the slice it replaces, while containing more', () => {
    // The real log was 2,034 chars with its first `Error:` at 1,185. The
    // fixture above is a touch shorter, so pad the preamble back out to
    // reproduce the geometry that actually mattered: the error must fall
    // OUTSIDE the first 1,000 characters, which is all the agent ever saw.
    const padded = GATE_216.replace(
      'Getting Svelte diagnostics...',
      `Getting Svelte diagnostics...\n${'(scanning) '.repeat(30)}`,
    );
    expect(padded.indexOf('Error:')).toBeGreaterThan(1000);
    expect(padded.slice(0, 1000)).not.toContain('Error:');

    const d = extractDiagnostics(padded);
    expect(d).toContain('Expected 2 arguments, but got 1.');
    expect(d.length).toBeLessThan(1000);
  });

  it('keeps vitest assertion failures', () => {
    const out = [
      'RUN v4.1.0',
      '✓ src/a.test.ts (3)',
      '× src/b.test.ts > adds up',
      '  AssertionError: expected 3 to be 4',
      'Tests 1 failed | 3 passed',
    ].join('\n');
    const d = extractDiagnostics(out);
    expect(d).toContain('AssertionError: expected 3 to be 4');
    expect(d).not.toContain('RUN v4.1.0');
  });

  it('ignores npm’s own noise, which matches every error pattern and explains nothing', () => {
    const out = ['Something real: Error: the actual cause', 'npm ERR! code ELIFECYCLE', 'npm ERR! errno 1'].join('\n');
    const d = extractDiagnostics(out);
    expect(d).toContain('the actual cause');
    expect(d).not.toContain('ELIFECYCLE');
  });

  it('falls back to the END of the log when nothing matches, never the start', () => {
    // Summaries live at the bottom. Taking the head is what caused this bug.
    const out = `${'preamble line\n'.repeat(400)}the summary nobody saw`;
    const d = extractDiagnostics(out, 200);
    expect(d).toContain('the summary nobody saw');
  });

  it('marks where it skipped, so nobody reads it as a contiguous log', () => {
    const out = ['Error: first', ...Array(20).fill('filler'), 'Error: second'].join('\n');
    expect(extractDiagnostics(out)).toContain('…');
  });

  it('returns nothing for empty input rather than throwing', () => {
    expect(extractDiagnostics('')).toBe('');
  });
});

// The real thing, reconstructed from build eb57c2fb (change request #223).
//
// #216 died of head-truncation and #221 fixed it. #223 then died of the
// OPPOSITE fault in the same function: the suite deliberately exercises its own
// failure paths, so a green vitest run prints dozens of `Error:` and
// `TypeError:` lines to stderr from tests that PASS. Every one matched
// DIAGNOSTIC_LINE, they arrive long before the summary, and source order plus a
// 2,000-character ceiling meant they filled the window and the real failure was
// cut off behind `… (truncated)`.
//
// The agent was handed this and told "fix these before doing anything else".
// It investigated, found those tests passing, reported "no further code changes
// needed", and did that for three iterations at an eight-minute gate apiece
// until the idle breaker stopped the build 65 minutes in.
const VITEST_CAPTURE_NOISE = [
  'RUN v4.1.0 /home/jkai/workspace/eb57c2fb/dev',
  '',
  'stderr | src/lib/workflows/site-tools/tools/workflows.discovery.test.ts',
  '[canvas-migrate] Boot migration failed: TypeError: all is not iterable',
  '    at migrateWorkflowsToCanvas (/home/jkai/workspace/eb57c2fb/dev/src/lib/canvas/migrate.ts:29:20)',
  '',
  'stderr | tests/lib/health/hero-copy-service.test.ts > getHeroCopy > returns fallback when LLM throws',
  '[hero-copy] background LLM failed Error: boom',
  '',
  'stderr | src/lib/canvas/audit.test.ts > recordAudit > still swallows a pool write failure',
  "[audit] failed to record { workflowId: 'w1' } Error: insert failed",
  '',
].join('\n');

const VITEST_REAL_FAILURE = [
  '⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯',
  'FAIL src/lib/workflows/nodes/apple-calendar.test.ts > parses rawProperties',
  'AssertionError: expected undefined to be defined',
  '',
  'Test Files  1 failed | 312 passed (313)',
  'Tests  1 failed | 4102 passed (4103)',
].join('\n');

describe('extractDiagnostics — a suite that tests its own failure paths', () => {
  const GATE_223 = `${VITEST_CAPTURE_NOISE}\n${VITEST_REAL_FAILURE}`;

  it('does not report stderr from a PASSING test as the thing to fix', () => {
    const d = extractDiagnostics(GATE_223);
    expect(d).not.toContain('[canvas-migrate]');
    expect(d).not.toContain('[hero-copy]');
    expect(d).not.toContain('[audit] failed to record');
  });

  it('never quotes a bare `stderr |` header as the blocker', () => {
    // This exact line was recorded as the build's failure reason: the context
    // window either side of a matching line dragged the capture header in.
    const d = extractDiagnostics(GATE_223);
    expect(d).not.toContain('stderr | src/lib/workflows/site-tools');
  });

  it('reports the failure that actually stopped the gate', () => {
    const d = extractDiagnostics(GATE_223);
    expect(d).toContain('apple-calendar.test.ts > parses rawProperties');
    expect(d).toContain('AssertionError: expected undefined to be defined');
  });

  it('keeps vitest’s own count summary, which says how bad it is', () => {
    const d = extractDiagnostics(GATE_223);
    expect(d).toContain('Tests  1 failed');
  });

  it('keeps the TAIL when the noise would overflow the window', () => {
    // A `&&` chain stops at the first failing stage, so the failure is always
    // the last thing in the log. Overflow must therefore drop the head.
    const flood = `${'stderr | src/x.test.ts\n[boot] failed: TypeError: nope\n\n'.repeat(200)}${VITEST_REAL_FAILURE}`;
    const d = extractDiagnostics(flood, 800);
    expect(d).toContain('parses rawProperties');
    expect(d.length).toBeLessThanOrEqual(900);
  });

  it('still finds a svelte-check error, which has no capture blocks at all', () => {
    const d = extractDiagnostics(GATE_216);
    expect(d).toContain('Expected 2 arguments, but got 1.');
    expect(d).toContain('apple-calendar.ts:66:30');
  });

  it('sees through the colour vitest writes even into a pipe', () => {
    // Verbatim bytes from iteration 5 of build eb57c2fb, escapes and all. The
    // visible text does not start the line, so every line-anchored pattern in
    // this module misses unless the colour comes off first. This is what made
    // the recorded abort reason the literal string `[90ms`.
    const ansi = [
      '[90mstderr[2m | src/lib/workflows/site-tools/tools/workflows.discovery.test.ts',
      '[22m[39m[canvas-migrate] Boot migration failed: TypeError: all is not iterable',
      '',
      VITEST_REAL_FAILURE,
    ].join('\n');
    const d = extractDiagnostics(ansi);
    expect(d).not.toContain('[canvas-migrate]');
    expect(d).not.toContain('[');
    expect(d).toContain('parses rawProperties');
  });

  it('names the gate stage that failed, so the agent knows where to look', () => {
    const out = [
      '> strange-rambling-svelte@0.0.1 gate:check',
      'svelte-check found 0 errors',
      '> strange-rambling-svelte@0.0.1 gate:test',
      VITEST_REAL_FAILURE,
    ].join('\n');
    expect(extractDiagnostics(out)).toContain('gate:test');
  });
});
