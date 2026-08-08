/**
 * Does the app that was just registered actually work?
 *
 * On 2026-08-08 a heartbeat answered "we've landed — calculator is built and
 * published" about an app that returned 0 for every sum. Nothing had lied: the
 * build row said `status: completed`, because that is what the register tool
 * writes the moment the files hit disk. Nobody had ever run the thing.
 *
 * This runs it. `scripts/smoke-static-app.mjs` opens the workspace's index.html
 * in headless Chromium and reports back; see that file for why it is a
 * subprocess rather than an import.
 */
import { execInSandbox } from './sandbox';

/** One behavioural assertion, authored by whoever knows what the app is for. */
export interface SmokeCheck {
  description: string;
  /** JS run in the page. Must RETURN true to pass; anything else is a failure. */
  script: string;
}

export interface SmokeCheckResult {
  name: string;
  passed: boolean;
  detail?: string;
}

export type SmokeOutcome =
  /** The harness ran. `passed` is about the app. */
  | { ran: true; passed: boolean; checks: SmokeCheckResult[]; failures: string[] }
  /** The harness could not run. Says nothing about the app either way. */
  | { ran: false; reason: string };

/**
 * Parse what the runner printed.
 *
 * Separate from the exec so it can be tested without a browser, and because the
 * failure mode that matters is subtle: an unparseable line must become
 * `ran: false`, never `passed: false`. A broken harness that reports a failing
 * app would block good work and teach the model to route around the tool — the
 * exact behaviour that produced three dead build rows in the first place.
 */
export function parseSmokeOutput(stdout: string, stderr: string): SmokeOutcome {
  const line = (stdout ?? '').trim();
  if (!line) {
    return { ran: false, reason: stderr?.trim().slice(0, 300) || 'the smoke runner printed nothing' };
  }
  // The runner prints exactly one JSON object, but npm/node can prepend noise.
  const start = line.indexOf('{');
  if (start === -1) return { ran: false, reason: line.slice(0, 300) };
  let parsed: unknown;
  try {
    parsed = JSON.parse(line.slice(start));
  } catch {
    return { ran: false, reason: `unreadable smoke output: ${line.slice(0, 200)}` };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ran: false, reason: 'smoke output was not an object' };
  }
  const r = parsed as Record<string, unknown>;
  if (r.ran !== true) {
    return { ran: false, reason: typeof r.reason === 'string' ? r.reason : 'the smoke runner did not run' };
  }
  const checks = Array.isArray(r.checks) ? (r.checks as SmokeCheckResult[]) : [];
  const failures = Array.isArray(r.failures) ? (r.failures as string[]) : [];
  return { ran: true, passed: r.passed === true, checks, failures };
}

/** A one-line summary for a build log or a tool result. */
export function describeSmoke(outcome: SmokeOutcome): string {
  if (!outcome.ran) return `Smoke test skipped — ${outcome.reason}`;
  if (outcome.passed) {
    return `Smoke test passed — ${outcome.checks.length} check${outcome.checks.length === 1 ? '' : 's'}, all green.`;
  }
  return `Smoke test FAILED — ${outcome.failures.length} of ${outcome.checks.length} checks:\n${outcome.failures
    .map((f) => `  ✗ ${f}`)
    .join('\n')}`;
}

/**
 * Run the harness against a workspace directory containing index.html.
 *
 * Never throws: every failure path becomes `ran: false`. Registering an app is
 * still worth doing when the check cannot run.
 */
export async function runStaticSmoke(dir: string, checks: SmokeCheck[] = []): Promise<SmokeOutcome> {
  const payload = JSON.stringify(
    checks
      .filter((c) => c && typeof c.script === 'string' && c.script.trim())
      .slice(0, 12)
      .map((c) => ({ description: String(c.description ?? 'unnamed check'), script: c.script })),
  );
  // base64 so a script full of quotes, newlines and backslashes survives the
  // trip through `bash -c` — the same trick execInSandbox uses on its own body.
  const encoded = Buffer.from(payload, 'utf-8').toString('base64');
  // Run the runner by its path INSIDE the repo, never a copy elsewhere:
  // `import('playwright')` resolves from the script's own directory, so the
  // same file in /tmp reports "playwright is not available" on a host that has
  // it. This is also why the check simply skips on homeserv, where builds run
  // in the jkai-sandbox container and the repo is not mounted — production runs
  // with JKAI_BUILDS_HOSTMODE=1, on the host, where both resolve.
  const cmd =
    `cd ${JSON.stringify(process.cwd())} && ` +
    `echo ${encoded} | base64 -d | node scripts/smoke-static-app.mjs ${JSON.stringify(dir)}`;

  try {
    const res = await execInSandbox(cmd, 60_000);
    return parseSmokeOutput(res.stdout, res.stderr);
  } catch (err) {
    return { ran: false, reason: `could not run the smoke harness: ${err instanceof Error ? err.message : String(err)}` };
  }
}
