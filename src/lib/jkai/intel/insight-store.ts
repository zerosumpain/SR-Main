// Persisted insights — the difference between "the graph noticed something"
// and "the graph noticed something you have not dealt with yet".
//
// The detectors in analytics/insights.ts are pure functions over a graph
// snapshot, recomputed on every dashboard load. That makes them cheap and
// internally consistent, but it also makes every finding EPHEMERAL: there is
// nothing to dismiss, nothing to snooze, and no yesterday to compare against —
// so the one question worth asking of a watchlist ("what changed?") could not
// be answered at all.
//
// This module gives a finding an identity that survives recomputation.
// `dedupeKeyFor` IS that identity, and it is the whole mechanism: stable enough
// that a dismissed finding stays dismissed tomorrow, sensitive enough that a
// materially worse version of the same finding comes back and asks again.
//
// The DB half imports `$lib/db` dynamically on purpose: `$lib/db` pulls in
// `$env/dynamic/private`, which does not resolve under vitest, and the key
// derivation below is unit-tested. Same reason as entity-query.ts.
import { and, desc, eq, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { intelInsights, type IntelInsight, type NewIntelInsight } from '$lib/db/schema';

// ── Shape ────────────────────────────────────────────────────────────────────

export const INSIGHT_STATUSES = ['new', 'seen', 'dismissed', 'actioned', 'snoozed'] as const;
export type InsightStatus = (typeof INSIGHT_STATUSES)[number];

/**
 * Statuses a re-run must not touch. A dismissal is a judgement the analyst
 * made about a specific finding; silently refreshing its text and score would
 * turn "I decided this doesn't matter" into "I decided this other thing
 * doesn't matter". Snoozes are the same decision with a timer on it.
 */
export const PROTECTED_STATUSES: readonly InsightStatus[] = ['dismissed', 'snoozed'];

export function isInsightStatus(value: unknown): value is InsightStatus {
  return typeof value === 'string' && (INSIGHT_STATUSES as readonly string[]).includes(value);
}

/**
 * Anything storable as an insight. Structurally satisfied by the analytics
 * layer's `Insight`, so detectors need no adapter; the extra fields let the
 * watchlist and (later) LLM phrasing carry more without a second type.
 */
export interface StorableInsight {
  kind: string;
  title: string;
  detail: string;
  score: number;
  entityIds: string[];
  action?: string;
  actionLabel?: string;
  actionPayload?: string;
  /** Every component of `score`, so a card can show the breakdown. */
  components?: Record<string, number>;
  narrative?: string | null;
  path?: string[] | null;
  lens?: string | null;
}

export interface PersistResult {
  created: number;
  updated: number;
  /** Existing rows left untouched because they are dismissed or snoozed. */
  suppressed: number;
}

export const EMPTY_PERSIST_RESULT: PersistResult = { created: 0, updated: 0, suppressed: 0 };

// ── Dedupe key (pure) ────────────────────────────────────────────────────────

/**
 * Score bands. Five is a deliberate compromise: the score axis is 0..1, so a
 * finding has to move a FIFTH of the whole scale before it counts as a
 * different finding and re-asks a question that was already dismissed. Finer
 * bands would let ordinary run-to-run jitter (one note added, one edge
 * re-weighted) resurrect dismissed cards nightly, which is exactly the noise
 * this table exists to stop. Coarser bands would let a mild concern grow into
 * a serious one without ever asking again.
 */
export const SCORE_BUCKETS = 5;

/**
 * Ids beyond this are dropped from the key. Findings about a handful of
 * entities are identified by their exact set; findings about a population
 * (dozens of orphans) would otherwise re-key every time one member moved.
 * Sorting first makes the surviving anchor deterministic and order-independent.
 */
export const MAX_KEY_ENTITIES = 6;

/**
 * Kinds whose `entityIds` is a rolling SAMPLE of a population rather than the
 * subject of the finding — the orphan detector shows the top 8 orphans by note
 * count, so the list churns while the finding ("you have a pile of unconnected
 * entities") does not. For these, kind plus score band IS the identity. Safe
 * because each of these detectors emits at most one finding per run, so
 * dropping the ids cannot collide two distinct findings.
 */
export const SAMPLE_KINDS: ReadonlySet<string> = new Set([
  'orphan',
  'type_outlier',
  'dominant_cluster',
]);

// Deliberately NOT sampled, though their entityIds are a slice of a much larger
// membership: a cluster finding is ABOUT one specific cluster, and two different
// clusters emerging in the same week are two different findings. Keying them on
// kind and score alone would collapse them into one and let dismissing either
// dismiss both. Their ids are stable because the member list is ordered.

/** 0..1, clamped; anything unparseable scores 0 rather than poisoning the key. */
export function clampScore(score: unknown): number {
  const n = Number(score);
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Which score band a finding sits in. 0..SCORE_BUCKETS-1. */
export function scoreBucket(score: unknown): number {
  const s = clampScore(score);
  return Math.min(SCORE_BUCKETS - 1, Math.floor(s * SCORE_BUCKETS));
}

/** Sorted, de-duplicated, capped — the order-independent entity fingerprint. */
export function normalizeKeyEntityIds(ids: readonly unknown[] | null | undefined): string[] {
  if (!Array.isArray(ids)) return [];
  const clean = ids
    .map((id) => String(id ?? '').trim())
    .filter((id) => id.length > 0)
    .sort();
  return [...new Set(clean)].slice(0, MAX_KEY_ENTITIES);
}

/**
 * The stable identity of a finding: what kind of thing it is, what it is
 * about, and how bad it is to within a band.
 *
 * PURE — no clock, no DB, no randomness. Two runs over the same graph must
 * produce byte-identical keys or the whole dismiss/snooze mechanism leaks.
 */
export function dedupeKeyFor(insight: Pick<StorableInsight, 'kind' | 'score' | 'entityIds'>): string {
  const kind = String(insight.kind ?? '').trim().toLowerCase() || 'unknown';
  const ids = SAMPLE_KINDS.has(kind) ? [] : normalizeKeyEntityIds(insight.entityIds);
  const subject = ids.length ? ids.join('+') : '*';
  return `${kind}|${subject}|b${scoreBucket(insight.score)}`;
}

// ── Row mapping (pure) ───────────────────────────────────────────────────────

/**
 * A detector's `action`/`actionLabel`/`actionPayload` triple becomes one
 * proposed action. The column is an array because a finding will eventually
 * offer several routes out of it; today's detectors offer one.
 */
function proposedActions(insight: StorableInsight): NewIntelInsight['proposedActions'] {
  if (!insight.action || !insight.actionLabel) return [];
  return [
    {
      kind: String(insight.action),
      label: String(insight.actionLabel),
      payload: String(insight.actionPayload ?? ''),
    },
  ];
}

export function toInsightRow(
  insight: StorableInsight,
  dedupeKey: string,
  runId: string | null = null,
): NewIntelInsight {
  return {
    kind: String(insight.kind ?? '').trim().toLowerCase() || 'unknown',
    title: insight.title,
    explanation: insight.detail,
    narrative: insight.narrative ?? null,
    score: clampScore(insight.score),
    components: insight.components ?? {},
    entityIds: Array.isArray(insight.entityIds) ? insight.entityIds.map(String) : [],
    path: insight.path ?? null,
    lens: insight.lens ?? null,
    dedupeKey,
    proposedActions: proposedActions(insight),
    runId,
  };
}

/** Snooze length, clamped to something a human would actually mean. */
export const MAX_SNOOZE_DAYS = 365;

export function clampSnoozeDays(days: unknown): number {
  const n = Math.round(Number(days));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(MAX_SNOOZE_DAYS, n);
}

const DAY_MS = 86_400_000;

// ── Persistence ──────────────────────────────────────────────────────────────

/**
 * Return expired snoozes to the queue.
 *
 * Also revives a snoozed row with no expiry: `snoozeInsight` always sets one,
 * so a null there means the row was written by something else (a migration, a
 * manual edit) and would otherwise be invisible forever — a silent dismissal
 * nobody chose.
 */
export async function reviveSnoozed(now: Date = new Date()): Promise<number> {
  const { db } = await import('$lib/db');
  const revived = await db
    .update(intelInsights)
    .set({ status: 'new', snoozeUntil: null, updatedAt: now })
    .where(
      and(
        eq(intelInsights.status, 'snoozed'),
        or(isNull(intelInsights.snoozeUntil), lte(intelInsights.snoozeUntil, now)),
      ),
    )
    .returning({ id: intelInsights.id });
  return revived.length;
}

/**
 * Upsert a run's findings, keyed on `dedupeKey`.
 *
 * Dismissed and snoozed rows are skipped entirely rather than updated-but-
 * status-preserved, so a dismissed card keeps the exact text the analyst
 * judged. `narrative` is never overwritten either: it is optional LLM phrasing
 * applied to the top few findings, and a plain re-run has nothing better to
 * put there than null.
 */
export async function persistInsights(
  insights: readonly StorableInsight[],
  runId: string | null = null,
): Promise<PersistResult> {
  const { db } = await import('$lib/db');

  // Two detectors can land on the same key (a broker that is also an emerging
  // hub). Postgres refuses to let one statement touch a row twice — "ON
  // CONFLICT DO UPDATE command cannot affect row a second time" — so collapse
  // first, highest score winning, exactly as generateInsights does.
  const byKey = new Map<string, StorableInsight>();
  for (const insight of insights) {
    const key = dedupeKeyFor(insight);
    const prev = byKey.get(key);
    if (!prev || clampScore(insight.score) > clampScore(prev.score)) byKey.set(key, insight);
  }
  if (byKey.size === 0) return { ...EMPTY_PERSIST_RESULT };

  await reviveSnoozed();

  const keys = [...byKey.keys()];
  const existing = await db
    .select({ dedupeKey: intelInsights.dedupeKey, status: intelInsights.status })
    .from(intelInsights)
    .where(inArray(intelInsights.dedupeKey, keys));

  const statusByKey = new Map(existing.map((r) => [r.dedupeKey, r.status]));
  const writable = keys.filter(
    (k) => !(PROTECTED_STATUSES as readonly string[]).includes(statusByKey.get(k) ?? ''),
  );
  const suppressed = keys.length - writable.length;
  if (writable.length === 0) return { created: 0, updated: 0, suppressed };

  const excluded = (column: string): SQL => sql.raw(`excluded.${column}`);
  await db
    .insert(intelInsights)
    .values(writable.map((key) => toInsightRow(byKey.get(key)!, key, runId)))
    .onConflictDoUpdate({
      target: intelInsights.dedupeKey,
      set: {
        title: excluded('title'),
        explanation: excluded('explanation'),
        score: excluded('score'),
        components: excluded('components'),
        entityIds: excluded('entity_ids'),
        path: excluded('path'),
        lens: excluded('lens'),
        proposedActions: excluded('proposed_actions'),
        runId: excluded('run_id'),
        updatedAt: new Date(),
      },
      // Belt and braces against a dismissal landing between the SELECT above
      // and this write. Without it a concurrent dismiss would keep its status
      // but silently acquire the new run's text.
      setWhere: sql`${intelInsights.status} NOT IN ('dismissed', 'snoozed')`,
    });

  const updated = writable.filter((k) => statusByKey.has(k)).length;
  return { created: writable.length - updated, updated, suppressed };
}

export interface ListInsightsOptions {
  /** One or more statuses, or 'all'. Defaults to everything still open. */
  status?: string | readonly string[];
  kind?: string | readonly string[];
  limit?: number;
}

export const DEFAULT_INSIGHT_LIMIT = 60;
export const MAX_INSIGHT_LIMIT = 500;

function toList(value: string | readonly string[] | undefined): string[] {
  if (value == null) return [];
  const raw = Array.isArray(value) ? value : String(value).split(',');
  return [...new Set(raw.map((v) => String(v).trim()).filter(Boolean))];
}

/** Clamp a caller-supplied limit; an unbounded read of this table is never wanted. */
export function clampInsightLimit(limit: unknown): number {
  const n = Math.floor(Number(limit));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_INSIGHT_LIMIT;
  return Math.min(MAX_INSIGHT_LIMIT, n);
}

export async function listInsights(options: ListInsightsOptions = {}): Promise<IntelInsight[]> {
  const { db } = await import('$lib/db');

  // Read-time revival, not just write-time: a watchlist run may not have
  // happened since the snooze expired, and the analyst opening the dashboard
  // is the moment the finding is due back.
  await reviveSnoozed();

  const statuses = toList(options.status);
  const kinds = toList(options.kind).map((k) => k.toLowerCase());
  const conditions = [];

  if (!statuses.includes('all')) {
    const valid = statuses.filter(isInsightStatus);
    if (valid.length) conditions.push(inArray(intelInsights.status, valid));
    else conditions.push(inArray(intelInsights.status, ['new', 'seen', 'actioned']));
  }
  if (kinds.length) conditions.push(inArray(intelInsights.kind, kinds));

  return db
    .select()
    .from(intelInsights)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(intelInsights.score), desc(intelInsights.createdAt))
    .limit(clampInsightLimit(options.limit ?? DEFAULT_INSIGHT_LIMIT));
}

/** Stored rows for a set of keys — lets a computed list wear its saved state. */
export async function insightsByDedupeKey(
  keys: readonly string[],
): Promise<Map<string, IntelInsight>> {
  const unique = [...new Set(keys.filter(Boolean))];
  if (!unique.length) return new Map();
  const { db } = await import('$lib/db');
  const rows = await db
    .select()
    .from(intelInsights)
    .where(inArray(intelInsights.dedupeKey, unique));
  return new Map(rows.map((r) => [r.dedupeKey, r]));
}

export async function setInsightStatus(
  id: string,
  status: InsightStatus,
  reason?: string | null,
): Promise<IntelInsight | null> {
  if (!isInsightStatus(status)) throw new Error(`unknown insight status: ${status}`);
  const { db } = await import('$lib/db');
  const [row] = await db
    .update(intelInsights)
    .set({
      status,
      // A reason belongs to a dismissal; moving to any other status clears
      // both it and the snooze timer so a revived card carries no stale
      // explanation for a decision that was reversed.
      dismissedReason: status === 'dismissed' ? (reason?.trim() || null) : null,
      snoozeUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(intelInsights.id, id))
    .returning();
  return row ?? null;
}

export async function snoozeInsight(
  id: string,
  days: number,
  now: Date = new Date(),
): Promise<IntelInsight | null> {
  const { db } = await import('$lib/db');
  const [row] = await db
    .update(intelInsights)
    .set({
      status: 'snoozed',
      snoozeUntil: new Date(now.getTime() + clampSnoozeDays(days) * DAY_MS),
      dismissedReason: null,
      updatedAt: now,
    })
    .where(eq(intelInsights.id, id))
    .returning();
  return row ?? null;
}
