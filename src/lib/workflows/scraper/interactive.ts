import { readFileSync } from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { join } from 'path';
import { ensureSandboxRunning, execInSandbox, writeFileInSandbox } from '$lib/jkai/sandbox';
import { normalizeProfileName } from './profiles';

function assertRunningOnHomeserv(): void {
  if (process.env.NODE_ENV !== 'production') return;
  if (process.env.SCRAPER_ALLOW_NON_HOMESERV) return;
  const host = os.hostname();
  if (host !== 'homeserv') {
    throw new Error(
      `Interactive sessions require homeserv (no jkai-sandbox or VNC port range on host '${host}').`,
    );
  }
}

const PORT_RANGE_START = 7900;
const PORT_RANGE_END = 7909;     // inclusive — matches docker run -p 7900-7909:7900-7909
const DISPLAY_RANGE_START = 99;
const SESSION_TTL_MS = 15 * 60 * 1000;   // 15 min max per session

const INTERACTIVE_PY_PATH = '/home/jkai/scraper-runtime/interactive.py';
const INTERACTIVE_SH_PATH = '/home/jkai/scraper-runtime/interactive-session.sh';

interface Session {
  id: string;                // crypto.randomUUID()
  profile: string;           // normalised
  url: string;
  wsPort: number;            // 7900-7909
  displayNum: number;
  vncPort: number;           // internal, not exposed
  startedAt: number;
  expiresAt: number;
}

const sessions = new Map<string, Session>();   // id → session

export interface InteractiveStartResult {
  sessionId: string;
  wsPort: number;
  vncUrl: string;            // e.g. /vnc.html?autoconnect=1&resize=scale — relative; client prefixes with host:port
  expiresAt: string;         // ISO
}

function runnerSource(relPath: string): string {
  const here = fileURLToPath(new URL(`./python/${relPath}`, import.meta.url));
  try { return readFileSync(here, 'utf8'); }
  catch { return readFileSync(join(process.cwd(), `src/lib/workflows/scraper/python/${relPath}`), 'utf8'); }
}

export async function startInteractiveSession(profile: string, url: string): Promise<InteractiveStartResult> {
  assertRunningOnHomeserv();
  await ensureSandboxRunning();

  // Find a free slot (port + display).
  const usedPorts = new Set(Array.from(sessions.values()).map(s => s.wsPort));
  const usedDisplays = new Set(Array.from(sessions.values()).map(s => s.displayNum));

  let wsPort = 0, displayNum = 0;
  for (let p = PORT_RANGE_START; p <= PORT_RANGE_END; p++) {
    if (!usedPorts.has(p)) { wsPort = p; break; }
  }
  for (let d = DISPLAY_RANGE_START; d < DISPLAY_RANGE_START + 20; d++) {
    if (!usedDisplays.has(d)) { displayNum = d; break; }
  }
  if (!wsPort || !displayNum) {
    throw new Error('No free interactive-session slots — stop existing sessions first');
  }

  const vncPort = 5900 + displayNum;   // convention: 5900 + display

  // Write runners into the sandbox (idempotent; also ensures fresh content).
  await execInSandbox('mkdir -p /home/jkai/scraper-runtime');
  await writeFileInSandbox(INTERACTIVE_PY_PATH, runnerSource('interactive.py'));
  await writeFileInSandbox(INTERACTIVE_SH_PATH, runnerSource('interactive-session.sh'));
  await execInSandbox(`chmod +x ${INTERACTIVE_SH_PATH}`);

  const normalizedProfile = normalizeProfileName(profile);

  // Launch detached — returns immediately, process persists until SIGTERM.
  // We can't use plain execInSandbox here because it blocks. Use `docker exec -d`.
  const safeUrl = url.replace(/'/g, "'\\''");
  const cmd = `docker exec -d jkai-sandbox bash ${INTERACTIVE_SH_PATH} '${normalizedProfile}' ${displayNum} ${vncPort} ${wsPort} '${safeUrl}'`;
  // We're calling docker from the host (the backend), not from inside the sandbox.
  // Use child_process.exec for this single call.
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);
  await execAsync(cmd);

  const id = crypto.randomUUID();
  const now = Date.now();
  const session: Session = {
    id,
    profile: normalizedProfile,
    url,
    wsPort,
    displayNum,
    vncPort,
    startedAt: now,
    expiresAt: now + SESSION_TTL_MS,
  };
  sessions.set(id, session);

  // Best-effort: verify noVNC came up within ~10s. If not, kill and report.
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500));
    try {
      const res = await fetch(`http://localhost:${wsPort}/vnc.html`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) break;
    } catch {}
    if (i === 19) {
      await stopInteractiveSession(id).catch(() => {});
      throw new Error(`Interactive session failed to start within 10s (profile=${normalizedProfile} ws=${wsPort})`);
    }
  }

  return {
    sessionId: id,
    wsPort,
    vncUrl: `https://vnc.strangeramblings.com/${wsPort}/vnc.html?autoconnect=1&resize=scale`,
    expiresAt: new Date(session.expiresAt).toISOString(),
  };
}

export async function stopInteractiveSession(id: string): Promise<void> {
  const s = sessions.get(id);
  if (!s) return;
  sessions.delete(id);
  // Kill the session by SIGTERMing the python PID file. The bash wrapper's cleanup
  // will propagate to websockify, x11vnc, and Xvfb.
  const pidFile = `/tmp/scraper-sessions/${s.profile}-${s.displayNum}/python.pid`;
  await execInSandbox(`[ -f ${pidFile} ] && kill -TERM $(cat ${pidFile}) 2>/dev/null || true`);
  // Give it ~2s to flush profile data, then force-kill anything lingering.
  await new Promise(r => setTimeout(r, 2000));
  await execInSandbox(`pkill -TERM -f "interactive-session.sh ${s.profile} ${s.displayNum}" 2>/dev/null || true`);
}

export function listInteractiveSessions(): Array<{
  id: string; profile: string; wsPort: number; vncUrl: string; startedAt: string; expiresAt: string; url: string;
}> {
  return Array.from(sessions.values()).map(s => ({
    id: s.id,
    profile: s.profile,
    wsPort: s.wsPort,
    vncUrl: `https://vnc.strangeramblings.com/${s.wsPort}/vnc.html?autoconnect=1&resize=scale`,
    url: s.url,
    startedAt: new Date(s.startedAt).toISOString(),
    expiresAt: new Date(s.expiresAt).toISOString(),
  }));
}

// Periodic cleanup of expired sessions.
setInterval(() => {
  const now = Date.now();
  for (const s of sessions.values()) {
    if (now > s.expiresAt) {
      stopInteractiveSession(s.id).catch(() => {});
    }
  }
}, 60_000).unref?.();
