/**
 * Homeserv-local Hermes control surface: gateway health, systemd service state,
 * version, curator status, and the restart/update actions. Extracted from
 * routes/admin/ops/engine/+page.server.ts so the `/api/admin/hermes/{status,service}`
 * proxy endpoints and the page share one implementation.
 *
 * Everything here shells the local `hermes` CLI / systemctl / gateway socket, so
 * it only does anything useful on homeserv. The VPS reaches it via the proxy
 * (hermes-remote.ts), never by importing these directly into a page load.
 */
import { env } from '$env/dynamic/private';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';

const execFileP = promisify(execFile);

export const HERMES_HOME = env.HERMES_HOME ?? '/home/john/.hermes-jkai';
export const HERMES_BIN = '/home/john/.local/bin/hermes';
const HERMES_URL = env.HERMES_PLATFORM_URL ?? 'http://127.0.0.1:18790';
const HEALTH_TIMEOUT_MS = 1500;
const GATEWAY_UNIT = 'jkai-hermes.service';
const DASHBOARD_UNIT = 'jkai-hermes-dashboard.service';
export const IS_HOMESERV = os.hostname() === 'homeserv';

export type HealthPayload = { ok: boolean; ts: number } | null;
export type ServiceState = 'active' | 'inactive' | 'failed' | 'activating' | 'unknown';
export interface ActionResult {
  action: string;
  ok: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
  exitCode: number | null;
}
export interface HermesStatus {
  health: HealthPayload;
  services: { gateway: ServiceState; dashboard: ServiceState };
  version: string | null;
  curator: string | null;
}

export const SERVICE_ACTIONS = [
  'restart_gateway',
  'restart_dashboard',
  'restart_all',
  'update_check',
  'update_hermes',
] as const;
export type ServiceAction = (typeof SERVICE_ACTIONS)[number];
export function isServiceAction(a: unknown): a is ServiceAction {
  return typeof a === 'string' && (SERVICE_ACTIONS as readonly string[]).includes(a);
}

async function probeHealth(): Promise<HealthPayload> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), HEALTH_TIMEOUT_MS);
  try {
    const res = await fetch(`${HERMES_URL}/platforms/jkai/health`, { signal: ctrl.signal });
    if (!res.ok) return null;
    const body = (await res.json()) as { ok?: boolean; ts?: number };
    if (typeof body?.ok !== 'boolean' || typeof body?.ts !== 'number') return null;
    return { ok: body.ok, ts: body.ts };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function serviceState(unit: string): Promise<ServiceState> {
  if (!IS_HOMESERV) return 'unknown';
  try {
    const { stdout } = await execFileP('systemctl', ['--user', 'is-active', unit], { timeout: 3000 });
    const s = stdout.trim();
    if (s === 'active' || s === 'inactive' || s === 'failed' || s === 'activating') return s;
    return 'unknown';
  } catch (e: unknown) {
    const stdout = (e as { stdout?: string })?.stdout?.toString().trim() ?? '';
    if (stdout === 'inactive' || stdout === 'failed' || stdout === 'activating') return stdout;
    return 'unknown';
  }
}

async function hermesVersion(): Promise<string | null> {
  if (!IS_HOMESERV) return null;
  try {
    const { stdout } = await execFileP(HERMES_BIN, ['--version'], { timeout: 3000 });
    const m = stdout.match(/v[\d.]+\s*\([^)]+\)/);
    return m?.[0] ?? stdout.split('\n')[0]?.trim() ?? null;
  } catch {
    return null;
  }
}

async function curatorStatus(): Promise<string | null> {
  if (!IS_HOMESERV) return null;
  try {
    const { stdout } = await execFileP(HERMES_BIN, ['curator', 'status'], {
      timeout: 8000,
      env: { ...process.env, HERMES_HOME },
      maxBuffer: 1024 * 1024,
    });
    return stdout.toString().trim() || null;
  } catch (e: unknown) {
    const out = (e as { stdout?: Buffer | string })?.stdout?.toString().trim();
    return out || null;
  }
}

/** Run an arbitrary command, capturing stdout/stderr/exit into an ActionResult.
 *  HERMES_HOME is always injected so the `hermes` CLI finds its profile. */
export async function runShell(
  action: string,
  cmd: string,
  args: string[],
  timeoutMs: number,
  envExtra: Record<string, string> = {},
): Promise<ActionResult> {
  const t0 = Date.now();
  try {
    const { stdout, stderr } = await execFileP(cmd, args, {
      timeout: timeoutMs,
      env: { ...process.env, HERMES_HOME, ...envExtra },
      maxBuffer: 4 * 1024 * 1024,
    });
    return { action, ok: true, stdout: stdout.toString(), stderr: stderr.toString(), durationMs: Date.now() - t0, exitCode: 0 };
  } catch (e: unknown) {
    const err = e as { stdout?: Buffer | string; stderr?: Buffer | string; code?: number; killed?: boolean; signal?: string };
    return {
      action,
      ok: false,
      stdout: err.stdout?.toString() ?? '',
      stderr: (err.stderr?.toString() ?? '') + (err.killed ? `\n[killed: ${err.signal ?? 'SIGTERM'} after ${timeoutMs}ms]` : ''),
      durationMs: Date.now() - t0,
      exitCode: typeof err.code === 'number' ? err.code : null,
    };
  }
}

export async function getStatus(): Promise<HermesStatus> {
  const [health, gateway, dashboard, version, curator] = await Promise.all([
    probeHealth(),
    serviceState(GATEWAY_UNIT),
    serviceState(DASHBOARD_UNIT),
    hermesVersion(),
    curatorStatus(),
  ]);
  return { health, services: { gateway, dashboard }, version, curator };
}

/** Execute a named service action (restart/update) and return its result.
 *  The action→command mapping lives here so the page and the /service endpoint
 *  never diverge. Always runs on homeserv (the endpoint is host-gated). */
export async function runServiceAction(action: ServiceAction): Promise<ActionResult> {
  switch (action) {
    case 'restart_gateway':
      return runShell('restart_gateway', 'systemctl', ['--user', 'restart', GATEWAY_UNIT], 30_000);
    case 'restart_dashboard':
      return runShell('restart_dashboard', 'systemctl', ['--user', 'restart', DASHBOARD_UNIT], 180_000);
    case 'restart_all': {
      const a = await runShell('restart_gateway', 'systemctl', ['--user', 'restart', GATEWAY_UNIT], 180_000);
      const b = await runShell('restart_dashboard', 'systemctl', ['--user', 'restart', DASHBOARD_UNIT], 180_000);
      return {
        action: 'restart_all',
        ok: a.ok && b.ok,
        stdout: `[gateway]\n${a.stdout}\n\n[dashboard]\n${b.stdout}`,
        stderr: `[gateway]\n${a.stderr}\n\n[dashboard]\n${b.stderr}`,
        durationMs: a.durationMs + b.durationMs,
        exitCode: a.ok && b.ok ? 0 : (a.exitCode ?? b.exitCode ?? 1),
      };
    }
    case 'update_check': {
      const r = await runShell('update_check', HERMES_BIN, ['update', '--check'], 60_000);
      // `--check` exits non-zero when updates ARE available — that's success for us.
      return { ...r, ok: true };
    }
    case 'update_hermes': {
      const upd = await runShell('update_hermes', HERMES_BIN, ['update', '--yes', '--no-backup'], 5 * 60_000);
      const gw = await runShell('restart_gateway', 'systemctl', ['--user', 'restart', GATEWAY_UNIT], 180_000);
      const dash = await runShell('restart_dashboard', 'systemctl', ['--user', 'restart', DASHBOARD_UNIT], 180_000);
      return {
        action: 'update_hermes',
        ok: upd.ok && gw.ok && dash.ok,
        stdout: `[update]\n${upd.stdout}\n\n[restart gateway]\n${gw.stdout}\n\n[restart dashboard]\n${dash.stdout}`,
        stderr: `[update]\n${upd.stderr}\n\n[restart gateway]\n${gw.stderr}\n\n[restart dashboard]\n${dash.stderr}`,
        durationMs: upd.durationMs + gw.durationMs + dash.durationMs,
        exitCode: upd.exitCode,
      };
    }
  }
}
