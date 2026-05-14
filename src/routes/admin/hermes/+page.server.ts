import type { Actions, PageServerLoad } from './$types';
import { env } from '$env/dynamic/private';
import { db } from '$lib/db';
import { hermesSessions } from '$lib/db/schema';
import { desc, isNull } from 'drizzle-orm';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import { fail } from '@sveltejs/kit';

const execFileP = promisify(execFile);

const HERMES_URL = env.HERMES_PLATFORM_URL ?? 'http://127.0.0.1:18790';
const HEALTH_TIMEOUT_MS = 1500;
const HERMES_HOME = env.HERMES_HOME ?? '/home/john/.hermes-jkai';
const HERMES_BIN = '/home/john/.local/bin/hermes';
const GATEWAY_UNIT = 'jkai-hermes.service';
const DASHBOARD_UNIT = 'jkai-hermes-dashboard.service';

// Service-mutating actions only run when SvelteKit lives on the same host
// as Hermes — i.e. homeserv. The VPS deploy sees the page but the action
// buttons render disabled.
const IS_HOMESERV = os.hostname() === 'homeserv';

type HealthPayload = { ok: boolean; ts: number } | null;
type ServiceState = 'active' | 'inactive' | 'failed' | 'activating' | 'unknown';
type ActionResult = {
  action: string;
  ok: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
  exitCode: number | null;
};

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
    const { stdout } = await execFileP('systemctl', ['--user', 'is-active', unit], {
      timeout: 3000,
    });
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

async function runShell(
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
    return {
      action,
      ok: true,
      stdout: stdout.toString(),
      stderr: stderr.toString(),
      durationMs: Date.now() - t0,
      exitCode: 0,
    };
  } catch (e: unknown) {
    const err = e as { stdout?: Buffer | string; stderr?: Buffer | string; code?: number; killed?: boolean; signal?: string };
    return {
      action,
      ok: false,
      stdout: err.stdout?.toString() ?? '',
      stderr:
        (err.stderr?.toString() ?? '') +
        (err.killed ? `\n[killed: ${err.signal ?? 'SIGTERM'} after ${timeoutMs}ms]` : ''),
      durationMs: Date.now() - t0,
      exitCode: typeof err.code === 'number' ? err.code : null,
    };
  }
}

export const load: PageServerLoad = async () => {
  const [openSessions, health, gatewayState, dashboardState, version] = await Promise.all([
    db
      .select({
        id: hermesSessions.id,
        hermesSessionId: hermesSessions.hermesSessionId,
        kind: hermesSessions.kind,
        kindId: hermesSessions.kindId,
        createdAt: hermesSessions.createdAt,
      })
      .from(hermesSessions)
      .where(isNull(hermesSessions.closedAt))
      .orderBy(desc(hermesSessions.createdAt))
      .limit(50),
    probeHealth(),
    serviceState(GATEWAY_UNIT),
    serviceState(DASHBOARD_UNIT),
    hermesVersion(),
  ]);

  return {
    openSessions,
    health,
    flagEnabled: env.JKAI_HERMES_CANVAS_CHAT === '1',
    canManage: IS_HOMESERV,
    hostname: os.hostname(),
    services: { gateway: gatewayState, dashboard: dashboardState },
    version,
  };
};

function gateOrFail() {
  if (!IS_HOMESERV) {
    return fail(403, {
      action: 'gated',
      ok: false,
      stdout: '',
      stderr: `Service control is disabled on host "${os.hostname()}". Run from homeserv (http://homeserv:5173/admin/hermes).`,
      durationMs: 0,
      exitCode: null,
    });
  }
  return null;
}

export const actions: Actions = {
  restart_gateway: async () => {
    const blocked = gateOrFail();
    if (blocked) return blocked;
    const r = await runShell('restart_gateway', 'systemctl', ['--user', 'restart', GATEWAY_UNIT], 30_000);
    return r.ok ? r : fail(500, r);
  },

  restart_dashboard: async () => {
    const blocked = gateOrFail();
    if (blocked) return blocked;
    const r = await runShell(
      'restart_dashboard',
      'systemctl',
      ['--user', 'restart', DASHBOARD_UNIT],
      180_000,
    );
    return r.ok ? r : fail(500, r);
  },

  restart_all: async () => {
    const blocked = gateOrFail();
    if (blocked) return blocked;
    const a = await runShell(
      'restart_gateway',
      'systemctl',
      ['--user', 'restart', GATEWAY_UNIT],
      180_000,
    );
    const b = await runShell(
      'restart_dashboard',
      'systemctl',
      ['--user', 'restart', DASHBOARD_UNIT],
      180_000,
    );
    const merged: ActionResult = {
      action: 'restart_all',
      ok: a.ok && b.ok,
      stdout: `[gateway]\n${a.stdout}\n\n[dashboard]\n${b.stdout}`,
      stderr: `[gateway]\n${a.stderr}\n\n[dashboard]\n${b.stderr}`,
      durationMs: a.durationMs + b.durationMs,
      exitCode: a.ok && b.ok ? 0 : (a.exitCode ?? b.exitCode ?? 1),
    };
    return merged.ok ? merged : fail(500, merged);
  },

  update_check: async () => {
    const blocked = gateOrFail();
    if (blocked) return blocked;
    const r = await runShell('update_check', HERMES_BIN, ['update', '--check'], 60_000);
    // `--check` exits non-zero when updates ARE available — that's success for us.
    return { ...r, ok: true };
  },

  update_hermes: async () => {
    const blocked = gateOrFail();
    if (blocked) return blocked;
    // 1. hermes update --yes --no-backup
    const upd = await runShell(
      'update_hermes',
      HERMES_BIN,
      ['update', '--yes', '--no-backup'],
      5 * 60_000,
    );
    // 2. always restart both, even on failure — keeps services consistent.
    const gw = await runShell(
      'restart_gateway',
      'systemctl',
      ['--user', 'restart', GATEWAY_UNIT],
      180_000,
    );
    const dash = await runShell(
      'restart_dashboard',
      'systemctl',
      ['--user', 'restart', DASHBOARD_UNIT],
      180_000,
    );
    const merged: ActionResult = {
      action: 'update_hermes',
      ok: upd.ok && gw.ok && dash.ok,
      stdout: `[update]\n${upd.stdout}\n\n[restart gateway]\n${gw.stdout}\n\n[restart dashboard]\n${dash.stdout}`,
      stderr: `[update]\n${upd.stderr}\n\n[restart gateway]\n${gw.stderr}\n\n[restart dashboard]\n${dash.stderr}`,
      durationMs: upd.durationMs + gw.durationMs + dash.durationMs,
      exitCode: upd.exitCode,
    };
    return merged.ok ? merged : fail(500, merged);
  },
};
