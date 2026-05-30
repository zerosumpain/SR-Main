import { spawn } from 'node:child_process';

export const NODE_BUILDER_PATH_ALLOWLIST = [
  'src/lib/workflows/nodes/',
  'src/lib/canvas/nodes/panels/',
  'src/lib/workflows/index.ts',
  'package.json',
  'package-lock.json',
] as const;

/**
 * Returns true if `path` is within the codegen-managed allowlist.
 * Directory entries end with '/' and match by prefix; file entries match exactly.
 */
export function isPathAllowed(path: string): boolean {
  return NODE_BUILDER_PATH_ALLOWLIST.some((entry) =>
    entry.endsWith('/') ? path.startsWith(entry) : path === entry,
  );
}

export interface ProcessResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/**
 * Run a command in the repo root and capture stdout/stderr.
 * Always uses `cwd = process.cwd()`. Never throws — returns a result object.
 */
export function runProcess(
  command: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    child.stdout.on('data', (d) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d) => (stderr += d.toString('utf8')));

    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGKILL');
        }, options.timeoutMs)
      : null;

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({
        ok: !timedOut && code === 0,
        stdout,
        stderr: timedOut ? `${stderr}\n(killed after ${options.timeoutMs}ms timeout)` : stderr,
        exitCode: code,
      });
    });
  });
}
