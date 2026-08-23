/**
 * Homeserv-local WhatsApp bridge control: status, re-pairing, reset.
 *
 * Why this exists. WhatsApp reaches the site through the Hermes Baileys bridge
 * (`scripts/whatsapp-bridge/bridge.js`), which Hermes spawns as a child. When
 * WhatsApp logs the linked device out, the bridge exits and the session
 * directory is left unusable — and Hermes' own pre-flight then refuses to start
 * the bridge at all ("enabled but not paired"). At that point *no restart of
 * anything fixes it*: the account has to be re-linked by scanning a QR. Before
 * this module the only way to do that was a terminal on homeserv, which is
 * exactly where you are not when you notice the outage.
 *
 * Everything here shells out locally (systemctl, node, the session directory),
 * so it only works on homeserv. The VPS reaches it through the proxy in
 * hermes-remote.ts — same host switch as hermes-control.ts.
 *
 * Two traps encoded here, both learned the hard way:
 *   1. `GET /messages` on the bridge DRAINS the queue. Only ever probe
 *      `/health`, which is read-only.
 *   2. Hermes spawns the bridge with `os.setsid`, so `systemctl --user stop`
 *      leaves it running and still writing the session directory. A second
 *      bridge against the same session is how ratchet state diverges — so every
 *      restart here kills the orphan first and confirms the port is free.
 */
import { env } from '$env/dynamic/private';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import QRCode from 'qrcode';
import { HERMES_HOME, type ServiceState } from './hermes-control';

const execFileP = promisify(execFile);

const HERMES_AGENT_DIR = env.HERMES_AGENT_DIR ?? '/home/john/hermes-agent';
const BRIDGE_SCRIPT = path.join(HERMES_AGENT_DIR, 'scripts/whatsapp-bridge/bridge.js');
const GATEWAY_UNIT = 'jkai-hermes.service';
const BRIDGE_PORT = Number(env.WHATSAPP_BRIDGE_PORT ?? 3000);
/** Local probe only. Never the delegated URL — that may point at another host. */
const LOCAL_BRIDGE = `http://127.0.0.1:${BRIDGE_PORT}`;

/** A QR is only good for ~20s before WhatsApp rotates it. */
const PAIR_TIMEOUT_MS = 4 * 60_000;

// ---------------------------------------------------------------------------
// Session directory
// ---------------------------------------------------------------------------

/**
 * Mirror of Hermes' `get_hermes_dir("platforms/whatsapp/session",
 * "whatsapp/session")`: the legacy location wins ONLY if it exists and is
 * non-empty, otherwise the consolidated `platforms/` layout is canonical.
 *
 * This is load-bearing, not cosmetic. Pairing into the wrong one writes a
 * perfectly valid session that Hermes will never look at, and the page would
 * report success while WhatsApp stayed dark.
 */
export async function resolveSessionDir(home: string = HERMES_HOME): Promise<{ dir: string; legacy: boolean }> {
  const legacyDir = path.join(home, 'whatsapp/session');
  try {
    const entries = await fs.readdir(legacyDir);
    if (entries.length > 0) return { dir: legacyDir, legacy: true };
  } catch {
    // Absent legacy dir is the normal, current case.
  }
  return { dir: path.join(home, 'platforms/whatsapp/session'), legacy: false };
}

/** The number this session is linked to, read from Baileys' own creds.json. */
async function readPairedIdentity(
  sessionDir: string,
): Promise<{ paired: boolean; number: string | null; name: string | null; pairedAt: string | null }> {
  const credsPath = path.join(sessionDir, 'creds.json');
  try {
    const [raw, stat] = await Promise.all([fs.readFile(credsPath, 'utf8'), fs.stat(credsPath)]);
    const creds = JSON.parse(raw) as { me?: { id?: string; name?: string } };
    // Baileys stores "<phone>:<device>@s.whatsapp.net" — the device suffix is
    // noise here, and a LID-form id has no phone number in it at all.
    const id = creds.me?.id ?? null;
    const number = id ? (id.split('@')[0].split(':')[0] || null) : null;
    return {
      paired: true,
      number,
      name: creds.me?.name ?? null,
      pairedAt: stat.mtime.toISOString(),
    };
  } catch {
    return { paired: false, number: null, name: null, pairedAt: null };
  }
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export interface WhatsAppBridgeStatus {
  host: string;
  sessionDir: string;
  legacyLayout: boolean;
  paired: boolean;
  pairedNumber: string | null;
  pairedName: string | null;
  pairedAt: string | null;
  bridgeReachable: boolean;
  /** Baileys' own connection state, straight from /health. */
  bridgeState: string | null;
  bridgeUptimeSec: number | null;
  bridgeQueueLength: number | null;
  bridgeProcessPid: number | null;
  gateway: ServiceState;
  /** Last few lines of the bridge's log, newest last. */
  logTail: string[];
  loggedOutMarker: boolean;
  /** One plain sentence naming the actual fault. */
  diagnosis: string;
  /** What would actually fix it — drives which button the page recommends. */
  remedy: 'none' | 'pair' | 'restart' | 'start_gateway';
  checkedAt: string;
}

async function bridgeHealth(): Promise<{
  ok: boolean;
  status?: string;
  uptime?: number;
  queueLength?: number;
} | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 2500);
  try {
    // /health only. /messages would drain the inbound queue.
    const res = await fetch(`${LOCAL_BRIDGE}/health`, { signal: ctrl.signal });
    if (!res.ok) return null;
    return { ok: true, ...((await res.json()) as Record<string, never>) };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** PID of the running bridge, or null. Matches the node process, not a shell. */
async function bridgePid(): Promise<number | null> {
  try {
    const { stdout } = await execFileP('pgrep', ['-f', 'node.*bridge\\.js'], { timeout: 3000 });
    const pid = Number(stdout.trim().split('\n')[0]);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null; // pgrep exits 1 when nothing matches
  }
}

async function serviceState(unit: string): Promise<ServiceState> {
  try {
    const { stdout } = await execFileP('systemctl', ['--user', 'is-active', unit], { timeout: 3000 });
    return stdout.trim() as ServiceState;
  } catch (err) {
    const out = (err as { stdout?: string }).stdout?.trim();
    return (out as ServiceState) || 'unknown';
  }
}

/** Bridge log lives beside the session directory, per the adapter. */
async function readLogTail(sessionDir: string, lines = 12): Promise<{ tail: string[]; loggedOut: boolean }> {
  const candidates = [
    path.join(path.dirname(sessionDir), 'bridge.log'),
    path.join(HERMES_HOME, 'whatsapp/bridge.log'),
  ];
  for (const file of candidates) {
    try {
      // tail -c keeps this cheap: bridge.log runs to megabytes.
      const { stdout } = await execFileP('tail', ['-c', '20000', file], {
        timeout: 4000,
        maxBuffer: 1024 * 64,
      });
      const clean = stdout.replace(/\0/g, '');
      const all = clean.split('\n').filter((l) => l.trim().length > 0);
      return {
        tail: all.slice(-lines),
        loggedOut: /Logged out\./i.test(all.slice(-40).join('\n')),
      };
    } catch {
      // try the next candidate
    }
  }
  return { tail: [], loggedOut: false };
}

export interface DiagnoseInput {
  paired: boolean;
  number: string | null;
  loggedOut: boolean;
  gateway: ServiceState;
  healthy: boolean;
  bridgeState: string | null;
  pid: number | null;
  sessionDir: string;
}

/**
 * Turn the observations into one fault and one remedy.
 *
 * Order is the whole point: report the fault furthest UPSTREAM. The old probe
 * saw "bridge unreachable" and always advised "restart jkai-hermes", which is
 * useless against a logged-out session — Hermes will not even start a bridge
 * without credentials, so the restart succeeds and nothing changes. Pure and
 * exported so that ordering is pinned by tests rather than by hope.
 */
export function diagnose(o: DiagnoseInput): {
  diagnosis: string;
  remedy: WhatsAppBridgeStatus['remedy'];
} {
  if (!o.paired) {
    return {
      diagnosis: o.loggedOut
        ? 'WhatsApp logged this device out and the session credentials are gone. Re-pairing is the only fix — a restart will not bring it back.'
        : `No WhatsApp session on disk (no creds.json in ${o.sessionDir}). The bridge cannot start until the account is linked.`,
      remedy: 'pair',
    };
  }
  if (o.gateway !== 'active') {
    return {
      diagnosis: `Session is paired, but the Hermes gateway is ${o.gateway} — nothing is running the bridge.`,
      remedy: 'start_gateway',
    };
  }
  if (!o.healthy) {
    return {
      diagnosis: o.pid
        ? `A bridge process is running (pid ${o.pid}) but ${LOCAL_BRIDGE}/health does not answer — it is wedged.`
        : 'Session is paired and Hermes is up, but no bridge process is running.',
      remedy: 'restart',
    };
  }
  if (o.bridgeState && o.bridgeState !== 'connected') {
    return {
      diagnosis: `Bridge is up but WhatsApp reports "${o.bridgeState}".`,
      remedy: 'restart',
    };
  }
  return {
    diagnosis: o.number ? `Connected as ${o.number}.` : 'Connected.',
    remedy: 'none',
  };
}

export async function getWhatsAppStatus(): Promise<WhatsAppBridgeStatus> {
  const { dir: sessionDir, legacy } = await resolveSessionDir();
  const [identity, health, pid, gateway, log] = await Promise.all([
    readPairedIdentity(sessionDir),
    bridgeHealth(),
    bridgePid(),
    serviceState(GATEWAY_UNIT),
    readLogTail(sessionDir),
  ]);

  const { diagnosis, remedy } = diagnose({
    paired: identity.paired,
    number: identity.number,
    loggedOut: log.loggedOut,
    gateway,
    healthy: !!health,
    bridgeState: health?.status ?? null,
    pid,
    sessionDir,
  });

  return {
    host: os.hostname(),
    sessionDir,
    legacyLayout: legacy,
    paired: identity.paired,
    pairedNumber: identity.number,
    pairedName: identity.name,
    pairedAt: identity.pairedAt,
    bridgeReachable: !!health,
    bridgeState: health?.status ?? null,
    bridgeUptimeSec: health?.uptime ?? null,
    bridgeQueueLength: health?.queueLength ?? null,
    bridgeProcessPid: pid,
    gateway,
    logTail: log.tail,
    loggedOutMarker: log.loggedOut,
    diagnosis,
    remedy,
    checkedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Pairing
//
// `bridge.js --pair-only --pair-json` is Hermes' own supported pairing path: it
// connects, emits one NDJSON event per QR rotation, writes creds on success and
// exits. We drive it into a STAGING directory and only swap it over the live
// session once WhatsApp has confirmed the link — a half-written session is
// worse than no session, because Hermes' pre-flight sees creds.json and starts
// a bridge that cannot authenticate.
// ---------------------------------------------------------------------------

export type PairPhase =
  | 'idle'
  | 'starting'
  | 'awaiting_scan'
  | 'linking'
  | 'installing'
  | 'connected'
  | 'error'
  | 'cancelled';

export interface PairState {
  phase: PairPhase;
  /** Inline SVG of the current QR. Rendered here so the page needs no QR lib. */
  qrSvg: string | null;
  qrIssuedAt: string | null;
  /** How many QRs have been issued — the page uses it to show rotation. */
  qrCount: number;
  message: string;
  startedAt: string | null;
  expiresAt: string | null;
  pairedNumber: string | null;
  log: string[];
}

interface PairSession extends PairState {
  child: ChildProcess | null;
  stagingDir: string;
  liveDir: string;
  timer: NodeJS.Timeout | null;
}

let session: PairSession | null = null;

function publicState(s: PairSession | null): PairState {
  if (!s) {
    return {
      phase: 'idle',
      qrSvg: null,
      qrIssuedAt: null,
      qrCount: 0,
      message: 'No pairing in progress.',
      startedAt: null,
      expiresAt: null,
      pairedNumber: null,
      log: [],
    };
  }
  const { child: _c, stagingDir: _s, liveDir: _l, timer: _t, ...rest } = s;
  return rest;
}

function note(s: PairSession, line: string): void {
  s.log = [...s.log, `${new Date().toISOString().slice(11, 19)} ${line}`].slice(-40);
}

/** WhatsApp settings live in Hermes' env, not ours. Pair with the same config
 *  the real bridge runs with, or the link is made under different rules. */
async function whatsappEnv(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  try {
    const raw = await fs.readFile(path.join(HERMES_HOME, '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = /^\s*(WHATSAPP_[A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    // No Hermes .env — the bridge falls back to its own defaults.
  }
  return out;
}

async function killOrphanBridge(): Promise<void> {
  // Hermes spawns the bridge with os.setsid, so stopping the unit orphans it.
  // Two bridges sharing one session directory is how the Signal ratchet state
  // diverges, so this is not optional.
  try {
    await execFileP('pkill', ['-f', 'node.*bridge\\.js'], { timeout: 5000 });
  } catch {
    // exit 1 = nothing matched, which is the good case
  }
}

function endSession(phase: PairPhase, message: string): void {
  if (!session) return;
  if (session.timer) clearTimeout(session.timer);
  session.timer = null;
  try {
    session.child?.kill('SIGTERM');
  } catch {
    // already gone
  }
  session.child = null;
  session.phase = phase;
  session.message = message;
}

export async function getPairState(): Promise<PairState> {
  return publicState(session);
}

export async function startPairing(): Promise<PairState> {
  if (session && ['starting', 'awaiting_scan', 'linking', 'installing'].includes(session.phase)) {
    return publicState(session);
  }

  const { dir: liveDir } = await resolveSessionDir();
  const stagingDir = `${liveDir}.pairing`;

  await fs.rm(stagingDir, { recursive: true, force: true });
  await fs.mkdir(stagingDir, { recursive: true });

  // A stale bridge holding the account open makes the new link fail in a way
  // that looks like "the QR just doesn't work".
  await killOrphanBridge();

  const wa = await whatsappEnv();
  const s: PairSession = {
    phase: 'starting',
    qrSvg: null,
    qrIssuedAt: null,
    qrCount: 0,
    message: 'Starting the pairing bridge…',
    startedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + PAIR_TIMEOUT_MS).toISOString(),
    pairedNumber: null,
    log: [],
    child: null,
    stagingDir,
    liveDir,
    timer: null,
  };
  session = s;
  note(s, `staging ${stagingDir}`);

  const child = spawn(
    // process.execPath is this server's own node — always present and correct,
    // unlike `node` on a systemd unit's minimal PATH.
    process.execPath,
    [BRIDGE_SCRIPT, '--pair-only', '--pair-json', '--session', stagingDir, '--mode', wa.WHATSAPP_MODE ?? 'bot'],
    { env: { ...process.env, ...wa }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  s.child = child;

  let buf = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    buf += chunk.toString();
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      void handlePairEvent(s, line.trim());
    }
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString().trim();
    if (text) note(s, `stderr: ${text.slice(0, 200)}`);
  });
  child.on('error', (err) => {
    note(s, `spawn failed: ${err.message}`);
    endSession('error', `Could not start the pairing bridge: ${err.message}`);
  });
  child.on('exit', (code) => {
    // Exit 0 after a successful link is expected — the installer takes over.
    if (s.phase === 'awaiting_scan' || s.phase === 'starting') {
      endSession('error', `The pairing bridge exited (code ${code}) before the link completed.`);
    }
  });

  s.timer = setTimeout(() => {
    if (session === s && ['starting', 'awaiting_scan'].includes(s.phase)) {
      void cancelPairing('Timed out waiting for the QR to be scanned.');
    }
  }, PAIR_TIMEOUT_MS);

  return publicState(s);
}

async function handlePairEvent(s: PairSession, line: string): Promise<void> {
  let evt: { event?: string; qr?: string; error?: string; user?: { id?: string } };
  try {
    evt = JSON.parse(line) as typeof evt;
  } catch {
    note(s, line.slice(0, 200));
    return;
  }

  switch (evt.event) {
    case 'started':
      note(s, 'pairing bridge started');
      break;
    case 'qr': {
      if (!evt.qr) break;
      s.qrCount += 1;
      s.qrIssuedAt = new Date().toISOString();
      s.phase = 'awaiting_scan';
      s.message = 'Scan this with WhatsApp → Settings → Linked devices → Link a device.';
      try {
        // Rendered server-side: the page stays a plain image, no client lib and
        // no raw pairing payload sitting in the DOM as text.
        s.qrSvg = await QRCode.toString(evt.qr, { type: 'svg', margin: 1, width: 320 });
      } catch (err) {
        note(s, `QR render failed: ${(err as Error).message}`);
      }
      note(s, `QR #${s.qrCount} issued`);
      break;
    }
    case 'connected': {
      s.phase = 'linking';
      s.qrSvg = null;
      s.pairedNumber = evt.user?.id ? evt.user.id.split('@')[0].split(':')[0] : null;
      s.message = 'Linked. Installing the session and restarting Hermes…';
      note(s, `linked as ${s.pairedNumber ?? 'unknown'}`);
      void installSession(s);
      break;
    }
    case 'error':
      note(s, `bridge error: ${evt.error}`);
      endSession(
        'error',
        evt.error === 'logged_out'
          ? 'WhatsApp rejected the link (logged out). Try again from the phone.'
          : `Pairing failed: ${evt.error ?? 'unknown error'}`,
      );
      break;
    case 'disconnected':
      note(s, 'bridge disconnected, retrying');
      break;
    default:
      note(s, line.slice(0, 200));
  }
}

/**
 * Swap the freshly-paired staging session over the live one and bring Hermes
 * back. The old session is archived rather than deleted — the 2026-08-01
 * incident was diagnosed from a quarantined session directory.
 */
async function installSession(s: PairSession): Promise<void> {
  try {
    s.phase = 'installing';

    // Let Baileys flush creds.json before we move the directory out from
    // under it; the bridge exits ~2s after reporting `connected`.
    await new Promise((r) => setTimeout(r, 3000));

    const creds = path.join(s.stagingDir, 'creds.json');
    await fs.access(creds).catch(() => {
      throw new Error('pairing finished but no creds.json was written');
    });

    await execFileP('systemctl', ['--user', 'stop', GATEWAY_UNIT], { timeout: 60_000 }).catch(() => {});
    await killOrphanBridge();
    note(s, 'gateway stopped');

    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
    const archive = path.join(path.dirname(s.liveDir), `session-replaced-${stamp}`);
    try {
      await fs.rename(s.liveDir, archive);
      note(s, `previous session archived to ${archive}`);
    } catch {
      // No live session to archive — the normal case after a logout.
    }

    await fs.mkdir(path.dirname(s.liveDir), { recursive: true });
    await fs.rename(s.stagingDir, s.liveDir);
    note(s, `session installed at ${s.liveDir}`);

    await execFileP('systemctl', ['--user', 'start', GATEWAY_UNIT], { timeout: 120_000 });
    note(s, 'gateway started');

    // Prove it, rather than assuming: Hermes has to spawn the bridge and the
    // bridge has to reach WhatsApp before this is actually fixed.
    const ok = await waitForBridge(60_000);
    if (ok) {
      s.phase = 'connected';
      s.message = s.pairedNumber
        ? `WhatsApp reconnected as ${s.pairedNumber}.`
        : 'WhatsApp reconnected.';
      note(s, 'bridge answered /health — connected');
    } else {
      s.phase = 'error';
      s.message =
        'Session installed and Hermes restarted, but the bridge has not answered yet. Give it a minute and re-check.';
      note(s, 'bridge did not answer /health in time');
    }
  } catch (err) {
    s.phase = 'error';
    s.message = `Install failed: ${(err as Error).message}`;
    note(s, s.message);
  } finally {
    if (s.timer) clearTimeout(s.timer);
    s.timer = null;
    s.child = null;
  }
}

/** Poll /health (never /messages) until the bridge reports connected. */
async function waitForBridge(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const h = await bridgeHealth();
    if (h && (!h.status || h.status === 'connected')) return true;
    await new Promise((r) => setTimeout(r, 2500));
  }
  return false;
}

export async function cancelPairing(reason = 'Cancelled.'): Promise<PairState> {
  if (!session) return publicState(null);
  const staging = session.stagingDir;
  endSession('cancelled', reason);
  await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
  return publicState(session);
}

// ---------------------------------------------------------------------------
// Repair actions
// ---------------------------------------------------------------------------

export const WHATSAPP_ACTIONS = ['restart_bridge', 'reset_session'] as const;
export type WhatsAppAction = (typeof WHATSAPP_ACTIONS)[number];
export function isWhatsAppAction(a: unknown): a is WhatsAppAction {
  return typeof a === 'string' && (WHATSAPP_ACTIONS as readonly string[]).includes(a);
}

export interface WhatsAppActionResult {
  action: string;
  ok: boolean;
  message: string;
  durationMs: number;
}

export async function runWhatsAppAction(action: WhatsAppAction): Promise<WhatsAppActionResult> {
  const started = Date.now();
  const done = (ok: boolean, message: string): WhatsAppActionResult => ({
    action,
    ok,
    message,
    durationMs: Date.now() - started,
  });

  try {
    if (action === 'restart_bridge') {
      await killOrphanBridge();
      await execFileP('systemctl', ['--user', 'restart', GATEWAY_UNIT], { timeout: 180_000 });
      const ok = await waitForBridge(60_000);
      return ok
        ? done(true, 'Bridge restarted and answering.')
        : done(false, 'Hermes restarted but the bridge has not come back — check whether the session is still paired.');
    }

    // reset_session: archive the credentials so the next pairing starts clean.
    // Archived, never deleted — a dead session is the only evidence of how it died.
    const { dir } = await resolveSessionDir();
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
    const archive = path.join(path.dirname(dir), `session-unlinked-${stamp}`);
    try {
      await fs.rename(dir, archive);
    } catch {
      return done(false, 'There was no session to unlink.');
    }
    await killOrphanBridge();
    await execFileP('systemctl', ['--user', 'restart', GATEWAY_UNIT], { timeout: 180_000 }).catch(() => {});
    return done(true, `Session unlinked and archived to ${archive}. Pair again to reconnect.`);
  } catch (err) {
    return done(false, (err as Error).message);
  }
}
