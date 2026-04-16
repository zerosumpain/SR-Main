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
      return { passed: true, output: 'No tests found', testCount: 0, failCount: 0 };
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
  return { passed, output: output.slice(0, 5000), testCount, failCount };
}
