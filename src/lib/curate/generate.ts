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

/**
 * Run tsc --noEmit --skipLibCheck against the worktree, then filter the
 * output: only fail if errors land in `ourFiles` (the files curate just
 * wrote / patched). Pre-existing repo-wide tsc tech debt — the project's
 * vite build doesn't tsc-check, so unrelated tsc errors have accumulated —
 * gets logged as informational instead of blocking the curate phase.
 */
async function runTsc(
  cwd: string,
  ourFiles: string[],
  exec: ExecFn,
): Promise<{ ok: boolean; output: string }> {
  let raw: string;
  try {
    const { stdout, stderr } = await exec('npx', ['tsc', '--noEmit', '--skipLibCheck'], {
      cwd,
      timeout: 2 * 60 * 1000,
    });
    raw = (stdout + stderr).trim();
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    raw = ((e.stdout ?? '') + (e.stderr ?? '')).trim() || (e.message ?? 'tsc failed');
  }

  // Each tsc error line looks like: `path/to/file.ts(line,col): error TS....`.
  // We split on lines and keep only those naming a path that's in our
  // newly-generated set. If raw contained a non-tsc message (timeout, etc.)
  // and no error lines parse, we surface it as failure to be safe.
  const errorLines = raw.split('\n').filter((l) => /\(\d+,\d+\):\s*error\sTS\d+/.test(l));
  const ours = new Set(ourFiles);
  const ourErrors = errorLines.filter((l) => {
    const fileMatch = l.match(/^([^(]+)\(\d+,\d+\)/);
    return fileMatch ? ours.has(fileMatch[1]) : false;
  });

  if (ourErrors.length > 0) {
    return { ok: false, output: ourErrors.join('\n') };
  }

  if (errorLines.length > 0) {
    return {
      ok: true,
      output:
        `[tsc] ${errorLines.length} pre-existing repo errors (none in newly-generated files). ` +
        `These are tech debt unrelated to this curate session and do not block generate.`,
    };
  }

  // No tsc errors at all — but if `raw` had a non-error fatal message
  // (e.g. command not found, exit-on-init), surface it as failure.
  if (raw && !raw.match(/Found \d+ errors?/i) && !raw.match(/^$/)) {
    // Heuristic: tsc on success is silent; non-empty output without parsed
    // error lines suggests something else went wrong.
    if (raw.length > 0 && raw.toLowerCase().includes('error')) {
      return { ok: false, output: raw };
    }
  }
  return { ok: true, output: raw };
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

    // 4. Run tsc --noEmit --skipLibCheck. Filter errors to only the files
    //    we just wrote; pre-existing repo tech debt doesn't block curate.
    const tscResult = await runTsc(worktreeDir, writeResult.written, exec);
    logEntry.tscOk = tscResult.ok;
    if (tscResult.output) {
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
