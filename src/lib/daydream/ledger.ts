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

import { and, desc, eq, gte, inArray, isNotNull, sql, type SQL } from 'drizzle-orm';
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
import {
  adaptiveThreshold,
  kindWeight,
  meanRelevance,
  mergeCounts,
  tallyFeedback,
  tallyRelevance,
  type FeedbackRow,
  type RelevanceRow,
} from './scoring';
import { mutedKinds, loadFeedback, loadRelevanceRows } from './thought-store';
import type { Readiness, SnapshotSource } from './snapshot-types';
import {
  FAMILIES,
  FAMILY_ORDER,
  FEED_STATES,
  familyOf,
  feedStateOf,
  statusesFor,
  type FeedState,
} from './thought-groups';

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
  /** The jkai_memories row the reviewer's ruling was written to, and when it
   *  ruled. A verdict with no memory behind it is one the engine meets again
   *  tomorrow with no idea it has already been settled. */
  reviewMemoryId: string | null;
  reviewAt: string | null;
  /** The derived intel_notes row this thought was woven into once the owner
   *  called it useful. Null until then, and the card's link into the graph. */
  intelNoteId: string | null;
  intelWovenAt: string | null;
  status: string;
  suppressedReason: string | null;
  channel: string | null;
  deliveredAt: string | null;
  feedback: string | null;
  /** The owner's own dial, 1..5, on how much the SUBJECT matters — distinct
   *  from `feedback`, which rules on whether the suggestion was worth having.
   *  Null until he has said. See `relevance` in schema.ts. */
  relevance: number | null;
  relevanceAt: string | null;
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
  /**
   * What the background geocoder thinks is there.
   *
   * Already on the row and already sent for the naming QUEUE; the list had
   * never carried it, so an unnamed place arrived at the page as a rhythm and
   * nothing else and every card in the list read identically. It is a guess
   * and is labelled as one — only a confirmed name is ever quoted back as fact.
   */
  suggestedLabel: string | null;
  suggestedAddress: string | null;
}

export interface DetectorRow {
  kind: string;
  description: string;
  readiness: Readiness | null;
  /** Learned multiplier. 1 means the ledger has no opinion yet.
   *
   *  Computed from BOTH instruments — verdicts and relevance ratings — because
   *  this column is the page's account of why a kind ranks where it does, and
   *  `persistCandidates` scores with both. A weight here that omitted relevance
   *  would be a number on the page that disagrees with the number in the
   *  ledger, which is the exact failure the "never show an unexplained number"
   *  rule exists to prevent. */
  weight: number;
  useful: number;
  notUseful: number;
  /** What he has said about the SUBJECT, plainly. Null when nothing of this
   *  kind has been rated — which reads differently from a mean of 3. */
  relevance: { mean: number; n: number } | null;
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
  const [detect, muted, feedback, relevance] = await Promise.all([
    lastPulse('daydream-detect'),
    mutedKinds(),
    loadFeedback(),
    loadRelevanceRows(),
  ]);

  const details = (detect?.details ?? {}) as Record<string, unknown>;
  const readiness = (details.readiness ?? {}) as Record<string, Readiness>;

  const byKind = new Map<string, FeedbackRow[]>();
  for (const f of feedback) {
    const list = byKind.get(f.kind) ?? [];
    list.push(f);
    byKind.set(f.kind, list);
  }
  const relByKind = new Map<string, RelevanceRow[]>();
  for (const r of relevance) {
    const list = relByKind.get(r.kind) ?? [];
    list.push(r);
    relByKind.set(r.kind, list);
  }

  const now = new Date();
  return DETECTORS.map((d) => {
    const rows = byKind.get(d.kind) ?? [];
    const relRows = relByKind.get(d.kind) ?? [];
    // The same merge `buildScoringContext` does, so this column and the score
    // the engine actually assigns cannot drift apart.
    const counts = mergeCounts(tallyFeedback(rows, now), tallyRelevance(relRows, now));
    return {
      kind: d.kind,
      description: d.description,
      readiness: readiness[d.kind] ?? null,
      weight: kindWeight(counts),
      useful: rows.filter((r) => r.feedback === 'useful').length,
      notUseful: rows.filter((r) => r.feedback === 'not_useful').length,
      relevance: meanRelevance(relRows),
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
  return { value: adaptiveThreshold(feedback, new Date()), feedbackCount: feedback.length };
}

export async function loadThoughts(limit = 60, where?: SQL): Promise<LedgerThought[]> {
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
      reviewMemoryId: daydreamThoughts.reviewMemoryId,
      reviewAt: daydreamThoughts.reviewAt,
      intelNoteId: daydreamThoughts.intelNoteId,
      intelWovenAt: daydreamThoughts.intelWovenAt,
      placeLabel: daydreamPlaces.label,
      placeSuggested: daydreamPlaces.suggestedLabel,
      placeAddress: daydreamPlaces.suggestedAddress,
      placeVisits: daydreamPlaces.visitCount,
      status: daydreamThoughts.status,
      suppressedReason: daydreamThoughts.suppressedReason,
      channel: daydreamThoughts.channel,
      deliveredAt: daydreamThoughts.deliveredAt,
      feedback: daydreamThoughts.feedback,
      relevance: daydreamThoughts.relevance,
      relevanceAt: daydreamThoughts.relevanceAt,
      createdAt: daydreamThoughts.createdAt,
      updatedAt: daydreamThoughts.updatedAt,
    })
    .from(daydreamThoughts)
    .leftJoin(daydreamPlaces, eq(daydreamThoughts.placeId, daydreamPlaces.id))
    .where(where)
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
    reviewMemoryId: r.reviewMemoryId,
    reviewAt: r.reviewAt?.toISOString() ?? null,
    intelNoteId: r.intelNoteId,
    intelWovenAt: r.intelWovenAt?.toISOString() ?? null,
    status: r.status,
    suppressedReason: r.suppressedReason,
    channel: r.channel,
    deliveredAt: r.deliveredAt?.toISOString() ?? null,
    feedback: r.feedback,
    relevance: r.relevance,
    relevanceAt: r.relevanceAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));
}

// ── The feed matrix ──────────────────────────────────────────────────────
//
// Families down, reader states across, a count in every cell — over the WHOLE
// table, not the last sixty rows. The old feed took sixty rows by created_at
// and grouped those, so a family that had been quiet for a week vanished from
// the page rather than reading "0 undecided, 14 filed".

/** SQL for "this kind belongs to family F". Mirrors `familyOf`; the two are
 *  pinned together by `feed-matrix.test.ts`. */
export function familyWhere(family: string): SQL {
  const k = daydreamThoughts.kind;
  switch (family) {
    case 'musings':
      return sql`${k} like 'musing_%'`;
    case 'mail':
      return sql`${k} like 'mail_%'`;
    case 'graph':
      return sql`${k} like 'intel_%'`;
    case 'rules':
      return sql`(${k} like 'rule_%' or ${k} = 'rule_driven')`;
    case 'places':
      return sql`${k} in ('unknown_place', 'unknown_frequent_place')`;
    default:
      return sql`not (${k} like 'musing_%' or ${k} like 'mail_%' or ${k} like 'intel_%' or ${k} like 'rule_%' or ${k} = 'rule_driven' or ${k} in ('unknown_place', 'unknown_frequent_place'))`;
  }
}

export interface FeedMatrix {
  rows: Array<{ id: string; label: string; mark: string }>;
  cols: Array<{ id: FeedState; label: string }>;
  /** cells[family][state] */
  cells: Record<string, Record<FeedState, number>>;
  /** Undecided rows that are ALSO unrated deliveries — the rail badge. */
  total: number;
}

export async function loadFeedMatrix(): Promise<FeedMatrix> {
  const { FAMILY_MARK } = await import('./thought-groups');
  const grouped = await db
    .select({ kind: daydreamThoughts.kind, status: daydreamThoughts.status, n: sql<number>`count(*)::int` })
    .from(daydreamThoughts)
    .groupBy(daydreamThoughts.kind, daydreamThoughts.status);

  const cells: Record<string, Record<FeedState, number>> = {};
  for (const id of FAMILY_ORDER) cells[id] = { undecided: 0, sent: 0, held: 0, filed: 0 };
  let total = 0;
  for (const g of grouped) {
    const fam = familyOf(g.kind).id;
    const state = feedStateOf(g.status);
    cells[fam] ??= { undecided: 0, sent: 0, held: 0, filed: 0 };
    cells[fam][state] += g.n;
    total += g.n;
  }
  return {
    rows: FAMILY_ORDER.map((id) => ({ id, label: FAMILIES[id].label, mark: FAMILY_MARK[id] })),
    cols: FEED_STATES.map((s) => ({ id: s.id, label: s.label })),
    cells,
    total,
  };
}

export const FEED_CELL_LIMIT = 50;

/** The rows behind one cell of the matrix — or one whole column, or one whole
 *  row, when only one axis is given. Nothing given: the undecided column. */
export async function loadFeedCell(
  family: string | null,
  state: FeedState | null,
  limit = FEED_CELL_LIMIT,
): Promise<LedgerThought[]> {
  const clauses: SQL[] = [];
  if (family && family in FAMILIES) clauses.push(familyWhere(family));
  const statuses = statusesFor(state ?? 'undecided');
  if (state || !family) clauses.push(inArray(daydreamThoughts.status, statuses));
  return loadThoughts(limit, clauses.length ? and(...clauses) : undefined);
}

/** One thought by id, in the ledger shape — for a deep link that names a row
 *  outside the selected cell (`?rate=` from a notification). */
export async function loadThoughtById(id: string): Promise<LedgerThought | null> {
  const [row] = await loadThoughts(1, eq(daydreamThoughts.id, id));
  return row ?? null;
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
    suggestedLabel: p.suggestedLabel,
    suggestedAddress: p.suggestedAddress,
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
  const subjects = FAMILY_SUBJECTS.map((f) => f.subject);

  // Three queries for the whole household, not three per person. The old
  // loop ran 2–3 queries a subject and then a label lookup each — on every
  // arrival at the hub, for a tab most arrivals never opened.
  const [latestRows, todayAgg] = await Promise.all([
    db.execute(sql`
      select distinct on (${daydreamTrail.subject})
        ${daydreamTrail.subject} as subject,
        ${daydreamTrail.ts} as ts,
        ${daydreamTrail.isHome} as is_home,
        ${daydreamTrail.placeId} as place_id,
        ${daydreamTrail.distanceHomeKm} as distance_home_km,
        ${daydreamTrail.batteryPct} as battery_pct
      from ${daydreamTrail}
      where ${daydreamTrail.lat} is not null and ${daydreamTrail.subject} in ${subjects}
      order by ${daydreamTrail.subject}, ${daydreamTrail.ts} desc
    `).then((r) => r.rows as Array<{
      subject: string;
      ts: Date | string;
      is_home: boolean | null;
      place_id: string | null;
      distance_home_km: number | null;
      battery_pct: number | null;
    }>),
    db.execute(sql`
      select
        ${daydreamTrail.subject} as subject,
        count(*)::int as fixes,
        count(*) filter (where ${daydreamTrail.lat} is not null and ${daydreamTrail.isHome} = false)::int as out_rows,
        min(${daydreamTrail.ts}) filter (where ${daydreamTrail.lat} is not null and ${daydreamTrail.isHome} = false) as first_out,
        count(distinct ${daydreamTrail.placeId}) filter (where ${daydreamTrail.lat} is not null)::int as places_visited
      from ${daydreamTrail}
      where ${daydreamTrail.ts} >= ${dayStart} and ${daydreamTrail.subject} in ${subjects}
      group by ${daydreamTrail.subject}
    `).then((r) => r.rows as Array<{
      subject: string;
      fixes: number;
      out_rows: number;
      first_out: Date | string | null;
      places_visited: number;
    }>),
  ]);

  const latestBy = new Map(latestRows.map((r) => [r.subject, r]));
  const todayBy = new Map(todayAgg.map((r) => [r.subject, r]));
  const placeIds = [...new Set(latestRows.map((r) => r.place_id).filter((x): x is string => !!x))];
  const labels = placeIds.length
    ? await db
        .select({ id: daydreamPlaces.id, label: daydreamPlaces.label })
        .from(daydreamPlaces)
        .where(inArray(daydreamPlaces.id, placeIds))
    : [];
  const labelBy = new Map(labels.map((l) => [l.id, l.label]));
  const asDate = (v: Date | string | null | undefined) => (v == null ? null : v instanceof Date ? v : new Date(v));

  const members = FAMILY_SUBJECTS.map((f) => {
    const latest = latestBy.get(f.subject);
    const today = todayBy.get(f.subject);
    const latestTs = asDate(latest?.ts);
    const firstOut = asDate(today?.first_out);
    return {
      subject: f.subject,
      isHome: latest?.is_home ?? null,
      placeLabel: latest?.place_id ? (labelBy.get(latest.place_id) ?? null) : null,
      distanceHomeKm: latest?.distance_home_km == null ? null : Number(latest.distance_home_km),
      batteryPct: latest?.battery_pct == null ? null : Number(latest.battery_pct),
      ageMins: latestTs ? Math.round((now.getTime() - latestTs.getTime()) / 60_000) : null,
      lastSeenAt: latestTs,
      today: {
        firstOutMins: firstOut ? Math.round((firstOut.getTime() - dayStart.getTime()) / 60_000) : null,
        // Each positioned fix stands for one observe interval (2 min).
        minutesOut: Math.round((today?.out_rows ?? 0) * 2),
        placesVisited: today?.places_visited ?? 0,
        fixes: today?.fixes ?? 0,
      },
    };
  });
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
  // Independent of the trail and of each other: one round of latency, not
  // four in a row.
  const [sweepPulse, recentThoughts, boards] = await Promise.all([
    lastPulseFor('daydream-sweep'),
    db
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
    .limit(200),
    Promise.all(FAMILY_SUBJECTS.map((f) => loadBoard(20, f.subject))),
  ]);
  const sweepBySubject = ((sweepPulse?.details ?? {}) as Record<string, unknown>).perSubject as
    | Record<string, { testsRun?: number; naiveHits?: number; findings?: unknown[]; errors?: string[] }>
    | undefined;

  const detail: Record<string, {
    hypotheses: Awaited<ReturnType<typeof loadBoard>>;
    sweep: { testsRun: number; naiveHits: number; findings: unknown[]; errors: string[] } | null;
    thoughts: Array<{ id: string; kind: string; title: string; score: number; status: string; createdAt: string }>;
  }> = {};

  FAMILY_SUBJECTS.forEach((f, i) => {
    const sw = sweepBySubject?.[f.subject];
    detail[f.subject] = {
      hypotheses: boards[i],
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
  });

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
        // Load-bearing, not decoration. The Sunday letter is stored under
        // subject 'weekly' precisely so it cannot collide with the daily row
        // on (subject, day) — but this query dropped the column, so the page
        // received two rows sharing a day and its keyed `{#each … (d.day)}`
        // threw `each_key_duplicate`, taking the whole Discoveries tab with it
        // the first Sunday the weekly letter ever ran.
        subject: daydreamDigests.subject,
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

