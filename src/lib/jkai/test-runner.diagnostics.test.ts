import { describe, expect, it } from 'vitest';
import { extractDiagnostics } from './test-runner';

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
