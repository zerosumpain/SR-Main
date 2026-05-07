import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

interface SpawnOpts {
  cwd: string;
  port: number;
  /** Optional: per-session log file. Defaults to <cwd>/.curate-devserver.log */
  logFile?: string;
}

export interface DevServerHandle {
  pid: number;
  port: number;
  cwd: string;
  logFile: string;
  child: ChildProcess;
  /** Wait for the dev server to start serving (polls /). Throws on timeout. */
  waitReady: (timeoutMs?: number) => Promise<void>;
  /** Send SIGTERM, then SIGKILL after a grace period. */
  kill: () => Promise<void>;
}

export function spawnDevServer(opts: SpawnOpts): DevServerHandle {
  const logFile = opts.logFile ?? path.join(opts.cwd, '.curate-devserver.log');
  const fd = fs.openSync(logFile, 'a');
  const child = spawn('npm', ['run', 'dev', '--', '--port', String(opts.port)], {
    cwd: opts.cwd,
    stdio: ['ignore', fd, fd],
    detached: false,
    env: { ...process.env, NODE_ENV: 'development' },
  });
  if (!child.pid) {
    fs.closeSync(fd);
    throw new Error('Failed to spawn dev server (no PID)');
  }

  return {
    pid: child.pid,
    port: opts.port,
    cwd: opts.cwd,
    logFile,
    child,
    async waitReady(timeoutMs = 60_000): Promise<void> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        try {
          const res = await fetch(`http://localhost:${opts.port}/`, { redirect: 'manual' });
          // 200 or any 3xx redirect both indicate server is alive.
          if (res.status >= 200 && res.status < 500) return;
        } catch { /* not ready */ }
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error(`Dev server on port ${opts.port} did not become ready within ${timeoutMs}ms`);
    },
    async kill(): Promise<void> {
      child.kill('SIGTERM');
      const exited = await new Promise<boolean>((resolve) => {
        let done = false;
        child.once('exit', () => { done = true; resolve(true); });
        setTimeout(() => { if (!done) resolve(false); }, 5_000);
      });
      if (!exited) child.kill('SIGKILL');
    },
  };
}

/** Best-effort kill by PID (e.g. recovering after a server-process crash). */
export async function killDevServerByPid(pid: number): Promise<void> {
  try { process.kill(pid, 'SIGTERM'); } catch { return; }
  await new Promise((r) => setTimeout(r, 5_000));
  try { process.kill(pid, 0); /* still alive */ process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
}
