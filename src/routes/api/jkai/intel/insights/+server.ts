// Automated insights — what the graph noticed without being asked.
//
// The findings are still COMPUTED per request (the detectors are pure and the
// analysis is cached, so recomputing is cheap and always current), but they are
// now also PERSISTED, which is what gives each one an identity that survives
// the next run. That identity is what lets a finding be dismissed, snoozed, and
// compared against yesterday — see $lib/jkai/intel/insight-store.
//
//   GET  ?limit= ?kind= ?status=   the computed findings, wearing their saved state
//   POST { id, action }            dismiss / snooze / mark seen or actioned
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getGraphAnalysis, ensureEmbeddings } from '$lib/jkai/intel/analytics/load';
import { generateInsights } from '$lib/jkai/intel/analytics/insights';
import { scoreSurprisingLinks, predictMissingLinks } from '$lib/jkai/intel/analytics/surprise';
import {
  dedupeKeyFor,
  insightsByDedupeKey,
  isInsightStatus,
  persistInsights,
  setInsightStatus,
  snoozeInsight,
  type StorableInsight,
} from '$lib/jkai/intel/insight-store';
import type { IntelInsight } from '$lib/db/schema';

/**
 * The analysis snapshot the last persist ran against. Findings only change when
 * the analysis does, so keying on `computedAt` writes once per snapshot rather
 * than once per dashboard poll — which, with a polling UI, is the difference
 * between a handful of upserts an hour and a few thousand.
 *
 * Deliberately NOT exported: a non-handler export from a +server.ts breaks the
 * route at runtime.
 */
let lastPersistedAnalysis = 0;

/**
 * The detectors, memoised against the analysis snapshot they ran on.
 *
 * The header above says recomputing per request is cheap because the analysis
 * is cached. That was true of the detectors themselves; it was never true of
 * the three-hop surprise sweep, which reaches ~830k pairs on the live graph and
 * cost 53 s per request until it was rewritten (`scripts/bench-intel-insights.ts`).
 * It is ~2.5 s now, which is still far too much to pay on every poll of a
 * dashboard that polls.
 *
 * Keyed on `computedAt` for the same reason `lastPersistedAnalysis` is: the
 * findings are a pure function of the snapshot, so while the snapshot holds
 * there is nothing to recompute. `getGraphAnalysis` bumps `computedAt` whenever
 * the graph changes, so this can never serve findings from a stale graph.
 *
 * Deliberately NOT exported — a non-handler export from a +server.ts breaks the
 * route at runtime.
 */
let derived: {
  computedAt: number;
  all: ReturnType<typeof generateInsights>;
  surprising: ReturnType<typeof scoreSurprisingLinks>;
  predicted: ReturnType<typeof predictMissingLinks>;
} | null = null;

async function persistOnce(computedAt: number, insights: StorableInsight[]): Promise<void> {
  if (computedAt === lastPersistedAnalysis) return;
  lastPersistedAnalysis = computedAt;
  try {
    await persistInsights(insights, `insights:${new Date(computedAt).toISOString()}`);
  } catch (err) {
    // Reading the dashboard must not fail because the write did. Reset so the
    // next request retries rather than skipping this snapshot forever.
    lastPersistedAnalysis = 0;
    console.error('[intel/insights] persist failed', err);
  }
}

/** Statuses a finding is hidden at unless explicitly asked for. */
const HIDDEN_STATUSES = new Set(['dismissed', 'snoozed']);

/** A finding with no stored row yet has never been triaged. */
const IMPLICIT_STATUS = 'new';

function statusFilter(param: string | null): (status: string) => boolean {
  if (!param) return (status) => !HIDDEN_STATUSES.has(status);
  const wanted = param
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (wanted.includes('all')) return () => true;
  const valid = new Set<string>(wanted.filter(isInsightStatus));
  if (!valid.size) throw error(400, 'status must be one of new, seen, dismissed, actioned, snoozed, all');
  return (status) => valid.has(status);
}

export const GET: RequestHandler = async ({ url }) => {
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 20), 1), 60);
  const kind = url.searchParams.get('kind');
  const keep = statusFilter(url.searchParams.get('status'));

  const analysis = await getGraphAnalysis();
  const { index, community, embeddings, suppressedPairs } = analysis;

  const decorate = (ids: string[]) =>
    ids
      .map((id) => index.byId.get(id))
      .filter((n): n is NonNullable<typeof n> => Boolean(n))
      .map((n) => ({ id: n.id, name: n.name, type: n.typeName, icon: n.icon, color: n.color }));

  if (derived?.computedAt !== analysis.computedAt) {
    // Semantic distance is one of the surprise factors, so the embeddings have
    // to be in place before either detector runs. Awaited only on a recompute:
    // this is the one surface that needs them.
    await ensureEmbeddings(analysis);
    derived = {
      computedAt: analysis.computedAt,
      // Persist the FULL set, not the filtered one: a `?kind=` view must not
      // stop findings of other kinds from being recorded.
      all: generateInsights(analysis),
      surprising: scoreSurprisingLinks(
        { index, membership: community.membership, embeddings },
        { maxHops: 3, limit: 20, minScore: 0.08 },
      ),
      predicted: predictMissingLinks(
        // suppressedPairs, or every rejected prediction returns on the next run.
        { index, membership: community.membership, suppressedPairs },
        { limit: 15, minScore: 0.8 },
      ),
    };
  }
  const { all, surprising, predicted } = derived;

  await persistOnce(analysis.computedAt, all);
  const stored = await insightsByDedupeKey(all.map((i) => dedupeKeyFor(i))).catch(
    () => new Map<string, IntelInsight>(),
  );

  let insights = all;
  if (kind) insights = insights.filter((i) => i.kind === kind);
  insights = insights.filter((i) => keep(stored.get(dedupeKeyFor(i))?.status ?? IMPLICIT_STATUS));

  return json({
    insights: insights.slice(0, limit).map((i) => {
      const row = stored.get(dedupeKeyFor(i));
      return {
        id: i.id,
        kind: i.kind,
        title: i.title,
        detail: i.detail,
        score: Number(i.score.toFixed(3)),
        action: i.action,
        actionLabel: i.actionLabel,
        actionPayload: i.actionPayload,
        entities: decorate(i.entityIds),
        // Added, not substituted: `id` remains the detector's own id so
        // existing callers keep working. `insightId` is the row to POST at.
        insightId: row?.id ?? null,
        dedupeKey: dedupeKeyFor(i),
        status: row?.status ?? IMPLICIT_STATUS,
        snoozeUntil: row?.snoozeUntil ? row.snoozeUntil.toISOString() : null,
        firstSeenAt: row?.createdAt ? row.createdAt.toISOString() : null,
      };
    }),
    unlikelyRelations: surprising.map((l) => ({
      score: Number(l.score.toFixed(3)),
      hops: l.hops,
      reasons: l.reasons,
      crossCommunity: l.crossCommunity,
      sharedNeighbours: l.sharedNeighbours,
      semanticDistance: l.semanticDistance === null ? null : Number(l.semanticDistance.toFixed(3)),
      entities: decorate([l.a, l.b]),
    })),
    predictedLinks: predicted.map((p) => ({
      score: Number(p.score.toFixed(2)),
      reason: p.reason,
      entities: decorate([p.a, p.b]),
      via: decorate(p.sharedNeighbours.slice(0, 5)),
    })),
    computedAt: analysis.computedAt,
  });
};

export const POST: RequestHandler = async ({ request }) => {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const id = String(body.id ?? body.insightId ?? '').trim();
  if (!id) throw error(400, 'id is required');

  const action = String(body.action ?? '').trim();
  const reason = body.reason == null ? null : String(body.reason);
  let row: IntelInsight | null;

  switch (action) {
    case 'dismiss':
      row = await setInsightStatus(id, 'dismissed', reason);
      break;
    case 'snooze':
      row = await snoozeInsight(id, Number(body.days ?? 7));
      break;
    case 'seen':
      row = await setInsightStatus(id, 'seen');
      break;
    case 'actioned':
      row = await setInsightStatus(id, 'actioned');
      break;
    // Undo — puts a dismissed or snoozed finding back in the queue.
    case 'reset':
      row = await setInsightStatus(id, 'new');
      break;
    default:
      throw error(400, 'action must be one of dismiss, snooze, seen, actioned, reset');
  }

  if (!row) throw error(404, 'insight not found');
  return json({ ok: true, insight: row });
};
