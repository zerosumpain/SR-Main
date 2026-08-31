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
  daydreamTrail,
  heartbeatActions,
  heartbeatPulses,
} from '$lib/db/schema';
import { withinActiveHours as windowOpenAt } from '$lib/heartbeat/schedule';
import { DETECTORS } from './detectors';
import { loadProvenance } from './provenance';
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
  /** The review — see `$lib/daydream/adjudicate.ts`. `verified` above records
   *  only that the PHRASING was checked against the cards it cited; these
   *  record whether the claim survived being checked against the sources. Null
   *  until a reviewer has looked, which is distinct from having looked and
   *  found nothing. */
  reviewVerdict: string | null;
  reviewLikelihood: number | null;
  reviewReasoning: string | null;
  reviewNarrative: string | null;
  reviewSources: string[];
  promptTokens: number;
  completionTokens: number;
  /** The place's name, when it has one. Joined here rather than looked up in
   *  the markup so a row can say "DEC" instead of a uuid — and so a question
   *  about a place that has since been named is obvious on sight. */
  placeLabel: string | null;
  /** The geocoder's guess, for a place still unnamed — so a question on the
   *  ledger identifies somewhere even before it has been answered. */
  placeSuggested: string | null;
  placeAddress: string | null;
  placeVisits: number | null;
  score: number;
  components: Record<string, number>;
  evidence: Array<{ kind: string; id: string; note?: string }>;
  /** One-tap actions a musing proposed; executed via the run_action endpoint. */
  proposedActions: Array<{ kind: string; label: string; payload: string }>;
  placeId: string | null;
  /** What John said about this one, in his own words. */
  note: string | null;
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
  /** Separate local days anyone stayed here. `visitCount` is person-visits, so
   *  a family outing reads five; repetition is a question about days. */
  distinctDays: number;
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
      // The review. A refuted thought never reaches WhatsApp, so the feed is
      // the only place its reasoning can be read — and a verdict you cannot
      // see is one you cannot argue with, which is the half that makes "unless
      // overwritten by a user" mean anything.
      reviewVerdict: daydreamThoughts.reviewVerdict,
      reviewLikelihood: daydreamThoughts.reviewLikelihood,
      reviewReasoning: daydreamThoughts.reviewReasoning,
      reviewNarrative: daydreamThoughts.reviewNarrative,
      reviewSources: daydreamThoughts.reviewSources,
      promptTokens: daydreamThoughts.promptTokens,
      completionTokens: daydreamThoughts.completionTokens,
      score: daydreamThoughts.score,
      components: daydreamThoughts.components,
      evidence: daydreamThoughts.evidence,
      proposedActions: daydreamThoughts.proposedActions,
      placeId: daydreamThoughts.placeId,
      note: daydreamThoughts.note,
      placeLabel: daydreamPlaces.label,
      placeSuggested: daydreamPlaces.suggestedLabel,
      placeAddress: daydreamPlaces.suggestedAddress,
      placeVisits: daydreamPlaces.visitCount,
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
    reviewVerdict: r.reviewVerdict,
    reviewLikelihood: r.reviewLikelihood,
    reviewReasoning: r.reviewReasoning,
    reviewNarrative: r.reviewNarrative,
    reviewSources: (r.reviewSources ?? []) as string[],
    promptTokens: r.promptTokens,
    completionTokens: r.completionTokens,
    placeLabel: r.placeLabel,
    placeSuggested: r.placeSuggested,
    placeAddress: r.placeAddress,
    placeVisits: r.placeVisits,
    proposedActions: (r.proposedActions ?? []) as LedgerThought['proposedActions'],
    score: r.score,
    components: r.components,
    evidence: r.evidence,
    placeId: r.placeId,
    note: r.note,
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
    distinctDays: p.distinctDays,
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

/**
 * The household, for the Family tab: who is where now (coordinate-free — the
 * map fetches positions separately, on demand), how fresh each track is, and
 * the shape of each person's day so far. Today's numbers are derived from the
 * trail at read time rather than stored — the feature store owns yesterday,
 * this owns "so far".
 */
export async function loadFamily() {
  const { FAMILY_SUBJECTS } = await import('./types');
  const { localDayStart } = await import('./budget');
  const now = new Date();
  const dayStart = localDayStart(now);

  const members = [] as Array<{
    subject: string;
    isHome: boolean | null;
    placeLabel: string | null;
    distanceHomeKm: number | null;
    batteryPct: number | null;
    ageMins: number | null;
    lastSeenAt: Date | null;
    today: { firstOutMins: number | null; minutesOut: number; placesVisited: number; fixes: number };
  }>;

  for (const f of FAMILY_SUBJECTS) {
    const [latest] = await db
      .select({
        ts: daydreamTrail.ts,
        isHome: daydreamTrail.isHome,
        placeId: daydreamTrail.placeId,
        distanceHomeKm: daydreamTrail.distanceHomeKm,
        batteryPct: daydreamTrail.batteryPct,
      })
      .from(daydreamTrail)
      .where(and(eq(daydreamTrail.subject, f.subject), isNotNull(daydreamTrail.lat)))
      .orderBy(desc(daydreamTrail.ts))
      .limit(1);

    const todayRows = await db
      .select({
        ts: daydreamTrail.ts,
        isHome: daydreamTrail.isHome,
        placeId: daydreamTrail.placeId,
        lat: daydreamTrail.lat,
      })
      .from(daydreamTrail)
      .where(and(eq(daydreamTrail.subject, f.subject), gte(daydreamTrail.ts, dayStart)))
      .orderBy(daydreamTrail.ts);

    const positioned = todayRows.filter((r) => r.lat != null);
    const outRows = positioned.filter((r) => r.isHome === false);
    const firstOut = outRows[0] ?? null;
    const firstOutMins = firstOut
      ? Math.round((firstOut.ts.getTime() - dayStart.getTime()) / 60_000)
      : null;

    let placeLabel: string | null = null;
    if (latest?.placeId) {
      const [pl] = await db
        .select({ label: daydreamPlaces.label })
        .from(daydreamPlaces)
        .where(eq(daydreamPlaces.id, latest.placeId))
        .limit(1);
      placeLabel = pl?.label ?? null;
    }

    members.push({
      subject: f.subject,
      isHome: latest?.isHome ?? null,
      placeLabel,
      distanceHomeKm: latest?.distanceHomeKm ?? null,
      batteryPct: latest?.batteryPct ?? null,
      ageMins: latest ? Math.round((now.getTime() - latest.ts.getTime()) / 60_000) : null,
      lastSeenAt: latest?.ts ?? null,
      today: {
        firstOutMins,
        // Each positioned fix stands for one observe interval (2 min).
        minutesOut: Math.round(outRows.length * 2),
        placesVisited: new Set(positioned.map((r) => r.placeId).filter(Boolean)).size,
        fixes: todayRows.length,
      },
    });
  }
  // ── Per person: their own questions, findings and suggestions ──────────
  //
  // The Family tab was a presence map. Four of the five people in the trail
  // had a year of history, a feature store and nothing ever asked about them,
  // because the sweep and the hypothesis proposer both ran for John alone.
  // Both are per-subject now, so this reads what they produced.
  //
  // A suggestion is attributed to a person by its CITATIONS, never by finding
  // their name in the text: the ponder pack cards each family member as
  // `{kind:'family', id:<subject>}`, so a musing that used one carries the
  // reference. Matching on names would file "Katie's usual Tuesday" under
  // Katie and also under any other thought that happened to mention her.
  const { loadBoard } = await import('./hypotheses/store');
  const sweepPulse = await lastPulseFor('daydream-sweep');
  const sweepBySubject = ((sweepPulse?.details ?? {}) as Record<string, unknown>).perSubject as
    | Record<string, { testsRun?: number; naiveHits?: number; findings?: unknown[]; errors?: string[] }>
    | undefined;

  const recentThoughts = await db
    .select({
      id: daydreamThoughts.id,
      kind: daydreamThoughts.kind,
      title: daydreamThoughts.title,
      explanation: daydreamThoughts.explanation,
      score: daydreamThoughts.score,
      status: daydreamThoughts.status,
      evidence: daydreamThoughts.evidence,
      createdAt: daydreamThoughts.createdAt,
    })
    .from(daydreamThoughts)
    .orderBy(desc(daydreamThoughts.createdAt))
    .limit(200);

  const detail: Record<string, {
    hypotheses: Awaited<ReturnType<typeof loadBoard>>;
    sweep: { testsRun: number; naiveHits: number; findings: unknown[]; errors: string[] } | null;
    thoughts: Array<{ id: string; kind: string; title: string; score: number; status: string; createdAt: string }>;
  }> = {};

  for (const f of FAMILY_SUBJECTS) {
    const sw = sweepBySubject?.[f.subject];
    detail[f.subject] = {
      hypotheses: await loadBoard(20, f.subject),
      sweep: sw
        ? {
            testsRun: sw.testsRun ?? 0,
            naiveHits: sw.naiveHits ?? 0,
            findings: sw.findings ?? [],
            errors: sw.errors ?? [],
          }
        : null,
      thoughts: recentThoughts
        .filter((t) =>
          (t.evidence ?? []).some((e) => e.kind === 'family' && e.id === f.subject),
        )
        .slice(0, 12)
        .map((t) => ({
          id: t.id,
          kind: t.kind,
          title: t.title,
          score: t.score,
          status: t.status,
          createdAt: t.createdAt.toISOString(),
        })),
    };
  }

  return { members, detail };
}

/** Money, in one read: what went out, what is live, what is coming. */
export async function loadMoney() {
  const { daydreamSpend, daydreamOffers, intelTimelineEvents } = await import('$lib/db/schema');
  const { getSetting } = await import('$lib/server/models/settings');
  const now = new Date();
  const floor30 = new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);
  const horizon = new Date(now.getTime() + 60 * 86_400_000).toISOString().slice(0, 10);

  const [rows, offers, renewals, bankEnabled, bankPulse, bankAction] = await Promise.all([
    db
      .select({
        id: daydreamSpend.id,
        day: daydreamSpend.day,
        merchant: daydreamSpend.merchant,
        amountMinor: daydreamSpend.amountMinor,
        currency: daydreamSpend.currency,
        sourceNoteId: daydreamSpend.sourceNoteId,
      })
      .from(daydreamSpend)
      .where(and(eq(daydreamSpend.verified, true), gte(daydreamSpend.day, floor30)))
      .orderBy(desc(daydreamSpend.day)),
    db
      .select({
        id: daydreamOffers.id,
        merchant: daydreamOffers.merchant,
        summary: daydreamOffers.summary,
        code: daydreamOffers.code,
        expiresAt: daydreamOffers.expiresAt,
      })
      .from(daydreamOffers)
      .where(eq(daydreamOffers.status, 'active'))
      .orderBy(sql`${daydreamOffers.expiresAt} asc nulls last`)
      .limit(20),
    db
      .select({
        id: intelTimelineEvents.id,
        date: intelTimelineEvents.date,
        type: intelTimelineEvents.type,
        title: intelTimelineEvents.title,
      })
      .from(intelTimelineEvents)
      .where(and(gte(intelTimelineEvents.date, today), sql`${intelTimelineEvents.date} <= ${horizon}`))
      .orderBy(intelTimelineEvents.date)
      .limit(30),
    getSetting<boolean>('daydream.bank.enabled'),
    lastPulseFor('daydream-bank'),
    // When it will next be LOOKED at, not just when it last ran. A job that
    // has only ever skipped has a last-run time and no story; the next-run
    // time is the half that says whether it will ever run again.
    db
      .select({
        nextRunAt: heartbeatActions.nextRunAt,
        activeHoursStart: heartbeatActions.activeHoursStart,
        activeHoursEnd: heartbeatActions.activeHoursEnd,
        activeHoursTz: heartbeatActions.activeHoursTz,
      })
      .from(heartbeatActions)
      .where(eq(heartbeatActions.name, 'daydream-bank'))
      .limit(1)
      .then((r) => r[0] ?? null),
  ]);

  const byDay = new Map<string, number>();
  const byMerchant = new Map<string, number>();
  for (const r of rows) {
    byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.amountMinor);
    byMerchant.set(r.merchant, (byMerchant.get(r.merchant) ?? 0) + r.amountMinor);
  }

  return {
    totalMinor30d: rows.reduce((a, r) => a + r.amountMinor, 0),
    rows: rows.slice(0, 40).map((r) => ({
      ...r,
      source: r.sourceNoteId.startsWith('truelayer:')
        ? 'bank'
        : r.sourceNoteId.startsWith('paypal:')
          ? 'paypal'
          : 'receipt',
    })),
    byDay: [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, minor]) => ({ day, minor })),
    topMerchants: [...byMerchant.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([merchant, minor]) => ({ merchant, minor })),
    offers,
    renewals,
    bank: {
      enabled: bankEnabled === true,
      lastRun: bankPulse,
      nextRunAt: bankAction?.nextRunAt?.toISOString() ?? null,
      window:
        bankAction?.activeHoursStart && bankAction?.activeHoursEnd
          ? `${bankAction.activeHoursStart}–${bankAction.activeHoursEnd} ${bankAction.activeHoursTz ?? 'UTC'}`
          : null,
      /** True when the next scheduled run falls OUTSIDE the window, i.e. the
       *  job is about to skip again. Before the engine fix this was the
       *  permanent state of three daydream actions and nothing said so. */
      willSkip: bankAction?.nextRunAt
        ? !windowOpenAt(bankAction, bankAction.nextRunAt)
        : false,
    },
  };
}

/** Discoveries: the statistics stack, honestly rendered at last. */
export async function loadDiscoveries() {
  const { loadBoard } = await import('./hypotheses/store');
  const { daydreamDigests, daydreamLeads } = await import('$lib/db/schema');

  const [board, digests, leads, sweep] = await Promise.all([
    // null = every person. The board is the one home for questions now; the
    // Family tab links here rather than keeping a second copy.
    loadBoard(120, null),
    db
      .select({
        day: daydreamDigests.day,
        summary: daydreamDigests.summary,
        narrative: daydreamDigests.narrative,
        verified: daydreamDigests.verified,
        stats: daydreamDigests.stats,
      })
      .from(daydreamDigests)
      .orderBy(desc(daydreamDigests.day))
      .limit(14),
    db
      .select()
      .from(daydreamLeads)
      .orderBy(sql`${daydreamLeads.status} = 'open' desc`, desc(daydreamLeads.score))
      .limit(20),
    lastPulseFor('daydream-sweep'),
  ]);

  return {
    board,
    digests,
    leads: leads.map((l) => ({
      id: l.id,
      leadKey: l.leadKey,
      title: l.title,
      rationale: l.rationale,
      metrics: (l.metrics ?? []) as string[],
      status: l.status,
      score: l.score,
      roundsRun: l.roundsRun,
      barrenRounds: l.barrenRounds,
      hypothesesSpawned: l.hypothesesSpawned,
      hypothesesHeld: l.hypothesesHeld,
    })),
    sweep,
  };
}

/** One heartbeat action's latest pulse, compacted for the page. */
async function lastPulseFor(name: string) {
  const [row] = await db
    .select({
      ts: heartbeatPulses.ts,
      outcome: heartbeatPulses.outcome,
      summary: heartbeatPulses.summary,
      details: heartbeatPulses.details,
    })
    .from(heartbeatPulses)
    .innerJoin(heartbeatActions, eq(heartbeatActions.id, heartbeatPulses.actionId))
    .where(eq(heartbeatActions.name, name))
    .orderBy(desc(heartbeatPulses.ts))
    .limit(1);
  return row ?? null;
}

/**
 * Engine telemetry: every daydream job's health, the ponder engine's own
 * meter (cards in, musings out, audit drops — the fabrication meter belongs
 * on the page, not just in pulse JSON), and 30 days of coverage as a series.
 */
export async function loadTelemetry() {
  const { daydreamDayFeatures } = await import('$lib/db/schema');
  const now = new Date();
  const floor = new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);

  const actions = await db
    .select({
      id: heartbeatActions.id,
      name: heartbeatActions.name,
      status: heartbeatActions.status,
      cadenceSeconds: heartbeatActions.cadenceSeconds,
      lastRunAt: heartbeatActions.lastRunAt,
      nextRunAt: heartbeatActions.nextRunAt,
      consecutiveFailures: heartbeatActions.consecutiveFailures,
    })
    .from(heartbeatActions)
    .where(sql`${heartbeatActions.name} like 'daydream%'`)
    .orderBy(heartbeatActions.name);

  const jobs = [] as Array<{
    name: string;
    status: string;
    cadenceSeconds: number | null;
    lastRunAt: Date | null;
    consecutiveFailures: number;
    pulse: { ts: Date; outcome: string; summary: string | null } | null;
  }>;
  for (const a of actions) {
    const [pulse] = await db
      .select({ ts: heartbeatPulses.ts, outcome: heartbeatPulses.outcome, summary: heartbeatPulses.summary })
      .from(heartbeatPulses)
      .where(eq(heartbeatPulses.actionId, a.id))
      .orderBy(desc(heartbeatPulses.ts))
      .limit(1);
    jobs.push({
      name: a.name,
      status: a.status,
      cadenceSeconds: a.cadenceSeconds,
      lastRunAt: a.lastRunAt,
      consecutiveFailures: a.consecutiveFailures ?? 0,
      pulse: pulse ?? null,
    });
  }

  // The ponder meter: last few real runs (skips excluded — a skip has no meter).
  const ponderRuns = await db
    .select({ ts: heartbeatPulses.ts, details: heartbeatPulses.details })
    .from(heartbeatPulses)
    .innerJoin(heartbeatActions, eq(heartbeatActions.id, heartbeatPulses.actionId))
    .where(and(eq(heartbeatActions.name, 'daydream-ponder'), eq(heartbeatPulses.outcome, 'ok')))
    .orderBy(desc(heartbeatPulses.ts))
    .limit(6);

  const coverage = await db
    .select({ day: daydreamDayFeatures.day, coverage: daydreamDayFeatures.trailCoverage })
    .from(daydreamDayFeatures)
    .where(gte(daydreamDayFeatures.day, floor))
    .orderBy(daydreamDayFeatures.day);

  return {
    jobs,
    ponderRuns: ponderRuns.map((r) => {
      const d = (r.details ?? {}) as Record<string, unknown>;
      const musings = (d.musings ?? {}) as Record<string, unknown>;
      return {
        ts: r.ts,
        cards: typeof d.cards === 'number' ? d.cards : null,
        proposed: typeof musings.proposed === 'number' ? musings.proposed : null,
        created: typeof musings.created === 'number' ? musings.created : null,
        suppressed: typeof musings.suppressed === 'number' ? musings.suppressed : null,
        dropped: Array.isArray(d.rejected) ? d.rejected.length : null,
        leads: typeof d.leadsCreated === 'number' ? d.leadsCreated : null,
      };
    }),
    coverage,
  };
}

/**
 * Delivery facts the page used to hardcode and let drift: the daily cap read
 * "4" as a literal while deliver.ts owned the real number, and the ask-at
 * threshold was a second copy of MIN_VISITS_TO_ASK. The push-subscriber state
 * is here because it explains the dead learning loop — no subscriber means
 * every thought falls back to a chat note, where feedback rarely comes.
 */
export async function loadDelivery() {
  const { MAX_PER_DAY, PER_KIND_COOLDOWN_HOURS, hasPushSubscriber, hasWhatsAppOwner } = await import('./deliver');
  const { MIN_VISITS_TO_ASK } = await import('./types');
  return {
    maxPerDay: MAX_PER_DAY,
    perKindCooldownHours: PER_KIND_COOLDOWN_HOURS,
    minVisitsToAsk: MIN_VISITS_TO_ASK,
    hasPushSubscriber: await hasPushSubscriber(),
    hasWhatsApp: await hasWhatsAppOwner(),
  };
}

/** Everything the page needs, in one round of queries. */
export async function loadLedger() {
  const [engine, detectors, threshold, thoughts, places, counts, budget, rules, digest, steers, delivery, family, money, discoveries, telemetry, provenance] = await Promise.all([
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
    loadDelivery(),
    loadFamily(),
    loadMoney(),
    loadDiscoveries(),
    loadTelemetry(),
    // Whether each source is actually reaching the reasoning, measured. See
    // provenance.ts — the page could show 242 registered signals and 13 green
    // jobs while 185 of those signals reached nothing at all.
    loadProvenance(),
  ]);
  return { engine, detectors, threshold, thoughts, places, counts, budget, rules, digest, steers, delivery, family, money, discoveries, telemetry, provenance };
}
