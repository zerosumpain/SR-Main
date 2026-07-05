/**
 * Homeserv-local Hermes cron surface (engine scheduled jobs — distinct from the
 * Postgres workflow scheduler at /admin/ops/live + /admin/ops/cron).
 *
 * Reads come straight from the authoritative `cron/jobs.json` (the `hermes cron
 * list` CLI only renders a Rich table — no JSON). Writes go through the
 * `hermes cron …` CLI (never edit jobs.json/state.db directly — that would
 * corrupt the gateway's in-memory view + WAL). `runShell` always injects
 * HERMES_HOME so the CLI finds its profile.
 */
import { readFile } from 'node:fs/promises';
import { HERMES_HOME, HERMES_BIN, runShell } from './hermes-control';

const JOBS_PATH = `${HERMES_HOME}/cron/jobs.json`;

export interface CronJob {
  id: string;
  name: string | null;
  prompt: string | null;
  scheduleKind: string;
  scheduleDisplay: string | null;
  deliver: string | null;
  repeat: { times: number; completed: number };
  enabled: boolean;
  state: string;
  pausedReason: string | null;
  noAgent: boolean;
  createdAt: string | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  originPlatform: string | null;
}

function normalizeJob(j: Record<string, unknown>): CronJob {
  const schedule = (j.schedule ?? {}) as Record<string, unknown>;
  const repeat = (j.repeat ?? {}) as Record<string, unknown>;
  const origin = (j.origin ?? {}) as Record<string, unknown>;
  return {
    id: String(j.id ?? ''),
    name: (j.name as string) ?? null,
    prompt: (j.prompt as string) ?? null,
    scheduleKind: String(schedule.kind ?? ''),
    scheduleDisplay: (j.schedule_display as string) ?? (schedule.display as string) ?? null,
    deliver: (j.deliver as string) ?? null,
    repeat: { times: Number(repeat.times ?? 0) || 0, completed: Number(repeat.completed ?? 0) || 0 },
    enabled: !!j.enabled,
    state: String(j.state ?? ''),
    pausedReason: (j.paused_reason as string) ?? null,
    noAgent: !!j.no_agent,
    createdAt: (j.created_at as string) ?? null,
    nextRunAt: (j.next_run_at as string) ?? null,
    lastRunAt: (j.last_run_at as string) ?? null,
    lastStatus: (j.last_status as string) ?? null,
    lastError: (j.last_error as string) ?? (j.last_delivery_error as string) ?? null,
    originPlatform: (origin.platform as string) ?? null,
  };
}

export async function listCron(): Promise<CronJob[]> {
  let raw: string;
  try {
    raw = await readFile(JOBS_PATH, 'utf8');
  } catch {
    return []; // no cron dir yet
  }
  try {
    const data = JSON.parse(raw) as { jobs?: unknown };
    const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
    return jobs.map((j) => normalizeJob(j as Record<string, unknown>));
  } catch {
    return [];
  }
}

// Delivery sinks we expose: whatsapp lands on John's phone (reliable); local
// runs on the gateway host. We deliberately omit `origin` (jkai chat delivery
// buffers into an in-memory SSE queue, lost on restart / with no live client)
// and telegram/discord/signal (not configured for this deployment).
export const CRON_DELIVERIES = ['whatsapp', 'local'] as const;
export type CronDelivery = (typeof CRON_DELIVERIES)[number];

export interface CronCreateInput {
  op: 'create';
  schedule: string;
  prompt?: string;
  name?: string;
  deliver: CronDelivery;
  repeat?: number;
}
export interface CronIdOp {
  op: 'pause' | 'resume' | 'run' | 'remove';
  id: string;
}
export type CronOp = CronCreateInput | CronIdOp;

export interface CronOpResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  jobId?: string;
  error?: string;
}

const JOB_ID_RE = /^[0-9a-f]{6,32}$/i;

export async function runCronOp(input: CronOp): Promise<CronOpResult> {
  if (input.op === 'create') {
    const schedule = (input.schedule ?? '').trim();
    if (!schedule) return { ok: false, stdout: '', stderr: '', error: 'schedule is required' };
    if (!(CRON_DELIVERIES as readonly string[]).includes(input.deliver)) {
      return { ok: false, stdout: '', stderr: '', error: 'deliver must be whatsapp or local' };
    }
    // execFile array args (no shell) — schedule/prompt/name are not injectable.
    const args = ['cron', '--accept-hooks', 'create', schedule];
    if (input.prompt?.trim()) args.push(input.prompt.trim());
    args.push('--deliver', input.deliver);
    if (input.name?.trim()) args.push('--name', input.name.trim());
    if (input.repeat && input.repeat > 0) args.push('--repeat', String(Math.min(Math.round(input.repeat), 9999)));
    const r = await runShell('cron_create', HERMES_BIN, args, 30_000);
    const jobId = r.stdout.match(/Created job:\s*([0-9a-f]{6,})/i)?.[1];
    return { ok: r.ok, stdout: r.stdout, stderr: r.stderr, jobId, error: r.ok ? undefined : r.stderr || `exit ${r.exitCode}` };
  }

  if (!JOB_ID_RE.test(input.id)) return { ok: false, stdout: '', stderr: '', error: 'invalid job id' };
  const r = await runShell(`cron_${input.op}`, HERMES_BIN, ['cron', input.op, input.id], 20_000);
  return { ok: r.ok, stdout: r.stdout, stderr: r.stderr, error: r.ok ? undefined : r.stderr || `exit ${r.exitCode}` };
}
