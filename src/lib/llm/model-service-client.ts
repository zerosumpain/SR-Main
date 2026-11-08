// src/lib/llm/model-service-client.ts
//
// The extracted applications' side of the model-plumbing lane: read the model
// configuration Main resolves, and send LLM usage into Main's cost ledger.
//
// Shared byte-for-byte with Drive, Health, Policy Engine, DfE Data Strategy and
// Data Standard Designer (Main `shared-with-extracted.json`). Main itself never
// calls it — it reads its own database — but owns it, tests it here, and serves
// the two endpoints it talks to. Framework-free so it is the same file in every
// repository; each application builds one instance from its own environment.
//
// Two rules shape everything below:
//
//  1. A Main outage never blocks an application's LLM call. Configuration is
//     cached with a TTL, served stale when a refresh fails, and a failed refresh
//     backs off rather than adding a timeout to every request. Usage sending is
//     fire-and-forget: `recordUsage` returns immediately and never throws.
//  2. Spend is never invented. An event is spooled to a local file the moment it
//     is recorded and removed only once Main has accepted it, so a Main restart
//     loses nothing. The spool is bounded; when it overflows the OLDEST events are
//     dropped and counted loudly, never replaced with a zero. A null cost (an
//     unknown model, or Codex quota) crosses the wire as null.

import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  MAX_USAGE_BATCH,
  MAX_USAGE_EVENT_AGE_MS,
  MODEL_CONFIG_PATH,
  MODEL_SERVICE_CONTRACT,
  MODEL_USAGE_PATH,
  type ModelConfigSnapshot,
  type ModelServiceApp,
  type UsageEvent,
} from './model-service-contract';

export interface ModelServiceClientOptions {
  app: ModelServiceApp;
  /** Main's origin, e.g. `http://127.0.0.1:5173`. Plain http only to loopback. */
  baseUrl: string | undefined;
  /** This application's credential for the lane. */
  token: string | undefined;
  /** Directory for the usage spool and the last good configuration. */
  stateDir?: string;
  fetch?: typeof fetch;
  now?: () => number;
  /** How long a fetched configuration is fresh. */
  configTtlMs?: number;
  /** After a failed refresh, how long to keep serving stale before asking again. */
  configRetryMs?: number;
  /** Per-request timeout; a hung Main must not hold a request open. */
  timeoutMs?: number;
  /** Upper bound on spooled events. Oldest are dropped beyond it, and counted. */
  maxSpooledEvents?: number;
  /** Delay before a flush, so a burst of calls goes as one request. */
  flushDelayMs?: number;
  /** Retry backoff ceiling for undeliverable usage. */
  maxRetryDelayMs?: number;
  log?: Pick<Console, 'warn' | 'error'>;
}

export interface ModelServiceStatus {
  configured: boolean;
  configAgeMs: number | null;
  configStale: boolean;
  lastConfigError: string | null;
  spooled: number;
  delivered: number;
  dropped: number;
  rejected: number;
  lastUsageError: string | null;
}

export interface ModelServiceClient {
  readonly configured: boolean;
  /** The configuration, possibly stale; null only when Main has never answered. */
  getConfig(): Promise<ModelConfigSnapshot | null>;
  /** Record one LLM call. Returns at once; never throws. */
  recordUsage(event: Omit<UsageEvent, 'id' | 'occurredAt'> & Partial<Pick<UsageEvent, 'id' | 'occurredAt'>>): void;
  /** Deliver what is spooled now. Resolves when the attempt finishes. */
  flush(): Promise<void>;
  status(): ModelServiceStatus;
}

const MIN_TOKEN_LEN = 32;

/** https anywhere; plain http only to this machine, so the token never crosses a network in clear. */
export function usableBaseUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const loopback = ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) return null;
  if (url.username || url.password) return null;
  return url.origin;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isSnapshot(v: unknown): v is ModelConfigSnapshot {
  const s = v as ModelConfigSnapshot | null;
  return (
    !!s &&
    s.contract === MODEL_SERVICE_CONTRACT &&
    typeof s.settings === 'object' &&
    s.settings !== null &&
    Array.isArray(s.catalogue) &&
    typeof s.resolved?.defaultModel?.modelId === 'string'
  );
}

export function createModelServiceClient(options: ModelServiceClientOptions): ModelServiceClient {
  const baseUrl = usableBaseUrl(options.baseUrl);
  const token = options.token && options.token.length >= MIN_TOKEN_LEN ? options.token : null;
  const configured = !!(baseUrl && token);
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const log = options.log ?? console;
  const ttl = options.configTtlMs ?? 60_000;
  const retryAfter = options.configRetryMs ?? 15_000;
  const timeoutMs = options.timeoutMs ?? 3_000;
  const maxSpooled = options.maxSpooledEvents ?? 10_000;
  const flushDelay = options.flushDelayMs ?? 250;
  const maxRetryDelay = options.maxRetryDelayMs ?? 5 * 60_000;
  const stateDir = options.stateDir ?? join(tmpdir(), `sr-model-service-${options.app}`);
  const spoolPath = join(stateDir, 'usage-spool.jsonl');
  const configPath = join(stateDir, 'model-config.json');

  let config: ModelConfigSnapshot | null = null;
  let configFetchedAt = 0;
  let nextConfigAttempt = 0;
  let configInFlight: Promise<void> | null = null;
  let diskConfigTried = false;
  let lastConfigError: string | null = null;

  let spooled = 0;
  let delivered = 0;
  let dropped = 0;
  let rejected = 0;
  let lastUsageError: string | null = null;
  let warnedUnconfigured = false;
  // Every spool operation runs through this chain, so an append never races the
  // rewrite that follows a delivery.
  let chain: Promise<unknown> = Promise.resolve();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let retryDelay = 0;

  function serial<T>(task: () => Promise<T>): Promise<T> {
    const run = chain.then(task, task);
    chain = run.catch(() => undefined);
    return run;
  }

  function headers(extra?: Record<string, string>): Record<string, string> {
    return { authorization: `Bearer ${token}`, 'x-sr-app': options.app, ...extra };
  }

  // ── configuration ─────────────────────────────────────────────────────────

  async function loadDiskConfig(): Promise<void> {
    if (diskConfigTried) return;
    diskConfigTried = true;
    try {
      const saved = JSON.parse(await readFile(configPath, 'utf8')) as unknown;
      // Stale from the moment it is read: it only stands in until Main answers.
      if (isSnapshot(saved) && !config) config = saved;
    } catch {
      // No saved configuration yet.
    }
  }

  async function refreshConfig(): Promise<void> {
    try {
      const res = await doFetch(`${baseUrl}${MODEL_CONFIG_PATH}`, {
        headers: headers({ accept: 'application/json' }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`Main answered ${res.status}`);
      const body = (await res.json()) as unknown;
      if (!isSnapshot(body)) throw new Error('Main sent a configuration this client does not understand');
      config = body;
      configFetchedAt = now();
      lastConfigError = null;
      void mkdir(stateDir, { recursive: true })
        .then(() => writeFile(`${configPath}.tmp`, JSON.stringify(body)))
        .then(() => rename(`${configPath}.tmp`, configPath))
        .catch(() => undefined);
    } catch (err) {
      lastConfigError = message(err);
      nextConfigAttempt = now() + retryAfter;
      log.warn(`[model-service] configuration refresh failed (${lastConfigError}); ${config ? 'serving the last good copy' : 'using code defaults'}`);
    }
  }

  async function getConfig(): Promise<ModelConfigSnapshot | null> {
    if (!configured) return null;
    if (config && now() - configFetchedAt < ttl) return config;
    await loadDiskConfig();
    // Inside the backoff window, answer from what we have without waiting.
    if (now() < nextConfigAttempt) return config;
    if (!configInFlight) {
      configInFlight = refreshConfig().finally(() => {
        configInFlight = null;
      });
    }
    // With a stale copy in hand, do not make the caller wait for Main.
    if (config) return config;
    await configInFlight;
    return config;
  }

  // ── usage ─────────────────────────────────────────────────────────────────

  async function readSpool(): Promise<UsageEvent[]> {
    let text = '';
    try {
      text = await readFile(spoolPath, 'utf8');
    } catch {
      return [];
    }
    const events: UsageEvent[] = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line) as UsageEvent);
      } catch {
        // A torn final line from a crash mid-append. Nothing to recover.
      }
    }
    return events;
  }

  async function writeSpool(events: UsageEvent[]): Promise<void> {
    await mkdir(dirname(spoolPath), { recursive: true });
    const tmp = `${spoolPath}.tmp`;
    await writeFile(tmp, events.map((e) => JSON.stringify(e)).join('\n') + (events.length ? '\n' : ''));
    await rename(tmp, spoolPath);
  }

  function scheduleFlush(delay: number): void {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flush();
    }, delay);
    (flushTimer as { unref?: () => void }).unref?.();
  }

  function recordUsage(input: Parameters<ModelServiceClient['recordUsage']>[0]): void {
    try {
      if (!configured) {
        if (!warnedUnconfigured) {
          warnedUnconfigured = true;
          log.warn('[model-service] MODEL_SERVICE_URL / MODEL_SERVICE_TOKEN unset; LLM usage is not being recorded');
        }
        return;
      }
      const event: UsageEvent = {
        ...input,
        id: input.id ?? randomUUID(),
        occurredAt: input.occurredAt ?? new Date(now()).toISOString(),
      };
      void serial(async () => {
        await mkdir(stateDir, { recursive: true });
        await appendFile(spoolPath, JSON.stringify(event) + '\n');
        spooled++;
      }).catch((err: unknown) => {
        lastUsageError = `spool write failed: ${message(err)}`;
        log.error(`[model-service] could not spool an LLM usage event: ${message(err)}`);
      });
      scheduleFlush(flushDelay);
    } catch (err) {
      log.error(`[model-service] recordUsage failed: ${message(err)}`);
    }
  }

  async function deliver(): Promise<void> {
    let events = await readSpool();
    // Bound the spool before anything else: oldest out, counted, never zeroed.
    const cutoff = now() - MAX_USAGE_EVENT_AGE_MS;
    const fresh = events.filter((e) => Date.parse(e.occurredAt) >= cutoff);
    let lost = events.length - fresh.length;
    events = fresh;
    if (events.length > maxSpooled) {
      lost += events.length - maxSpooled;
      events = events.slice(events.length - maxSpooled);
    }
    if (lost) {
      dropped += lost;
      log.error(`[model-service] dropped ${lost} LLM usage event(s) Main never accepted (spool bound or age limit)`);
    }

    const done = new Set<string>();
    let failure: string | null = null;
    for (let i = 0; i < events.length; i += MAX_USAGE_BATCH) {
      const batch = events.slice(i, i + MAX_USAGE_BATCH);
      try {
        const res = await doFetch(`${baseUrl}${MODEL_USAGE_PATH}`, {
          method: 'POST',
          headers: headers({ 'content-type': 'application/json' }),
          body: JSON.stringify({ events: batch }),
          signal: AbortSignal.timeout(timeoutMs * 2),
        });
        if (res.status === 400) {
          // The batch as a whole is malformed. Retrying it would fail forever.
          const detail = await res.text().catch(() => '');
          rejected += batch.length;
          batch.forEach((e) => done.add(e.id));
          log.error(`[model-service] Main refused a usage batch as malformed: ${detail.slice(0, 200)}`);
          continue;
        }
        if (!res.ok) throw new Error(`Main answered ${res.status}`);
        const body = (await res.json().catch(() => ({}))) as {
          accepted?: number;
          duplicates?: number;
          rejected?: { id?: string; error?: string }[];
        };
        for (const r of body.rejected ?? []) {
          rejected++;
          log.error(`[model-service] Main rejected usage event ${r.id ?? '?'}: ${r.error ?? 'invalid'}`);
        }
        delivered += (body.accepted ?? 0) + (body.duplicates ?? 0);
        batch.forEach((e) => done.add(e.id));
      } catch (err) {
        failure = message(err);
        break;
      }
    }

    // Appends wait on the same chain as this delivery, so nothing arrived while
    // it ran: what was read, minus what Main took, is the whole spool.
    const kept = events.filter((e) => !done.has(e.id));
    await writeSpool(kept);
    spooled = kept.length;

    if (failure) {
      lastUsageError = failure;
      retryDelay = Math.min(maxRetryDelay, retryDelay ? retryDelay * 2 : 5_000);
      log.warn(`[model-service] usage delivery failed (${failure}); ${kept.length} event(s) kept, retrying in ${Math.round(retryDelay / 1000)}s`);
      scheduleFlush(retryDelay);
    } else {
      lastUsageError = null;
      retryDelay = 0;
      if (kept.length) scheduleFlush(flushDelay);
    }
  }

  function flush(): Promise<void> {
    if (!configured) return Promise.resolve();
    return serial(deliver).catch((err: unknown) => {
      lastUsageError = message(err);
      log.error(`[model-service] usage flush failed: ${message(err)}`);
    });
  }

  if (configured) {
    // Anything left from a previous process goes out shortly after start.
    scheduleFlush(flushDelay);
  }

  return {
    configured,
    getConfig,
    recordUsage,
    flush,
    status: () => ({
      configured,
      configAgeMs: config && configFetchedAt ? now() - configFetchedAt : null,
      configStale: !!config && now() - configFetchedAt >= ttl,
      lastConfigError,
      spooled,
      delivered,
      dropped,
      rejected,
      lastUsageError,
    }),
  };
}
