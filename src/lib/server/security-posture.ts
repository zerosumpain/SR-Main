/**
 * Security posture for ONE host: SSH configuration, fail2ban state, evidence of
 * actual exposure, and the app's own auth gates.
 *
 * Shaped after hermes-control.ts — shells local commands through execFile with
 * timeouts, exposes typed state, and is consumed by both the page load and the
 * `/api/admin/security` endpoint so the peer host can read it over the same
 * service-auth the Hermes admin surface uses.
 *
 * Everything mutable here is deliberately absent. The panel can lift a fail2ban
 * ban and nothing else: sshd configuration is not editable from a browser, and
 * an allow-list already has its own page. A dashboard that can rewrite the
 * host's auth config is a larger hole than the ones it reports on.
 *
 * All shell reads are best-effort. A missing fail2ban or an unavailable journal
 * yields `null` for that section, never a thrown page load — an admin page that
 * 500s during an incident is worse than one that says "unknown".
 */
import { env } from '$env/dynamic/private';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import { PUBLIC_API_PATHS } from './public-api-paths';

const execFileP = promisify(execFile);

export const HOSTNAME = os.hostname();
export const IS_HOMESERV = HOSTNAME === 'homeserv';

const EXEC_TIMEOUT_MS = 4000;

export interface SshdPosture {
  passwordAuthentication: boolean | null;
  pubkeyAuthentication: boolean | null;
  permitRootLogin: string | null;
  port: string | null;
  maxAuthTries: string | null;
}

export interface Fail2banPosture {
  /** null when fail2ban is not installed or not answering. */
  installed: boolean;
  jail: string;
  currentlyBanned: number;
  totalBanned: number;
  bannedIps: string[];
  /** Networks that can never be banned — the anti-lockout list. */
  ignoreIps: string[];
}

export interface ExposurePosture {
  /** Failed SSH auth attempts in the window. High = internet-reachable. */
  failedAttempts: number;
  distinctSourceIps: number;
  windowHours: number;
}

export interface HostPosture {
  host: string;
  reachable: boolean;
  error?: string;
  sshd: SshdPosture | null;
  fail2ban: Fail2banPosture | null;
  exposure: ExposurePosture | null;
  /** AUTH_BYPASS=1 on a public host is the 2026-07-24 outage. */
  authBypass: boolean;
}

// ---------------------------------------------------------------------------
// Pure parsers. Kept separate from the shelling so they can be unit-tested with
// fixture strings rather than by running sshd on a test box.
// ---------------------------------------------------------------------------

/** Parse `sshd -T` output (lowercased keywords, one `key value` per line). */
export function parseSshd(text: string): SshdPosture {
  const get = (key: string): string | null => {
    const m = text.match(new RegExp(`^${key}\\s+(.+)$`, 'im'));
    return m ? m[1].trim() : null;
  };
  const yesNo = (v: string | null): boolean | null =>
    v === null ? null : v.toLowerCase() === 'yes';
  return {
    passwordAuthentication: yesNo(get('passwordauthentication')),
    pubkeyAuthentication: yesNo(get('pubkeyauthentication')),
    permitRootLogin: get('permitrootlogin'),
    port: get('port'),
    maxAuthTries: get('maxauthtries'),
  };
}

/**
 * Parse `fail2ban-client status <jail>`.
 *
 * The banned list is the whole point of the panel, so it is read from the
 * "Banned IP list:" line rather than inferred from the counter — a count
 * without addresses cannot answer "is that my IP?".
 */
export function parseFail2banStatus(text: string, jail: string): Fail2banPosture {
  const num = (label: string): number => {
    const m = text.match(new RegExp(`${label}:\\s*(\\d+)`, 'i'));
    return m ? Number(m[1]) : 0;
  };
  const listMatch = text.match(/Banned IP list:\s*(.*)$/im);
  const bannedIps = listMatch
    ? listMatch[1].trim().split(/\s+/).filter(Boolean)
    : [];
  return {
    installed: true,
    jail,
    currentlyBanned: num('Currently banned'),
    totalBanned: num('Total banned'),
    bannedIps,
    ignoreIps: [],
  };
}

/** Parse `fail2ban-client get <jail> ignoreip` into bare networks. */
export function parseIgnoreIps(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.replace(/^[|`\s-]+/, '').trim())
    .filter((l) => /^[0-9a-f:.]+(\/\d+)?$/i.test(l) && l.length > 2);
}

/**
 * An IP is only safely un-bannable if it is a real address. Guard the unban
 * action's input rather than passing browser text to a root command — the one
 * mutating path in this module is the one worth being paranoid about.
 */
export function isValidIp(ip: string): boolean {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const m = ip.match(v4);
  if (m) return m.slice(1).every((o) => Number(o) >= 0 && Number(o) <= 255);
  return /^[0-9a-f:]{2,45}$/i.test(ip) && ip.includes(':');
}

// ---------------------------------------------------------------------------
// Host reads
// ---------------------------------------------------------------------------

async function sh(cmd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileP(cmd, args, {
      timeout: EXEC_TIMEOUT_MS,
      // Node defaults maxBuffer to 1MB and THROWS past it. A day of ssh journal
      // on the VPS is 1.35MB, so the exposure read failed there and nowhere
      // else — the panel reported "unknown" on the one host that is actually
      // under attack, which is precisely backwards. The --grep below keeps the
      // real payload to ~50KB; this is the belt to that pair of braces.
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout;
  } catch {
    return null;
  }
}

async function readSshd(): Promise<SshdPosture | null> {
  const out = await sh('sudo', ['-n', 'sshd', '-T']);
  return out ? parseSshd(out) : null;
}

async function readFail2ban(jail = 'sshd'): Promise<Fail2banPosture | null> {
  const status = await sh('sudo', ['-n', 'fail2ban-client', 'status', jail]);
  if (!status) return null;
  const posture = parseFail2banStatus(status, jail);
  const ignore = await sh('sudo', ['-n', 'fail2ban-client', 'get', jail, 'ignoreip']);
  if (ignore) posture.ignoreIps = parseIgnoreIps(ignore);
  return posture;
}

/**
 * Count failed SSH auth attempts. This is the number that decides whether
 * password auth is a real risk on a given host: an internet-reachable port 22
 * is brute-forced constantly, a private one is silent. homeserv measured 0 in
 * seven days while the VPS took 7,914 in three.
 */
const FAILURE_PATTERN = 'Failed password|Invalid user|authentication failure';

/** Pure half of the exposure read, so the counting is testable without a journal. */
export function parseExposure(text: string, windowHours: number): ExposurePosture {
  const failures = text.split('\n').filter((l) => new RegExp(FAILURE_PATTERN, 'i').test(l));
  const ips = new Set<string>();
  for (const line of failures) {
    const m = line.match(/from (\d{1,3}(?:\.\d{1,3}){3})/);
    if (m) ips.add(m[1]);
  }
  return { failedAttempts: failures.length, distinctSourceIps: ips.size, windowHours };
}

async function readExposure(windowHours = 24): Promise<ExposurePosture | null> {
  // Filter in journalctl, not in Node. `-o cat` drops the timestamp/host prefix
  // (the message still carries "from <ip>") and --grep discards the ~96% of
  // lines we do not count: 1.35MB and 161ms becomes 53KB and 81ms on the VPS.
  const out = await sh('sudo', [
    '-n', 'journalctl', '-u', 'ssh',
    '--since', `-${windowHours}h`,
    '--no-pager', '-o', 'cat',
    '--grep', FAILURE_PATTERN,
  ]);
  if (out === null) return null;
  return parseExposure(out, windowHours);
}

/** Posture of the host this process is running on. */
export async function localPosture(): Promise<HostPosture> {
  const [sshd, fail2ban, exposure] = await Promise.all([
    readSshd(),
    readFail2ban(),
    readExposure(),
  ]);
  return {
    host: HOSTNAME,
    reachable: true,
    sshd,
    fail2ban,
    exposure,
    authBypass: env.AUTH_BYPASS === '1',
  };
}

/** Lift a ban. The only mutating operation this module exposes. */
export async function unbanIp(ip: string, jail = 'sshd'): Promise<{ ok: boolean; message: string }> {
  if (!isValidIp(ip)) return { ok: false, message: `not an IP address: ${ip}` };
  const out = await sh('sudo', ['-n', 'fail2ban-client', 'set', jail, 'unbanip', ip]);
  if (out === null) return { ok: false, message: `unban failed for ${ip}` };
  return { ok: true, message: `unbanned ${ip}` };
}

// ---------------------------------------------------------------------------
// App-level gates — host-independent, read straight from the code that enforces
// them so the panel cannot describe a policy the app is not applying.
// ---------------------------------------------------------------------------

export interface AppAccessPosture {
  publicApiPaths: string[];
  ownerEmails: string[];
  guestCount: number;
}

export function publicApiPaths(): string[] {
  return [...PUBLIC_API_PATHS];
}
