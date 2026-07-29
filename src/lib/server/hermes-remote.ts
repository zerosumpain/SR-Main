/**
 * Host switch for the Hermes admin surface. The session store + `hermes` CLI +
 * gateway live only on homeserv, so:
 *   - on homeserv (IS_HOMESERV) → call the local helpers directly (sqlite/CLI);
 *   - on the VPS → proxy to the homeserv always-on instance over Tailscale,
 *     authenticated with HERMES_BRIDGE_SECRET (the same secret both hosts share).
 *
 * Mirrors workflows/scraper/interactive-remote.ts. Pages import ONLY these
 * `r*` wrappers + `canManageHermes()` and never touch the host-bound modules,
 * so the VPS bundle doesn't load sqlite/CLI code (dynamic import on the local
 * branch).
 */
import { env } from '$env/dynamic/private';
import os from 'node:os';
import type {
  Telemetry,
  ToolAudit,
  CallEfficiency,
  HermesSessionRow,
  SearchHit,
  SessionDetail,
} from './hermes-sessions';
import type { HermesStatus, ActionResult, ServiceAction } from './hermes-control';
import type { CronJob, CronOp, CronOpResult } from './hermes-cron';

export const IS_HOMESERV = os.hostname() === 'homeserv';

/** Base URL of the homeserv SvelteKit instance. Prefer an explicit
 *  HERMES_ADMIN_SERVICE_URL; else derive from SCRAPER_SERVICE_URL (the VPS
 *  already sets it to the homeserv :5173 host). null on homeserv → local path. */
export function homeservBase(): string | null {
  const explicit = env.HERMES_ADMIN_SERVICE_URL;
  if (explicit) return explicit.replace(/\/+$/, '');
  const svc = env.SCRAPER_SERVICE_URL;
  if (!svc) return null;
  try {
    const u = new URL(svc);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/** Can this host drive Hermes admin — directly (homeserv) or via a reachable
 *  homeserv with the shared secret? Replaces the old `canManage = IS_HOMESERV`,
 *  which left every VPS button dead. */
export function canManageHermes(): boolean {
  return IS_HOMESERV || (!!homeservBase() && !!env.HERMES_BRIDGE_SECRET);
}

const GET_TIMEOUT = 8000;

async function proxyGet<T>(path: string): Promise<T> {
  const base = homeservBase();
  if (!base) throw new Error('homeserv base URL not configured');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), GET_TIMEOUT);
  try {
    const res = await fetch(`${base}/api/admin/hermes${path}`, {
      headers: { Authorization: `Bearer ${env.HERMES_BRIDGE_SECRET}` },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`hermes proxy GET ${path} → HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

async function proxyPost<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
  const base = homeservBase();
  if (!base) throw new Error('homeserv base URL not configured');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}/api/admin/hermes${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.HERMES_BRIDGE_SECRET}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`hermes proxy POST ${path} → HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(t);
  }
}

// ── Reads ──
export async function rTelemetry(days: number): Promise<Telemetry> {
  if (IS_HOMESERV) {
    const { getTelemetry } = await import('./hermes-sessions');
    return getTelemetry(days);
  }
  return proxyGet<Telemetry>(`/telemetry?days=${days}`);
}
export async function rToolAudit(days: number): Promise<ToolAudit> {
  if (IS_HOMESERV) {
    const { getToolAudit } = await import('./hermes-sessions');
    return getToolAudit(days);
  }
  return proxyGet<ToolAudit>(`/toolaudit?days=${days}`);
}
/** Tool calls per answered turn — the self-improvement engine's prime outcome.
 *  Same host switch as rToolAudit: the turn data only exists in homeserv's
 *  Hermes SQLite, and the engine that consumes it runs on the VPS. */
export async function rCallEfficiency(days: number): Promise<CallEfficiency> {
  if (IS_HOMESERV) {
    const { getCallEfficiency } = await import('./hermes-sessions');
    return getCallEfficiency(days);
  }
  return proxyGet<CallEfficiency>(`/callefficiency?days=${days}`);
}
export async function rStatus(): Promise<HermesStatus> {
  if (IS_HOMESERV) {
    const { getStatus } = await import('./hermes-control');
    return getStatus();
  }
  return proxyGet<HermesStatus>('/status');
}
export async function rSessions(source: string, q: string): Promise<{ sessions: HermesSessionRow[]; hits: SearchHit[] }> {
  if (IS_HOMESERV) {
    const { listSessions, searchSessions } = await import('./hermes-sessions');
    return q ? { sessions: [], hits: await searchSessions(q, { source }) } : { sessions: await listSessions({ source }), hits: [] };
  }
  const qs = new URLSearchParams({ source });
  if (q) qs.set('q', q);
  return proxyGet(`/sessions?${qs.toString()}`);
}
export async function rSession(id: string): Promise<SessionDetail> {
  if (IS_HOMESERV) {
    const { getSession } = await import('./hermes-sessions');
    return getSession(id);
  }
  return proxyGet<SessionDetail>(`/sessions/${encodeURIComponent(id)}`);
}
export async function rCron(): Promise<CronJob[]> {
  if (IS_HOMESERV) {
    const { listCron } = await import('./hermes-cron');
    return listCron();
  }
  return proxyGet<CronJob[]>('/cron');
}

// ── Writes ──
export async function rServiceAction(action: ServiceAction): Promise<ActionResult> {
  if (IS_HOMESERV) {
    const { runServiceAction } = await import('./hermes-control');
    return runServiceAction(action);
  }
  return proxyPost<ActionResult>('/service', { action }, 6 * 60_000);
}
export async function rCronOp(op: CronOp): Promise<CronOpResult> {
  if (IS_HOMESERV) {
    const { runCronOp } = await import('./hermes-cron');
    return runCronOp(op);
  }
  return proxyPost<CronOpResult>('/cron', op, 35_000);
}
