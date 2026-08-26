// src/lib/daydream/ledger.ts
//
// What the ledger page reads.
//
// One decision shapes this file: **readiness comes from the last detect pulse,
// not from a freshly built snapshot.** Building a snapshot on page load would
// cost an Apple Calendar round trip every time the page is opened, and — worse
// — it would show what the engine WOULD see now rather than what it actually
// saw when it last ran. The page's job is to report the engine, not to
// impersonate it.

import { and, desc, eq, gte, isNotNull, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import {
  daydreamDigests,
  daydreamPlaces,
  daydreamThoughts,
  heartbeatActions,
  heartbeatPulses,
} from '$lib/db/schema';
import { DETECTORS } from './detectors';
import { listSteers } from './hypotheses/steer';
import { kindWeight, tallyFeedback, coldStartThreshold, type FeedbackRow } from './scoring';
import { mutedKinds, loadFeedback } from './thought-store';
import type { Readiness, SnapshotSource } from './snapshot-types';

export interface LedgerThought {
  id: string;
  kind: string;
  title: string;
  explanation: string;
  narrative: string | null;
  /** null = no model prose. true = the verify pass ruled on it. false = prose
   *  that nothing checked, which the minimal depth plan produces routinely. */
  verified: boolean | null;
  narrativeDroppedReason: string | null;
  promptTokens: number;
  completionTokens: number;
  /** The place's name, when it has one. Joined here rather than looked up in
   *  the markup so a row can say "DEC" instead of a uuid — and so a question
   *  about a place that has since been named is obvious on sight. */
  placeLabel: string | null;
  score: number;
  components: Record<string, number>;
  evidence: Array<{ kind: string; id: string; note?: string }>;
  placeId: string | null;
  status: string;
  suppressedReason: string | null;
  channel: string | null;
  deliveredAt: string | null;
  feedback: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LedgerPlace {
  id: string;
  /**
   * Coordinates, for the naming map.
   *
   * Merge 3 deliberately withheld these — the page did not plot anything, and a
   * lat/lon in a payload is the one thing here that matters if it escapes the
   * gate. That call is reversed on the owner's instruction (2026-08-26): naming
   * a place from a bare visit count is a memory test, and a map makes it a
   * recognition. The route is owner-gated and the payload never leaves it.
   */
  lat: number;
  lon: number;
  radiusM: number;
  label: string | null;
  kind: string;
  source: string;
  visitCount: number;
  medianDwellMins: number;
  dayHistogram: number[];
  hourHistogram: number[];
  lastSeenAt: string | null;
  status: string;
  hasMemory: boolean;
}

export interface DetectorRow {
  kind: string;
  description: string;
  readiness: Readiness | null;
  /** Learned multiplier. 1 means the ledger has no opinion yet. */
  weight: number;
  useful: number;
  notUseful: number;
  muted: boolean;
}

export interface EngineState {
  /** Null until the detect activity has run at least once. */
  lastDetectAt: string | null;
  lastObserveAt: string | null;
  coverage: { last24h: number; last7d: number } | null;
  trailSpanDays: number | null;
  sources: SnapshotSource[];
  /** Actions that exist but are not running. */
  pausedActions: string[];
  summary: string | null;
}

/** The most recent pulse for a named heartbeat action, with its details. */
async function lastPulse(actionName: string) {
  const [row] = await db
    .select({
      ts: heartbeatPulses.ts,
      summary: heartbeatPulses.summary,
      outcome: heartbeatPulses.outcome,
      details: heartbeatPulses.details,
    })
    .from(heartbeatPulses)
    .innerJoin(heartbeatActions, eq(heartbeatActions.id, heartbeatPulses.actionId))
    .where(eq(heartbeatActions.name, actionName))
    .orderBy(desc(heartbeatPulses.ts))
    .limit(1);
  return row ?? null;
}

export async function loadEngineState(): Promise<EngineState> {
  const [detect, observe, actions] = await Promise.all([
    lastPulse('daydream-detect'),
    lastPulse('daydream-observe'),
    db
      .select({ name: heartbeatActions.name, status: heartbeatActions.status })
      .from(heartbeatActions)
      .where(sql`${heartbeatActions.name} like 'daydream%'`),
  ]);

  const details = (detect?.details ?? {}) as Record<string, unknown>;

  return {
    lastDetectAt: detect?.ts?.toISOString() ?? null,
    lastObserveAt: observe?.ts?.toISOString() ?? null,
    coverage:
      (details.coverage as EngineState['coverage']) ?? null,
    trailSpanDays:
      typeof details.trailSpanDays === 'number' ? details.trailSpanDays : null,
    sources: Array.isArray(details.sources) ? (details.sources as SnapshotSource[]) : [],
    pausedActions: actions.filter((a) => a.status !== 'active').map((a) => a.name),
    summary: detect?.summary ?? null,
  };
}

/**
 * One row per detector: what it needs, what the ledger has learned about it,
 * and whether the owner has silenced it.
 *
 * Every detector appears, including ones that have never fired. A detector
 * missing from this list would be indistinguishable from one that is quiet,
 * which is the same conflation the readiness gate exists to prevent.
 */
export async function loadDetectorRows(): Promise<DetectorRow[]> {
  const [detect, muted, feedback] = await Promise.all([
    lastPulse('daydream-detect'),
    mutedKinds(),
    loadFeedback(),
  ]);

  const details = (detect?.details ?? {}) as Record<string, unknown>;
  const readiness = (details.readiness ?? {}) as Record<string, Readiness>;

  const byKind = new Map<string, FeedbackRow[]>();
  for (const f of feedback) {
    const list = byKind.get(f.kind) ?? [];
    list.push(f);
    byKind.set(f.kind, list);
  }

  const now = new Date();
  return DETECTORS.map((d) => {
    const rows = byKind.get(d.kind) ?? [];
    const counts = tallyFeedback(rows, now);
    return {
      kind: d.kind,
      description: d.description,
      readiness: readiness[d.kind] ?? null,
      weight: kindWeight(counts),
      useful: rows.filter((r) => r.feedback === 'useful').length,
      notUseful: rows.filter((r) => r.feedback === 'not_useful').length,
      muted: muted.has(d.kind),
    };
  });
}

/** Codex budget utilisation — the owner's caps, and how close to them
 *  daydreaming is actually running. Under-running is a finding too: the whole
 *  instruction was to sit near the limit rather than far below it. */
export async function loadBudget() {
  try {
    const { resolveDaydreamModel } = await import('./compose');
    const { budgetStatus } = await import('./budget');
    const model = await resolveDaydreamModel();
    const status = await budgetStatus({ isCodexModel: model.provider === 'codex' });
    return { ...status, modelId: model.modelId, provider: model.provider };
  } catch (err) {
    console.error('[daydream] budget read failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Model-authored rules: what is waiting on a decision, and what is live. */
export async function loadRules() {
  try {
    const { listRules } = await import('./rules/store');
    return await listRules();
  } catch (err) {
    console.error('[daydream] rules read failed:', err instanceof Error ? err.message : err);
    return [];
  }
}

/** The current delivery threshold, and what it is derived from. */
export async function loadThreshold(): Promise<{ value: number; feedbackCount: number }> {
  const feedback = await loadFeedback();
  return { value: coldStartThreshold(feedback.length), feedbackCount: feedback.length };
}

export async function loadThoughts(limit = 60): Promise<LedgerThought[]> {
  const rows = await db
    .select({
      id: daydreamThoughts.id,
      kind: daydreamThoughts.kind,
      title: daydreamThoughts.title,
      explanation: daydreamThoughts.explanation,
      narrative: daydreamThoughts.narrative,
      verified: daydreamThoughts.verified,
      narrativeDroppedReason: daydreamThoughts.narrativeDroppedReason,
      promptTokens: daydreamThoughts.promptTokens,
      completionTokens: daydreamThoughts.completionTokens,
      score: daydreamThoughts.score,
      components: daydreamThoughts.components,
      evidence: daydreamThoughts.evidence,
      placeId: daydreamThoughts.placeId,
      placeLabel: daydreamPlaces.label,
      status: daydreamThoughts.status,
      suppressedReason: daydreamThoughts.suppressedReason,
      channel: daydreamThoughts.channel,
      deliveredAt: daydreamThoughts.deliveredAt,
      feedback: daydreamThoughts.feedback,
      createdAt: daydreamThoughts.createdAt,
      updatedAt: daydreamThoughts.updatedAt,
    })
    .from(daydreamThoughts)
    .leftJoin(daydreamPlaces, eq(daydreamThoughts.placeId, daydreamPlaces.id))
    .orderBy(desc(daydreamThoughts.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    explanation: r.explanation,
    narrative: r.narrative,
    verified: r.verified,
    narrativeDroppedReason: r.narrativeDroppedReason,
    promptTokens: r.promptTokens,
    completionTokens: r.completionTokens,
    placeLabel: r.placeLabel,
    score: r.score,
    components: r.components,
    evidence: r.evidence,
    placeId: r.placeId,
    status: r.status,
    suppressedReason: r.suppressedReason,
    channel: r.channel,
    deliveredAt: r.deliveredAt?.toISOString() ?? null,
    feedback: r.feedback,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

/** The most recent morning card, if there is one. */
export async function loadLatestDigest() {
  const [row] = await db
    .select()
    .from(daydreamDigests)
    .orderBy(desc(daydreamDigests.day))
    .limit(1);
  if (!row) return null;
  return {
    day: row.day,
    summary: row.summary,
    narrative: row.narrative,
    verified: row.verified,
    stats: row.stats,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function loadPlaces(): Promise<LedgerPlace[]> {
  const rows = await db
    .select()
    .from(daydreamPlaces)
    .orderBy(desc(daydreamPlaces.visitCount));

  return rows.map((p) => ({
    id: p.id,
    lat: p.lat,
    lon: p.lon,
    radiusM: p.radiusM,
    label: p.label,
    kind: p.kind,
    source: p.source,
    visitCount: p.visitCount,
    medianDwellMins: p.medianDwellMins,
    dayHistogram: p.dayHistogram,
    hourHistogram: p.hourHistogram,
    lastSeenAt: p.lastSeenAt?.toISOString() ?? null,
    status: p.status,
    hasMemory: p.memoryId != null,
  }));
}

/** Headline counts. `answered` is the one that says whether this is working. */
export async function loadCounts(): Promise<{
  byStatus: Record<string, number>;
  places: number;
  namedPlaces: number;
  unnamedPlaces: number;
  thoughts7d: number;
}> {
  const [statuses, places, recent] = await Promise.all([
    db
      .select({ status: daydreamThoughts.status, n: sql<number>`count(*)::int` })
      .from(daydreamThoughts)
      .groupBy(daydreamThoughts.status),
    db
      .select({
        total: sql<number>`count(*)::int`,
        named: sql<number>`count(*) filter (where ${daydreamPlaces.label} is not null)::int`,
      })
      .from(daydreamPlaces)
      .where(eq(daydreamPlaces.status, 'active')),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(daydreamThoughts)
      .where(gte(daydreamThoughts.createdAt, new Date(Date.now() - 7 * 86_400_000))),
  ]);

  const total = places[0]?.total ?? 0;
  const named = places[0]?.named ?? 0;

  return {
    byStatus: Object.fromEntries(statuses.map((s) => [s.status, s.n])),
    places: total,
    namedPlaces: named,
    unnamedPlaces: total - named,
    thoughts7d: recent[0]?.n ?? 0,
  };
}

/** Lift a `never this kind` mute. An absolute mute has to be reversible, or a
 *  mis-tap is permanent and the only recourse is editing app_settings by hand. */
export async function unmuteKind(kind: string): Promise<void> {
  const { setSetting } = await import('$lib/server/models/settings');
  const current = await mutedKinds();
  current.delete(kind);
  await setSetting('daydream.muted_kinds', [...current]);
}

/** Push a thought out of sight for a while. */
export async function snoozeThought(thoughtId: string, days: number): Promise<void> {
  const until = new Date(Date.now() + Math.max(1, days) * 86_400_000);
  await db
    .update(daydreamThoughts)
    .set({ status: 'snoozed', snoozeUntil: until, updatedAt: new Date() })
    .where(eq(daydreamThoughts.id, thoughtId));
}

/** Everything the page needs, in one round of queries. */
export async function loadLedger() {
  const [engine, detectors, threshold, thoughts, places, counts, budget, rules, digest, steers] = await Promise.all([
    loadEngineState(),
    loadDetectorRows(),
    loadThreshold(),
    loadThoughts(),
    loadPlaces(),
    loadCounts(),
    loadBudget(),
    loadRules(),
    loadLatestDigest(),
    listSteers(),
  ]);
  return { engine, detectors, threshold, thoughts, places, counts, budget, rules, digest, steers };
}
