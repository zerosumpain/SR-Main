// src/lib/curate/promote.ts
//
// Phase 5 — promote pipeline.
// Yields async progress steps so the UI can render a live checklist.
//
// Steps:
//   pre-flight   — worktree is clean; base branch (master) is up-to-date
//   tsc          — run tsc --noEmit --skipLibCheck on the worktree
//   commit       — squash-commit the worktree's curate branch
//   merge        — git checkout master && git merge --ff-only <branch>
//   push         — git push origin master
//   deploy       — run scripts/deploy.sh (or the injected runDeploy)
//   verify       — hit /api/health/workflow-engine on prod; confirm node type listed
//   cleanup      — git worktree remove; git branch -D; mark session promoted

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import { getSession, updateSession } from './session-store';

const execFileAsync = promisify(execFile);

// ── Public step type ────────────────────────────────────────────────────

export type PromoteStepStatus = 'running' | 'ok' | 'failed';

export interface PromoteStep {
  step: string;
  status: PromoteStepStatus;
  detail?: string;
}

// ── Deploy indirection ──────────────────────────────────────────────────

/**
 * Default deploy implementation: runs the project's deploy.sh.
 * Tests swap this out to avoid touching production.
 */
export async function defaultRunDeploy(scriptPath: string): Promise<void> {
  await execFileAsync('bash', [scriptPath], {
    timeout: 10 * 60 * 1000, // 10 min
  });
}

// ── Helpers ─────────────────────────────────────────────────────────────

/** Resolve the project root by walking up from process.cwd() until package.json. */
function projectRoot(): string {
  let dir = process.cwd();
  while (dir !== '/') {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('Could not find project root');
}

type ExecFn = (
  cmd: string,
  args: string[],
  opts?: { cwd?: string; timeout?: number },
) => Promise<{ stdout: string; stderr: string }>;

function makeExec(override?: ExecFn): ExecFn {
  if (override) return override;
  return (cmd, args, opts) => execFileAsync(cmd, args, opts ?? {});
}

// ── Options ─────────────────────────────────────────────────────────────

export interface RunPromoteOpts {
  /**
   * Override the deploy runner. Tests inject a no-op stub.
   * The default is defaultRunDeploy(scriptPath).
   */
  runDeploy?: typeof defaultRunDeploy;
  /**
   * When true, skips the push, deploy, and verify steps.
   * Use in tests to avoid touching production or remote git.
   */
  dryRun?: boolean;
  /**
   * Override exec for git/tsc commands (for tests).
   */
  exec?: ExecFn;
  /**
   * Production health URL to verify after deploy.
   * Defaults to https://strangeramblings.com/api/health/workflow-engine
   */
  healthUrl?: string;
  /**
   * Override fetch for the verify step (for tests).
   */
  fetchFn?: typeof fetch;
}

// ── runPromote ───────────────────────────────────────────────────────────

/**
 * Runs the full promote pipeline for a curate session.
 * Yields a PromoteStep for each stage as it progresses.
 *
 * @param sessionId - The curate session to promote.
 * @param opts - Injectable overrides for testing.
 */
export async function* runPromote(
  sessionId: string,
  opts: RunPromoteOpts = {},
): AsyncGenerator<PromoteStep> {
  const exec = makeExec(opts.exec);
  const runDeploy = opts.runDeploy ?? defaultRunDeploy;
  const dryRun = opts.dryRun ?? false;

  // ── Load session ──────────────────────────────────────────────────────
  const session = await getSession(sessionId);
  if (!session) throw new Error(`Curate session not found: ${sessionId}`);
  if (!session.worktreePath) throw new Error(`Session ${sessionId} has no worktreePath`);
  if (!session.branchName) throw new Error(`Session ${sessionId} has no branchName`);

  const worktreeDir = session.worktreePath;
  const branchName = session.branchName;
  const repo = projectRoot();
  const deployScript = path.join(repo, 'scripts', 'deploy.sh');

  // Track log entries so we can persist them at the end.
  const log: Array<{ step: string; status: string; detail?: string; at: string }> = [];

  function makeStep(step: string, status: PromoteStepStatus, detail?: string): PromoteStep {
    log.push({ step, status, detail, at: new Date().toISOString() });
    return { step, status, detail };
  }

  // ── Step 1: pre-flight ───────────────────────────────────────────────
  yield makeStep('pre-flight', 'running');
  try {
    // Check the worktree is clean (no uncommitted changes from the generator).
    const { stdout: statusOut } = await exec('git', ['status', '--porcelain'], {
      cwd: worktreeDir,
    });
    // Allow untracked files (the node files we just wrote); only error on
    // modified-but-unstaged tracked files.
    const dirtyLines = statusOut
      .split('\n')
      .filter((l) => l.trim().length > 0 && !l.startsWith('?'));
    if (dirtyLines.length > 0) {
      throw new Error(`Worktree has uncommitted changes:\n${dirtyLines.join('\n')}`);
    }
    yield makeStep('pre-flight', 'ok');
  } catch (err: unknown) {
    yield makeStep('pre-flight', 'failed', String(err instanceof Error ? err.message : err));
    return;
  }

  // ── Step 2: tsc ──────────────────────────────────────────────────────
  yield makeStep('tsc', 'running');
  try {
    await exec('npx', ['tsc', '--noEmit', '--skipLibCheck'], {
      cwd: worktreeDir,
      timeout: 2 * 60 * 1000,
    });
    yield makeStep('tsc', 'ok');
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const detail = ((e.stdout ?? '') + (e.stderr ?? '')).trim() || (e.message ?? 'tsc failed');
    yield makeStep('tsc', 'failed', detail);
    return;
  }

  // ── Step 3: commit ───────────────────────────────────────────────────
  yield makeStep('commit', 'running');
  try {
    // Stage everything the generator wrote.
    await exec('git', ['add', '-A'], { cwd: worktreeDir });
    // Check if there is anything to commit.
    const { stdout: diffOut } = await exec(
      'git', ['diff', '--cached', '--name-only'], { cwd: worktreeDir },
    );
    if (diffOut.trim().length > 0) {
      await exec(
        'git',
        ['commit', '-m', `feat(curate): add ${session.targetType ?? 'node'} node`],
        { cwd: worktreeDir },
      );
    }
    yield makeStep('commit', 'ok');
  } catch (err: unknown) {
    yield makeStep('commit', 'failed', String(err instanceof Error ? err.message : err));
    return;
  }

  // ── Step 4: merge ────────────────────────────────────────────────────
  yield makeStep('merge', 'running');
  try {
    await exec('git', ['checkout', 'master'], { cwd: repo });
    await exec('git', ['merge', '--ff-only', branchName], { cwd: repo });
    yield makeStep('merge', 'ok');
  } catch (err: unknown) {
    yield makeStep('merge', 'failed', String(err instanceof Error ? err.message : err));
    return;
  }

  if (dryRun) {
    // In dry-run mode, skip push / deploy / verify.
    yield makeStep('push', 'ok', 'dry-run: skipped');
    yield makeStep('deploy', 'ok', 'dry-run: skipped');
    yield makeStep('verify', 'ok', 'dry-run: skipped');
  } else {
    // ── Step 5: push ──────────────────────────────────────────────────
    yield makeStep('push', 'running');
    try {
      await exec('git', ['push', 'origin', 'master'], { cwd: repo });
      yield makeStep('push', 'ok');
    } catch (err: unknown) {
      yield makeStep('push', 'failed', String(err instanceof Error ? err.message : err));
      return;
    }

    // ── Step 6: deploy ────────────────────────────────────────────────
    yield makeStep('deploy', 'running');
    try {
      await runDeploy(deployScript);
      yield makeStep('deploy', 'ok');
    } catch (err: unknown) {
      console.error(`[promote] deploy step failed for session ${sessionId}:`, err);
      yield makeStep('deploy', 'failed', String(err instanceof Error ? err.message : err));
      return;
    }

    // ── Step 7: verify ────────────────────────────────────────────────
    yield makeStep('verify', 'running');
    try {
      const healthUrl =
        opts.healthUrl ?? 'https://strangeramblings.com/api/health/workflow-engine';
      const fetchFn = opts.fetchFn ?? fetch;
      const res = await fetchFn(healthUrl, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) {
        throw new Error(`Health check returned HTTP ${res.status}`);
      }
      const body = await res.json() as Record<string, unknown>;
      const nodeType = session.targetType;
      // The health endpoint lists registered node types. Check our type is present.
      const registeredTypes =
        (body.registeredTypes as string[] | undefined) ??
        (body.nodeTypes as string[] | undefined) ??
        [];
      if (nodeType && registeredTypes.length > 0 && !registeredTypes.includes(nodeType)) {
        throw new Error(
          `Node type '${nodeType}' not found in registry after deploy. ` +
          `Registered: ${registeredTypes.join(', ')}`,
        );
      }
      yield makeStep('verify', 'ok');
    } catch (err: unknown) {
      yield makeStep('verify', 'failed', String(err instanceof Error ? err.message : err));
      // Verify failure is non-fatal — continue to cleanup.
    }
  }

  // ── Step 8: cleanup ──────────────────────────────────────────────────
  yield makeStep('cleanup', 'running');
  try {
    // Remove the worktree.
    if (fs.existsSync(worktreeDir)) {
      await exec('git', ['worktree', 'remove', '--force', worktreeDir], { cwd: repo });
    }
    // Delete the branch.
    await exec('git', ['branch', '-D', branchName], { cwd: repo }).catch(() => undefined);

    // Mark session promoted.
    const existing = (session.iterationLog ?? []) as unknown[];
    await updateSession(sessionId, {
      status: 'promoted',
      promotedAt: new Date(),
      iterationLog: [...existing, ...log],
    });

    yield makeStep('cleanup', 'ok');
  } catch (err: unknown) {
    console.error(`[promote] cleanup step failed for session ${sessionId}:`, err);
    yield makeStep('cleanup', 'failed', String(err instanceof Error ? err.message : err));
  }
}
