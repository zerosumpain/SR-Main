// src/lib/llm/model-service-contract.ts
//
// The wire contract between SR-Main and the extracted applications for model
// plumbing: the model configuration Main resolves for them, and the LLM usage
// events they send back into Main's cost ledger (`agent_actions`).
//
// Shared byte-for-byte with Drive, Health, Policy Engine, DfE Data Strategy and
// Data Standard Designer (Main `shared-with-extracted.json`). Framework-free on
// purpose — no `$lib`, `$env` or database import — so the same file compiles in
// every repository and can be validated on both sides of the wire.
//
// Before this existed each application read `app_settings` and
// `openrouter_models` and wrote `agent_actions` directly in Main's database.
// The OpenRouter key was one of those settings, so every application could read
// a secret it had no business holding.

/** Bumped only for a breaking change; additive fields keep the number. */
export const MODEL_SERVICE_CONTRACT = 1;

export const MODEL_CONFIG_PATH = '/api/platform/models/config';
export const MODEL_USAGE_PATH = '/api/platform/models/usage';

/**
 * The applications that may use the lane. Each has its own credential, which
 * is how Main attributes an event without trusting a field the caller wrote.
 */
export const MODEL_SERVICE_APPS = [
  'drive',
  'health',
  'policy-engine',
  'dfe-data-strategy',
  'data-standard-designer',
] as const;
export type ModelServiceApp = (typeof MODEL_SERVICE_APPS)[number];

export function isModelServiceApp(value: unknown): value is ModelServiceApp {
  return typeof value === 'string' && (MODEL_SERVICE_APPS as readonly string[]).includes(value);
}

/** One OpenRouter catalogue row, reduced to what model plumbing reads. */
export interface CatalogueModel {
  id: string;
  /** USD per token, as OpenRouter publishes it. Null when unpriced. */
  promptPrice: number | null;
  completionPrice: number | null;
  /** `raw.top_provider.max_completion_tokens`. */
  maxCompletionTokens: number | null;
  /** `raw.architecture.input_modalities`. Null when the catalogue has none. */
  inputModalities: string[] | null;
  /** e.g. `text+image->text`. */
  modality: string | null;
  /** `raw.supported_parameters` (`reasoning`, `tools`, ...). */
  supportedParameters: string[] | null;
}

export interface ResolvedModel {
  provider: string;
  modelId: string;
}

export interface ModelConfigSnapshot {
  contract: typeof MODEL_SERVICE_CONTRACT;
  generatedAt: string;
  /**
   * Model-selection settings by `app_settings` key, exactly as stored, so an
   * application's resolvers keep their own precedence rules. Allow-listed by
   * Main; never carries a credential.
   */
  settings: Record<string, unknown>;
  /** Main's own resolution, for callers that only want the answer. */
  resolved: {
    defaultModel: ResolvedModel;
    codexEnabled: boolean;
    workloads: Record<string, ResolvedModel>;
  };
  catalogue: CatalogueModel[];
}

/** Keys that look like credentials are never served, whatever the allow-list says. */
const SECRET_KEY = /(api[_.-]?key|secret|token|password|credential|private)/i;

export function isSecretSettingKey(key: string): boolean {
  return SECRET_KEY.test(key);
}

/**
 * One LLM call, as an application observed it. Field for field the
 * `DurableLLMCall` that `$lib/llm/usage-log` records, plus an id for
 * idempotency and the time the call ended.
 */
export interface UsageEvent {
  /** UUID chosen by the sender. Retrying the same event is a no-op. */
  id: string;
  /** ISO time the call finished. Becomes the ledger row's `created_at`. */
  occurredAt: string;
  provider: string;
  model: string;
  tokensInput: number | null;
  tokensOutput: number | null;
  cacheReadTokens?: number | null;
  reasoningTokens?: number | null;
  /** Null means "not measured" (unknown model, or Codex quota) — never zero. */
  costUsd: number | null;
  source?: string;
  activity?: string | null;
  origin?: string | null;
  sessionId?: string | null;
  durationMs?: number | null;
  ttftMs?: number | null;
  conversationId?: string | null;
}

export const MAX_USAGE_BATCH = 100;
/** A spooled event older than this is refused rather than back-dated forever. */
export const MAX_USAGE_EVENT_AGE_MS = 14 * 24 * 60 * 60_000;
const MAX_CLOCK_SKEW_MS = 5 * 60_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ParseResult = { ok: true; event: UsageEvent } | { ok: false; error: string };

function shortText(v: unknown, max: number): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= max;
}

function optionalText(r: Record<string, unknown>, key: string, max: number): string | null | undefined | false {
  const v = r[key];
  if (v === undefined || v === null) return v as null | undefined;
  return shortText(v, max) ? v : false;
}

function count(v: unknown): number | null | false {
  if (v === undefined || v === null) return null;
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 2_147_483_647 ? v : false;
}

/**
 * Validate one usage event. Strict: an unknown shape is refused rather than
 * coerced, because a coerced cost is a fabricated cost.
 */
export function parseUsageEvent(raw: unknown, now = Date.now()): ParseResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'event must be an object' };
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !UUID.test(r.id)) return { ok: false, error: 'id must be a UUID' };
  if (typeof r.occurredAt !== 'string') return { ok: false, error: 'occurredAt is required' };
  const at = Date.parse(r.occurredAt);
  if (!Number.isFinite(at)) return { ok: false, error: 'occurredAt is not a date' };
  if (at > now + MAX_CLOCK_SKEW_MS) return { ok: false, error: 'occurredAt is in the future' };
  if (at < now - MAX_USAGE_EVENT_AGE_MS) return { ok: false, error: 'occurredAt is too old' };
  if (!shortText(r.provider, 64)) return { ok: false, error: 'provider is required' };
  if (!shortText(r.model, 200)) return { ok: false, error: 'model is required' };

  const counts: Record<string, number | null> = {};
  for (const key of ['tokensInput', 'tokensOutput', 'cacheReadTokens', 'reasoningTokens', 'durationMs', 'ttftMs']) {
    const v = count(r[key]);
    if (v === false) return { ok: false, error: `${key} must be a non-negative integer or null` };
    counts[key] = v;
  }
  if (!('tokensInput' in r) || !('tokensOutput' in r)) {
    return { ok: false, error: 'tokensInput and tokensOutput are required (null when unknown)' };
  }

  if (!('costUsd' in r)) return { ok: false, error: 'costUsd is required (null when unknown)' };
  const cost = r.costUsd;
  if (cost !== null && !(typeof cost === 'number' && Number.isFinite(cost) && cost >= 0 && cost < 10_000)) {
    return { ok: false, error: 'costUsd must be a non-negative number or null' };
  }

  const text: Record<string, string | null | undefined> = {};
  for (const [key, max] of [['source', 64], ['activity', 128], ['origin', 256], ['sessionId', 256], ['conversationId', 256]] as const) {
    const v = optionalText(r, key, max);
    if (v === false) return { ok: false, error: `${key} must be a short string` };
    text[key] = v;
  }

  return {
    ok: true,
    event: {
      id: r.id.toLowerCase(),
      occurredAt: new Date(at).toISOString(),
      provider: r.provider,
      model: r.model,
      tokensInput: counts.tokensInput,
      tokensOutput: counts.tokensOutput,
      cacheReadTokens: counts.cacheReadTokens,
      reasoningTokens: counts.reasoningTokens,
      costUsd: cost as number | null,
      source: text.source ?? undefined,
      activity: text.activity ?? null,
      origin: text.origin ?? null,
      sessionId: text.sessionId ?? null,
      durationMs: counts.durationMs,
      ttftMs: counts.ttftMs,
      conversationId: text.conversationId ?? null,
    },
  };
}
