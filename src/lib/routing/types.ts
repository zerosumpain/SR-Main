// Query-Adaptive Model Routing — shared constants + types. Mirrors the
// briefing/self-improve harness (cron/tz, kill switch, datastore collections,
// OWNER_PHONE). See docs/superpowers/specs/2026-07-20-query-adaptive-model-routing-design.md
import type { ModelContext } from '$lib/server/models/types';

/** The four query profiles the router chooses a model for. */
export type ModelProfile = 'general' | 'tool' | 'rag' | 'agentic';
export const PROFILES: ModelProfile[] = ['general', 'tool', 'rag', 'agentic'];

export const PROFILE_LABEL: Record<ModelProfile, string> = {
  general: 'General chat',
  tool: 'Tool-heavy',
  rag: 'RAG / retrieval',
  agentic: 'Agentic / delegation',
};

export const PROFILE_BLURB: Record<ModelProfile, string> = {
  general: 'Everyday conversation — balanced quality, speed and price.',
  tool: 'Queries that fan out to actions (home, email, scraping, data). Tool-use quality first.',
  rag: 'Retrieval answers (@files / @knowledge / @research). Optimised for tokens/sec.',
  agentic: 'Multi-step delegation and builds. Reasoning quality first.',
};

// ── app_settings keys ────────────────────────────────────────────────────────
export const SETTINGS_ENABLED_KEY = 'jkai.routing.enabled'; // kill switch; unset/null = enabled
export const SETTINGS_ASSIGNMENTS_KEY = 'jkai.routing.assignments'; // fast read path (getSetting-cached)
export const SETTINGS_CONFIG_KEY = 'jkai.routing.config'; // weights / floors / ceiling

// ── datastore collections ────────────────────────────────────────────────────
export const RUNS_COLLECTION = 'model-routing-runs'; // one record per nightly/manual selection
export const EVENTS_COLLECTION = 'model-routing-events'; // one record per conversation routing decision

export const SYSTEM_ACTOR = 'system';
export const OWNER_PHONE = '+447359228511';

export const CRON_EXPR = '0 4 * * *'; // 04:00 daily — after self-improve (03:30), before the morning briefing (06:30)
export const CRON_TZ = 'Europe/London';

export const ROUTING_PERMS = {
  read: ['owner', 'jkai', 'system'],
  write: ['system', 'owner'],
  delete: ['owner', 'system'],
};

// ── selection policy (all dashboard-tunable via SETTINGS_CONFIG_KEY) ──────────
/** Per-profile hybrid-score weights. Price weight is deliberately capped low so
 *  the algorithm never over-biases cost (John: "don't over bias cost"). */
export interface ProfileWeights {
  quality: number; // AA agentic_index axis
  price: number; // blended $/1M (log-scaled, cheaper better)
  speed: number; // tokens/sec (log-scaled)
}

export interface RoutingConfig {
  weights: Record<ModelProfile, ProfileWeights>;
  /** Minimum agentic-index PERCENTILE a candidate must reach, per profile, before
   *  price is even considered. The primary anti-cheap guard. */
  qualityFloorPct: Record<ModelProfile, number>;
  /** Hard ceiling on blended $/1M — keeps the absolute most expensive models out. */
  priceCeilingPerM: number;
  /** Minimum context window (tokens). */
  minContext: number;
  /** Success-bias strength: score is multiplied by (1 - k) + 2k·successRate,
   *  so k=0.2 → 0.8×–1.2×. */
  successBiasK: number;
}

export const PRICE_WEIGHT_CAP = 0.25;

export const DEFAULT_CONFIG: RoutingConfig = {
  weights: {
    general: { quality: 0.45, price: 0.25, speed: 0.3 },
    tool: { quality: 0.55, price: 0.15, speed: 0.3 },
    rag: { quality: 0.3, price: 0.2, speed: 0.5 },
    agentic: { quality: 0.6, price: 0.15, speed: 0.25 },
  },
  qualityFloorPct: { general: 45, tool: 60, rag: 40, agentic: 65 },
  priceCeilingPerM: 30,
  minContext: 32_000,
  successBiasK: 0.2,
};

// ── persisted shapes ─────────────────────────────────────────────────────────
/** A single profile's chosen model + why (persisted in assignments + runs). */
export interface ModelAssignment {
  profile: ModelProfile;
  modelId: string;
  modelName: string;
  /** Final score after success bias, in [0,~1.2]. */
  score: number;
  hybridScore: number;
  blendedPerM: number | null;
  agenticIndex: number | null;
  throughput: number | null;
  successRate: number | null; // Wilson lower bound used for the bias, null when unrated
  successSamples: number;
  reason: string;
}

export type RoutingAssignments = Partial<Record<ModelProfile, ModelAssignment>>;

export interface RoutingRun {
  id: string;
  trigger: 'cron' | 'manual';
  status: 'running' | 'complete' | 'failed';
  startedAt: string;
  finishedAt?: string;
  assignments: RoutingAssignments;
  /** How many catalogue models were considered after the candidate filter, per profile. */
  candidateCounts: Partial<Record<ModelProfile, number>>;
  catalogueSize: number;
  whatsappSent: boolean;
  error?: string;
}

/** One routing decision, keyed by conversationId; outcome filled in later. */
export interface RoutingEvent {
  conversationId: string;
  profile: ModelProfile;
  modelId: string;
  decidedAt: string;
  /** null until a signal arrives; true = model got it right first time. */
  correctFirstTime: boolean | null;
  signal?: 'vote_up' | 'vote_down' | 'tool_error';
}

export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Cast a typed record to the datastore's generic data bag. */
export function asData<T>(value: T): Record<string, unknown> {
  return value as unknown as Record<string, unknown>;
}

export function toCtx(modelId: string): ModelContext {
  return { provider: 'openrouter', modelId };
}
