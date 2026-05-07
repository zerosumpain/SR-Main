// src/lib/curate/generate.ts
//
// Phase 4.1 — generate wrapper.
// Loads the session, calls writeNodeFiles(), installs deps, runs tsc, and
// transitions the session status generating → live-testing (or error).

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { getSession, updateSession } from './session-store';
import { transitionStatus } from './engine';
import { writeNodeFiles } from './codegen/write-files';
import type { NodeSpec, NodeDep } from './spec/types';

const execFileAsync = promisify(execFile);

// ── Public result type ──────────────────────────────────────────────────

export interface GenerateResult {
  written: string[];
  deps: NodeDep[];
}

// ── Injectable exec type (for tests) ───────────────────────────────────

type ExecFn = (cmd: string, args: string[], opts: { cwd: string; timeout: number }) => Promise<{ stdout: string; stderr: string }>;

function defaultExec(cmd: string, args: string[], opts: { cwd: string; timeout: number }): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(cmd, args, opts);
}

// ── Options ─────────────────────────────────────────────────────────────

export interface RunGenerateOpts {
  /** Override the sr-docs directory (for tests). */
  srDocsDir?: string;
  /**
   * Override the exec function that runs npm install + tsc.
   * Tests inject a no-op or a failing stub here.
   */
  exec?: ExecFn;
}

// ── Helpers ─────────────────────────────────────────────────────────────

/** Default sr-docs directory: ~/sr-docs */
function defaultSrDocsDir(): string {
  return path.join(os.homedir(), 'sr-docs');
}

/** Run npm install for the given package specs (e.g. "tsdav@^2.0.0"). */
async function installDeps(packages: string[], cwd: string, exec: ExecFn): Promise<void> {
  await exec('npm', ['install', '--save', '--no-audit', '--no-fund', ...packages], {
    cwd,
    timeout: 5 * 60 * 1000,
  });
}

/** Run tsc --noEmit --skipLibCheck. Returns ok + output regardless of exit. */
async function runTsc(cwd: string, exec: ExecFn): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout, stderr } = await exec('npx', ['tsc', '--noEmit', '--skipLibCheck'], {
      cwd,
      timeout: 2 * 60 * 1000,
    });
    return { ok: true, output: (stdout + stderr).trim() };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    const output = ((e.stdout ?? '') + (e.stderr ?? '')).trim() || (e.message ?? 'tsc failed');
    return { ok: false, output };
  }
}

// ── Log entry type ───────────────────────────────────────────────────────

interface GenerateLogEntry {
  phase: 'generate';
  at: string;
  written: string[];
  depsInstalled: string[];
  tscOk: boolean;
  tscOutput?: string;
  error?: string;
}

// ── runGenerate ──────────────────────────────────────────────────────────

/**
 * Main entry point for Phase 4.1 (generate).
 *
 * 1. Loads the session row → reads nodeSpec.
 * 2. Calls writeNodeFiles() (B2) into the session's worktree + sr-docs dir.
 * 3. If spec.deps non-empty, runs npm install in the worktree.
 * 4. Runs tsc --noEmit --skipLibCheck.
 * 5. Appends a generate entry to iterationLog.
 * 6. Transitions generating → live-testing (or error on tsc failure).
 */
export async function runGenerate(
  sessionId: string,
  opts: RunGenerateOpts = {},
): Promise<GenerateResult> {
  const exec = opts.exec ?? defaultExec;

  // 1. Load session.
  const session = await getSession(sessionId);
  if (!session) throw new Error(`Curate session not found: ${sessionId}`);
  if (!session.nodeSpec) throw new Error(`Session ${sessionId} has no nodeSpec — cannot generate`);
  if (!session.worktreePath) throw new Error(`Session ${sessionId} has no worktreePath`);

  const spec = session.nodeSpec as unknown as NodeSpec;
  const worktreeDir = session.worktreePath;
  const srDocsDir = opts.srDocsDir ?? defaultSrDocsDir();

  const logEntry: GenerateLogEntry = {
    phase: 'generate',
    at: new Date().toISOString(),
    written: [],
    depsInstalled: [],
    tscOk: false,
  };

  try {
    // 2. Write node files via B2's writeNodeFiles.
    const writeResult = await writeNodeFiles(spec, worktreeDir, srDocsDir);
    logEntry.written = writeResult.written;

    // 3. Install deps if spec.deps is non-empty.
    const deps: NodeDep[] = spec.deps ?? [];
    if (deps.length > 0) {
      const pkgSpecs = deps.map((d) => `${d.name}@${d.version}`);
      await installDeps(pkgSpecs, worktreeDir, exec);
      logEntry.depsInstalled = pkgSpecs;
    }

    // 4. Run tsc --noEmit --skipLibCheck.
    const tscResult = await runTsc(worktreeDir, exec);
    logEntry.tscOk = tscResult.ok;
    if (!tscResult.ok) {
      logEntry.tscOutput = tscResult.output;
    }

    // 5. Append log entry.
    const existing = (session.iterationLog ?? []) as unknown[];
    await updateSession(sessionId, {
      iterationLog: [...existing, logEntry],
    });

    if (!tscResult.ok) {
      // tsc failure — surface to error state.
      await transitionStatus(sessionId, 'generating', 'error');
      await updateSession(sessionId, { errorTrace: tscResult.output });
      throw new Error(`tsc check failed:\n${tscResult.output}`);
    }

    // 6. Transition generating → live-testing.
    await transitionStatus(sessionId, 'generating', 'live-testing');

    return { written: writeResult.written, deps };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // Only transition to error if we haven't already done so.
    const current = await getSession(sessionId);
    if (current && current.status === 'generating') {
      logEntry.error = message;
      const existing2 = (current.iterationLog ?? []) as unknown[];
      await updateSession(sessionId, {
        iterationLog: [...existing2, logEntry],
        errorTrace: message,
      });
      await transitionStatus(sessionId, 'generating', 'error');
    }
    throw err;
  }
}
