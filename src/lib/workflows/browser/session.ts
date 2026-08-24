import { readFileSync } from 'fs';
import { join } from 'path';
import os from 'os';
import { execInContainer, writeFileInContainer, ensureContainerRunning, getContainerIp } from '$lib/jkai/sandbox';

/**
 * A long-lived headless browser inside jkai-sandbox, on homeserv.
 *
 * Same residential-IP architecture as the scraper (`$lib/workflows/scraper/runner`):
 * the browser runs where the residential IP is, and anywhere else proxies to it.
 * A datacentre IP hits exactly the bot-walls that make browsing useful in the
 * first place.
 *
 * The daemon holds the page between calls, which is the entire reason it is a
 * daemon rather than a one-shot script — `navigate` then `click` then `snapshot`
 * must act on the same page.
 */

const RUNNER_SRC = 'src/lib/workflows/scraper/python/browser-session.py';
const RUNNER_PATH = '/home/jkai/scraper-runtime/browser-session.py';
const BASE_PORT = 7800;
const READY_TIMEOUT_MS = 30_000;

export function isOnHomeserv(): boolean {
  return os.hostname() === 'homeserv';
}

let session: { port: number; startedAt: number } | null = null;
let starting: Promise<number> | null = null;

function runnerSource(): string {
  return readFileSync(join(process.cwd(), RUNNER_SRC), 'utf8');
}

async function probe(port: number): Promise<boolean> {
  try {
    const ip = await getContainerIp();
    const res = await fetch(`http://${ip}:${port}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Start the daemon if it is not already up. Single-flight. */
export async function ensureSession(): Promise<number> {
  if (session && (await probe(session.port))) return session.port;
  if (starting) return starting;

  starting = (async () => {
    await ensureContainerRunning();
    await execInContainer('mkdir -p /home/jkai/scraper-runtime /home/jkai/browser-profile');
    await writeFileInContainer(RUNNER_PATH, runnerSource());

    const port = BASE_PORT;
    // Kill a stale daemon on the same port before claiming it, so a crashed
    // session cannot wedge every later one.
    await execInContainer(`pkill -TERM -f "browser-session.py ${port}" 2>/dev/null || true`);

    // Detached — `execInContainer` waits for the process to exit, and this one
    // is meant to outlive the call. Same reason and same mechanism as
    // `startInteractiveSession` in the scraper.
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    await execAsync(
      `docker exec -d jkai-sandbox bash -lc 'python3 ${RUNNER_PATH} ${port} > /tmp/browser-session.log 2>&1'`,
    );

    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (await probe(port)) {
        session = { port, startedAt: Date.now() };
        return port;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    const log = await execInContainer(`tail -5 /tmp/browser-session.log 2>/dev/null || true`);
    throw new Error(
      `browser session did not become ready in ${READY_TIMEOUT_MS / 1000}s. Last log: ${log.stdout.trim() || '(empty)'}`,
    );
  })().finally(() => {
    starting = null;
  });

  return starting;
}

/** Send one verb to the daemon. */
export async function callVerb(
  verb: string,
  args: Record<string, unknown>,
  timeoutMs = 60_000,
): Promise<Record<string, unknown>> {
  const port = await ensureSession();
  const ip = await getContainerIp();
  const res = await fetch(`http://${ip}:${port}/${verb}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args ?? {}),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    return { ok: false, error: `browser daemon returned ${res.status}` };
  }
  return (await res.json()) as Record<string, unknown>;
}

/** Close the session and free the Chromium. Idempotent. */
export async function closeSession(): Promise<void> {
  if (!session) return;
  try {
    const ip = await getContainerIp();
    await fetch(`http://${ip}:${session.port}/close`, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    /* the daemon may already be gone */
  }
  session = null;
}

/** Test seam. */
export function __resetSessionForTests(): void {
  session = null;
  starting = null;
}
