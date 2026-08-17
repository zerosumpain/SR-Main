import { execInSandbox } from './sandbox';

// Strip null bytes and other control chars that break Postgres text columns
function sanitize(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
}

export interface TestRunResult {
  passed: boolean;
  output: string;
  testCount: number;
  failCount: number;
  /** The lines that say what is wrong — see `extractDiagnostics`. */
  diagnostics: string;
}

/** The test-gate result line stored in the build log. */
export function formatTestSummary(result: Pick<TestRunResult, 'passed' | 'testCount' | 'failCount'>, durationMs: number): string {
  const testEmoji = result.passed ? 'PASS' : 'FAIL';
  const counts = `${result.testCount - result.failCount}/${result.testCount} passed`;
  if (result.passed) return `${testEmoji} Tests: ${counts} (${(durationMs / 1000).toFixed(0)}s)`;
  return `${testEmoji} Tests: ${counts}${result.failCount > 0 ? ` (${result.failCount} failed)` : ''}`;
}

/** Lines worth showing an agent that has just been told its gate failed. */
const DIAGNOSTIC_LINE =
  /(^|\s)(Error:|error TS\d+|AssertionError|FAIL\b|✗|×\s|not ok\b|Expected .* but got|Cannot find|is not assignable|Property .* does not exist|SyntaxError|TypeError|ReferenceError)/;

/** Noise that matches the above but never explains anything. */
const DIAGNOSTIC_NOISE = /npm ERR!|ELIFECYCLE|Command failed: bash -c|^\s*at\s+\S+\s+\(/;

/**
 * Remove ANSI colour before anything tries to read the transcript.
 *
 * MUST run first. vitest colours its output even through a pipe, so the real
 * lines arrive as `ESC[90mstderr ESC[2m | src/x.test.ts` — the visible text
 * does not start the line, and neither `^\s*(stderr|stdout)` nor
 * DIAGNOSTIC_NOISE's `^\s*at\s+\S+\s+\(` can match through the escape. On
 * change request #223 that last one is why every benign stack frame cost three
 * lines of a 2,000-character budget, and why the recorded abort reason came out
 * as the literal string `[90ms`.
 */
export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
}

/**
 * The lines that are authoritative about a failure rather than merely
 * error-shaped. A vitest summary says how many tests failed; `DIAGNOSTIC_LINE`
 * never matched any of them, because none of them contain the word "Error".
 */
const DIAGNOSTIC_SUMMARY =
  /(^\s*(Test Files|Tests)\s+\d+\s+failed)|(Failed Tests\s+\d+)|(^\s*FAIL\s)|(svelte-check found [1-9])/;

/** The npm banner a gate stage prints when it starts: `> pkg@1.0.0 gate:test`. */
const STAGE_BANNER = /^>\s+\S+@\S+\s+(gate\S*)\s*$/;

/**
 * Vitest prints console output captured from tests under a `stderr | file` or
 * `stdout | file` header — INCLUDING from tests that pass.
 *
 * This suite deliberately exercises its own failure paths (a boot migration
 * that throws, an LLM call that rejects, an audit write that fails), so a
 * perfectly green run emits dozens of lines reading `... failed: TypeError:`
 * and `... Error: boom`. Every one matches `DIAGNOSTIC_LINE`, they are printed
 * long before the summary, and the picked lines are kept in source order — so
 * on change request #223 they filled the 2,000-character window and the real
 * failure was cut off behind `… (truncated)`.
 *
 * The agent was handed that and told to fix it. It went looking, found those
 * tests passing, concluded "no further code changes needed", and repeated that
 * for three iterations at an eight-minute gate apiece before the idle breaker
 * stopped the build — 65 minutes in, having finished the actual work in the
 * first one.
 *
 * A capture block runs from its header to the next blank line. Dropping the
 * blocks wholesale is right: a genuine failure is never reported only inside
 * one — vitest repeats it in the `Failed Tests` section either way.
 */
function stripCaptureBlocks(lines: string[]): string[] {
  const kept: string[] = [];
  let inCapture = false;
  for (const line of lines) {
    if (/^\s*(stderr|stdout)\s*\|/.test(line)) {
      inCapture = true;
      continue;
    }
    if (inCapture) {
      if (line.trim() === '') inCapture = false;
      continue;
    }
    kept.push(line);
  }
  return kept;
}

/**
 * Name the stage that failed.
 *
 * The gate is an `&&` chain, so it stops at the first stage to exit non-zero:
 * the LAST banner printed is the stage that broke. That one line turns "the
 * gate failed" into "the gate failed in gate:test", which is the difference
 * between the agent re-running `gate:check:only` — seeing it exit 0, as it did
 * six times on #223 — and running the thing that actually failed.
 */
function failingStage(lines: string[]): string | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(STAGE_BANNER);
    if (m) return m[1];
  }
  return null;
}

/**
 * Pull the failing lines out of a gate run.
 *
 * The alternative — and what this replaces — was handing the agent the FIRST
 * n characters of the output. A gate prints its passing steps first, so the
 * head of a failed run reads exactly like a successful one. Change request #216
 * died of this: its output was 2,034 characters, the first `Error:` was at
 * 1,185, and the agent was given `slice(0, 1000)`. Its context ended mid-path
 * inside "Loading svelte-check in workspace: /home/jkai/workspace/81ac171", so
 * every line it could see said OK. It concluded it was finished, said so three
 * times, changed nothing, and was stopped by the idle breaker — with two
 * one-line type errors outstanding that it was never shown.
 *
 * Errors carry the line above and below, because a svelte-check diagnostic puts
 * the file:line on its own line and the offending source underneath. When
 * nothing matches, fall back to the TAIL rather than the head: summaries live
 * at the end of a log, never at the start.
 */
export function extractDiagnostics(output: string, limit = 2000): string {
  // Colour first, or none of the line-shape matching below works — see stripAnsi.
  const plain = stripAnsi(output);
  const raw = plain.split('\n');
  const stage = failingStage(raw);
  // Captured console output from PASSING tests goes first — see
  // `stripCaptureBlocks`. Everything below scans what survives, so a capture
  // header can no longer be dragged in as a context line either, which is how
  // a bare `stderr | …discovery.test.ts` came to be recorded as the reason
  // change request #223 stopped.
  const lines = stripCaptureBlocks(raw);
  const keep = new Set<number>();
  lines.forEach((line, i) => {
    if (DIAGNOSTIC_SUMMARY.test(line)) {
      keep.add(i);
      keep.add(i + 1);
      return;
    }
    if (DIAGNOSTIC_LINE.test(line) && !DIAGNOSTIC_NOISE.test(line)) {
      keep.add(i - 1);
      keep.add(i);
      keep.add(i + 1);
    }
  });

  const picked = [...keep]
    .filter((i) => i >= 0 && i < lines.length)
    // Noise is excluded even when it arrives as CONTEXT. `npm ERR! ELIFECYCLE`
    // sits directly under the real cause, so a naive line-above/below window
    // drags it in and the useful line competes with three lines of exit codes.
    .filter((i) => !DIAGNOSTIC_NOISE.test(lines[i]))
    .sort((a, b) => a - b);

  const prefix = stage ? `The gate failed in \`${stage}\`. Run that stage, not a narrower one.\n` : '';

  if (picked.length === 0) {
    // Nothing recognisable. The end of the log beats the beginning every time.
    const body = plain.length <= limit ? plain : `… (${plain.length - limit} characters dropped)\n${plain.slice(-limit)}`;
    return plain ? `${prefix}${body}` : '';
  }

  const out: string[] = [];
  let previous = -1;
  for (const i of picked) {
    if (previous >= 0 && i > previous + 1) out.push('  …');
    out.push(lines[i]);
    previous = i;
  }
  const joined = out.join('\n');
  // Overflow drops the HEAD, not the tail. The gate is an `&&` chain, so it
  // stops at the stage that failed and the failure is the last thing in the
  // log; keeping the first n characters keeps whatever ran before the problem.
  const body = joined.length <= limit
    ? joined
    : `… (${joined.length - limit} characters dropped)\n${joined.slice(-limit)}`;
  return `${prefix}${body}`;
}

export async function runTests(buildId: string, workdir: string): Promise<TestRunResult> {
  // Check if tests/run.sh exists
  const hasRunner = await execInSandbox(`test -f ${workdir}/tests/run.sh && echo YES`, 5000);
  if (hasRunner.stdout.trim() !== 'YES') {
    // Check for any test files
    const hasTests = await execInSandbox(
      `find ${workdir}/tests -name "test_*.py" -o -name "*.test.js" -o -name "*.test.ts" 2>/dev/null | head -1`,
      5000,
    );
    if (!hasTests.stdout.trim()) {
      return { passed: true, output: 'No tests found', testCount: 0, failCount: 0, diagnostics: '' };
    }
    // Auto-detect test runner
    const hasPytest = await execInSandbox(`find ${workdir}/tests -name "test_*.py" | head -1`, 5000);
    const hasNodeTest = await execInSandbox(`find ${workdir}/tests -name "*.test.js" -o -name "*.test.ts" | head -1`, 5000);

    if (hasPytest.stdout.trim()) {
      await execInSandbox(`echo 'cd ${workdir} && python3 -m pytest tests/ -v --tb=short 2>&1' > ${workdir}/tests/run.sh`, 5000);
    } else if (hasNodeTest.stdout.trim()) {
      await execInSandbox(`echo 'cd ${workdir} && node --test tests/ 2>&1' > ${workdir}/tests/run.sh`, 5000);
    }
  }

  // Run tests
  const result = await execInSandbox(`bash ${workdir}/tests/run.sh 2>&1`, 120000);
  const output = sanitize((result.stdout + '\n' + result.stderr).trim());

  // Parse results
  let testCount = 0;
  let failCount = 0;

  const pytestMatch = output.match(/(\d+) passed/);
  const pytestFail = output.match(/(\d+) failed/);
  if (pytestMatch) testCount += parseInt(pytestMatch[1]);
  if (pytestFail) { failCount += parseInt(pytestFail[1]); testCount += failCount; }

  const nodeTestMatch = output.match(/# tests (\d+)/);
  const nodeFailMatch = output.match(/# fail (\d+)/);
  if (nodeTestMatch) testCount = parseInt(nodeTestMatch[1]);
  if (nodeFailMatch) failCount = parseInt(nodeFailMatch[1]);

  if (testCount === 0) {
    const passLines = (output.match(/\b(PASS|ok |✓|passed)\b/gi) || []).length;
    const failLines = (output.match(/\b(FAIL|not ok|✗|failed|ERROR)\b/gi) || []).length;
    testCount = passLines + failLines;
    failCount = failLines;
  }

  const passed = result.exitCode === 0 && failCount === 0;
  return {
    passed,
    output: output.slice(0, 5000),
    testCount,
    failCount,
    diagnostics: passed ? '' : extractDiagnostics(output),
  };
}
