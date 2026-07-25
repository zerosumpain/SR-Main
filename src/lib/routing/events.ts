// Routing-event + run persistence over the datastore (mirrors briefing's
// ensure/upsert/query pattern). One event per conversation records which model
// the router chose; its outcome (correct-first-time) is filled in later by a
// 👍/👎 vote. Runs record each nightly/manual selection.
import { ensureCollection, upsertRecord, getRecordByKey, queryRecords } from '$lib/datastore';
import { DatastoreError } from '$lib/datastore/types';
import { getSetting, setSetting, resolveDefaultModel } from '$lib/server/models/settings';
import type { ModelContext } from '$lib/server/models/types';
import {
  RUNS_COLLECTION,
  EVENTS_COLLECTION,
  ROUTING_PERMS,
  SYSTEM_ACTOR,
  SETTINGS_ASSIGNMENTS_KEY,
  SETTINGS_ENABLED_KEY,
  SETTINGS_CONFIG_KEY,
  SETTINGS_OVERRIDES_KEY,
  DEFAULT_CONFIG,
  PROFILES,
  asData,
  errMsg,
  toCtx,
  type ModelProfile,
  type ModelSource,
  type RoutingAssignments,
  type RoutingEvent,
  type RoutingOverrides,
  type RoutingRun,
  type RoutingConfig,
} from './types';

export async function ensureRoutingCollections(): Promise<void> {
  await ensureCollection(
    RUNS_COLLECTION,
    { name: 'Model routing runs', description: 'Overnight model-selection runs', isSystem: true, defaultPermissions: ROUTING_PERMS },
    SYSTEM_ACTOR,
  );
  await ensureCollection(
    EVENTS_COLLECTION,
    { name: 'Model routing events', description: 'Per-conversation routing decisions + outcomes', isSystem: true, defaultPermissions: ROUTING_PERMS },
    SYSTEM_ACTOR,
  );
}

// ── config / kill switch ─────────────────────────────────────────────────────
export async function isRoutingEnabled(): Promise<boolean> {
  // Unset/null = enabled (ships on); only an explicit false disables.
  return (await getSetting<boolean>(SETTINGS_ENABLED_KEY)) !== false;
}

export async function getRoutingConfig(): Promise<RoutingConfig> {
  const stored = await getSetting<Partial<RoutingConfig>>(SETTINGS_CONFIG_KEY);
  if (!stored) return DEFAULT_CONFIG;
  // Shallow-merge so a partial stored config never drops required fields — and
  // so a config saved before a new policy field existed picks up its default
  // (e.g. qualityFloorFrac / openWeightBonus, added 2026-07-25).
  return {
    weights: { ...DEFAULT_CONFIG.weights, ...(stored.weights ?? {}) },
    qualityFloorFrac: { ...DEFAULT_CONFIG.qualityFloorFrac, ...(stored.qualityFloorFrac ?? {}) },
    priceCeilingPerM: stored.priceCeilingPerM ?? DEFAULT_CONFIG.priceCeilingPerM,
    minContext: stored.minContext ?? DEFAULT_CONFIG.minContext,
    successBiasK: stored.successBiasK ?? DEFAULT_CONFIG.successBiasK,
    openWeightBonus: stored.openWeightBonus ?? DEFAULT_CONFIG.openWeightBonus,
    openWeightsOnly: stored.openWeightsOnly ?? DEFAULT_CONFIG.openWeightsOnly,
  };
}

export async function setRoutingConfig(cfg: RoutingConfig): Promise<void> {
  await setSetting(SETTINGS_CONFIG_KEY, cfg);
}

export async function setRoutingEnabled(enabled: boolean): Promise<void> {
  await setSetting(SETTINGS_ENABLED_KEY, enabled);
}

// ── assignments (the fast read path) ─────────────────────────────────────────
export async function loadAssignments(): Promise<RoutingAssignments> {
  return (await getSetting<RoutingAssignments>(SETTINGS_ASSIGNMENTS_KEY)) ?? {};
}

export async function saveAssignments(a: RoutingAssignments): Promise<void> {
  await setSetting(SETTINGS_ASSIGNMENTS_KEY, a);
}

// ── manual per-profile overrides ─────────────────────────────────────────────
export async function loadOverrides(): Promise<RoutingOverrides> {
  return (await getSetting<RoutingOverrides>(SETTINGS_OVERRIDES_KEY)) ?? {};
}

/** Pin a profile to a model (modelId) or clear the pin (null). Pins survive the
 *  nightly re-selection — the run still records what it would have chosen. */
export async function setOverride(profile: ModelProfile, modelId: string | null): Promise<RoutingOverrides> {
  const current = await loadOverrides();
  const next: RoutingOverrides = { ...current };
  if (modelId) {
    next[profile] = { modelId, pinnedAt: new Date().toISOString() };
  } else {
    delete next[profile];
  }
  await setSetting(SETTINGS_OVERRIDES_KEY, next);
  return next;
}

/** Resolve the model for a profile: a manual pin wins, then the nightly pick,
 *  then the site default. Cheap (getSetting is cached) — safe on the chat
 *  request path. */
export async function resolveModelForProfile(
  profile: ModelProfile,
): Promise<ModelContext & { source: ModelSource }> {
  const [overrides, assignments] = await Promise.all([loadOverrides(), loadAssignments()]);
  const pinned = overrides[profile];
  if (pinned?.modelId) return { ...toCtx(pinned.modelId), source: 'override' };
  const assigned = assignments[profile];
  if (assigned?.modelId) return { ...toCtx(assigned.modelId), source: 'auto' };
  return { ...(await resolveDefaultModel('chat')), source: 'default' };
}

/** The full picture for one profile — what the nightly run chose, what (if
 *  anything) is pinned over it, and what will actually answer. Drives the /jkai
 *  picker chips and the dashboard. */
export async function describeProfiles(): Promise<
  Array<{
    profile: ModelProfile;
    autoModelId: string | null;
    autoReason: string | null;
    overrideModelId: string | null;
    pinnedAt: string | null;
    effectiveModelId: string;
    source: ModelSource;
  }>
> {
  const [overrides, assignments, siteDefault] = await Promise.all([
    loadOverrides(),
    loadAssignments(),
    resolveDefaultModel('chat'),
  ]);
  return PROFILES.map((profile) => {
    const auto = assignments[profile] ?? null;
    const pinned = overrides[profile] ?? null;
    const effectiveModelId = pinned?.modelId ?? auto?.modelId ?? siteDefault.modelId;
    const source: ModelSource = pinned ? 'override' : auto ? 'auto' : 'default';
    return {
      profile,
      autoModelId: auto?.modelId ?? null,
      autoReason: auto?.reason ?? null,
      overrideModelId: pinned?.modelId ?? null,
      pinnedAt: pinned?.pinnedAt ?? null,
      effectiveModelId,
      source,
    };
  });
}

// ── events ───────────────────────────────────────────────────────────────────
export async function recordRoutingDecision(ev: {
  conversationId: string;
  profile: ModelProfile;
  modelId: string;
}): Promise<void> {
  const data: RoutingEvent = {
    conversationId: ev.conversationId,
    profile: ev.profile,
    modelId: ev.modelId,
    decidedAt: new Date().toISOString(),
    correctFirstTime: null,
  };
  await upsertRecord(EVENTS_COLLECTION, { key: ev.conversationId, data: asData(data) }, SYSTEM_ACTOR);
}

/** Attach an outcome to a conversation's routing event. Best-effort: silently
 *  no-ops if there was no routing decision for that conversation. */
export async function recordOutcome(
  conversationId: string,
  correct: boolean,
  signal: RoutingEvent['signal'],
): Promise<void> {
  let existing: RoutingEvent | null = null;
  try {
    const rec = await getRecordByKey(EVENTS_COLLECTION, conversationId, SYSTEM_ACTOR);
    existing = rec.data as unknown as RoutingEvent;
  } catch (err) {
    if (err instanceof DatastoreError && err.code === 'not_found') return;
    throw err;
  }
  const updated: RoutingEvent = { ...existing, correctFirstTime: correct, signal };
  await upsertRecord(EVENTS_COLLECTION, { key: conversationId, data: asData(updated) }, SYSTEM_ACTOR);
}

export async function listEvents(limit = 2000): Promise<RoutingEvent[]> {
  const { records } = await queryRecords(
    EVENTS_COLLECTION,
    { sort: { field: 'updatedAt', dir: 'desc' }, limit },
    SYSTEM_ACTOR,
  );
  return records.map((r) => r.data as unknown as RoutingEvent);
}

// ── runs ─────────────────────────────────────────────────────────────────────
export async function persistRun(run: RoutingRun): Promise<void> {
  await upsertRecord(RUNS_COLLECTION, { key: run.id, data: asData(run) }, SYSTEM_ACTOR);
}

export async function listRuns(limit = 20): Promise<RoutingRun[]> {
  const { records } = await queryRecords(
    RUNS_COLLECTION,
    { sort: { field: 'updatedAt', dir: 'desc' }, limit },
    SYSTEM_ACTOR,
  );
  return records.map((r) => r.data as unknown as RoutingRun);
}

export { errMsg };
