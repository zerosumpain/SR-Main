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
import type { HermesWorkloadRow } from './hermes-models';
import type {
  WhatsAppBridgeStatus,
  PairState,
  WhatsAppAction,
  WhatsAppActionResult,
} from './hermes-whatsapp';

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

// 2.5s, matching the reach probe. These back /admin/ops/{engine,sessions,cron};
// at 8s each an outage made those pages feel hung rather than empty.
const GET_TIMEOUT = 2500;

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

// `proxyPost` lived here. Every caller now refuses before it would have been
// reached (see "Writes" below), so it is gone rather than left as a loaded gun
// for the next surface that wants to POST at a retired gateway.

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
/** What model each Hermes role is on. Reads shell out to `hermes config get`
 *  on homeserv, so the VPS has to ask homeserv — it cannot infer these. */
export async function rHermesModels(): Promise<HermesWorkloadRow[]> {
  if (IS_HOMESERV) {
    const { readHermesWorkloads } = await import('./hermes-models');
    return readHermesWorkloads();
  }
  return proxyGet<HermesWorkloadRow[]>('/models');
}

// ── Writes ──
//
// Hermes is retired (2026-08-24): `jkai.chat.hermes_enabled` is false, the three
// units are stopped, and WhatsApp runs from packages/jkai-wa-worker on the VPS.
// Every write below still worked, and that is the danger — `jkai-hermes.service`
// is *linked* and merely failed, so "restart" would START it, its .env still had
// WHATSAPP_ENABLED=true, and its Baileys session is a second registered device.
// One click on a panel nobody has retired would put two linked devices on the
// account, both receiving every inbound message and both answering it.
//
// So the writes refuse, here, at the one place they all funnel through — rather
// than by deleting the admin forms, which would have to be done four times and
// re-done for any surface added later. Reads are untouched: the panels keep
// rendering, the security page keeps reading homeserv's posture, and nothing
// 500s. Delete the callers and this whole file at S8.
//
// Rollback (`hermes_enabled = true`) does NOT need these: that is one settings
// row read per request, and it starts no process.
const RETIRED =
  'Hermes is retired. This control is disabled because starting the gateway ' +
  'would register a second WhatsApp device and duplicate every reply. ' +
  'Chat runs on the in-process loop; WhatsApp runs on the VPS worker.';

function refuseWrite(what: string): never {
  throw new Error(`${what} unavailable — ${RETIRED}`);
}

export async function rServiceAction(_action: ServiceAction): Promise<ActionResult> {
  refuseWrite('Hermes service control');
}
export async function rCronOp(_op: CronOp): Promise<CronOpResult> {
  refuseWrite('Hermes cron control');
}
export async function rSetHermesModel(
  _workloadId: string,
  _modelId: string,
): Promise<ActionResult> {
  refuseWrite('Hermes workload model assignment');
}

// ── WhatsApp bridge ──
// The Baileys session, the bridge process and the systemd unit all live on
// homeserv, so the VPS can only reach them through the same proxy every other
// Hermes control uses. Pairing in particular MUST land here: a QR rendered on
// the VPS would be pairing a bridge that host does not run.
export async function rWhatsAppStatus(): Promise<WhatsAppBridgeStatus> {
  if (IS_HOMESERV) {
    const { getWhatsAppStatus } = await import('./hermes-whatsapp');
    return getWhatsAppStatus();
  }
  return proxyGet<WhatsAppBridgeStatus>('/whatsapp');
}

export async function rWhatsAppPairState(): Promise<PairState> {
  if (IS_HOMESERV) {
    const { getPairState } = await import('./hermes-whatsapp');
    return getPairState();
  }
  return proxyGet<PairState>('/whatsapp/pair');
}

/** Pairing against the Hermes bridge would pair the WRONG device — the live
 *  session belongs to packages/jkai-wa-worker. Re-pair at
 *  /admin/connections/whatsapp, which talks to the worker. */
export async function rWhatsAppPair(_op: 'start' | 'cancel'): Promise<PairState> {
  refuseWrite('Hermes WhatsApp pairing');
}

export async function rWhatsAppAction(_action: WhatsAppAction): Promise<WhatsAppActionResult> {
  refuseWrite('Hermes WhatsApp bridge control');
}
