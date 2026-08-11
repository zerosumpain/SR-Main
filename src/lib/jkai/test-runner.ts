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

/** Lines worth showing an agent that has just been told its gate failed. */
const DIAGNOSTIC_LINE =
  /(^|\s)(Error:|error TS\d+|AssertionError|FAIL\b|✗|×\s|not ok\b|Expected .* but got|Cannot find|is not assignable|Property .* does not exist|SyntaxError|TypeError|ReferenceError)/;

/** Noise that matches the above but never explains anything. */
const DIAGNOSTIC_NOISE = /npm ERR!|ELIFECYCLE|Command failed: bash -c|^\s*at\s+\S+\s+\(/;

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
  const lines = output.split('\n');
  const keep = new Set<number>();
  lines.forEach((line, i) => {
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

  if (picked.length === 0) {
    // Nothing recognisable. The end of the log beats the beginning every time.
    return output.length <= limit ? output : `…\n${output.slice(-limit)}`;
  }

  const out: string[] = [];
  let previous = -1;
  for (const i of picked) {
    if (previous >= 0 && i > previous + 1) out.push('  …');
    out.push(lines[i]);
    previous = i;
  }
  const joined = out.join('\n');
  return joined.length <= limit ? joined : `${joined.slice(0, limit)}\n… (truncated)`;
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
