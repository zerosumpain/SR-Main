/**
 * Owner-gated (admin layout). Everything the LLM spend page needs, in one load.
 *
 * The old version answered one question — "what did the agent cost?" — from one
 * table, with no way to tell whether that table saw everything. This one answers
 * four: what was spent, on what, whether the figure is complete, and what to
 * change. The fourth is why the workload states and the model catalogue are
 * loaded here: switching the model an activity runs on happens on this page, so
 * the page needs the same picture the model picker has.
 *
 * Mutations do NOT live here. Switching a model POSTs to the existing
 * /api/jkai/models/workloads (site + Hermes scopes) and /api/admin/models/settings
 * (the site default), so there is exactly one server-side guard for a model
 * change on the whole site rather than a second copy of the capability rules.
 */
import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { agentActions, openrouterModels } from '$lib/db/schema';
import { sql, gte, eq, and, isNotNull } from 'drizzle-orm';
import { describeSiteWorkloads } from '$lib/server/models/workload-settings';
import { resolveDefaultModel } from '$lib/server/models/settings';
import { getOpenRouterKeyUsage } from '$lib/server/models/openrouter-usage';
import { getOpenRouterCredits } from '$lib/server/models/openrouter-credits';
import { rHermesModels, canManageHermes } from '$lib/server/hermes-remote';
import { HERMES_WORKLOADS, WORKLOADS, type WorkloadState } from '$lib/models/workloads';
import { activityKey, allActivities } from '$lib/costs/activities';
import {
  findSwaps,
  findWaste,
  reconcile,
  type CatalogueModel,
  type SpendGroup,
} from '$lib/costs/analysis';

/** Windows the page offers. 1 is "today so far" and is deliberately included —
 *  it is the window the OpenRouter `usage_daily` figure reconciles against. */
const WINDOWS = [1, 7, 30, 90] as const;

const COST = sql<number>`coalesce(sum(${agentActions.costUsd}), 0)`;
const CALLS = sql<number>`count(*)::int`;
const T_IN = sql<number>`coalesce(sum(${agentActions.tokensInput}), 0)::bigint`;
const T_OUT = sql<number>`coalesce(sum(${agentActions.tokensOutput}), 0)::bigint`;
const T_CACHE = sql<number>`coalesce(sum(${agentActions.cacheReadTokens}), 0)::bigint`;
const T_REASON = sql<number>`coalesce(sum(${agentActions.reasoningTokens}), 0)::bigint`;
/** Calls whose cost is null — recorded, unpriced, and NOT counted as zero. */
const UNPRICED = sql<number>`count(*) filter (where ${agentActions.costUsd} is null)::int`;
const ACTIVITY = sql<string | null>`${agentActions.input} ->> 'activity'`;
const SOURCE = sql<string | null>`${agentActions.input} ->> 'source'`;

const IS_LLM = eq(agentActions.actionType, 'llm_call');

/** Numeric aggregates arrive from pg as strings on bigint/numeric. */
const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/** Trim a catalogue row to what `$lib/costs/analysis` needs. Mirrors `enrich`
 *  in /api/admin/models/openrouter — same fields, same -1 sentinel handling. */
function toCatalogueModel(row: {
  id: string;
  name: string;
  promptPrice: string | null;
  completionPrice: string | null;
  contextLength: number | null;
  modality: string | null;
  raw: unknown;
}): CatalogueModel {
  const raw = (row.raw ?? {}) as {
    supported_parameters?: unknown;
    benchmarks?: { artificial_analysis?: { agentic_index?: number } };
  };
  const supported = Array.isArray(raw.supported_parameters) ? raw.supported_parameters : [];
  const price = (v: string | null): number | null => {
    if (v == null) return null;
    const x = Number(v);
    return Number.isFinite(x) && x >= 0 ? x : null;
  };
  const bench = raw.benchmarks?.artificial_analysis ?? {};
  return {
    id: row.id,
    name: row.name,
    promptPrice: price(row.promptPrice),
    completionPrice: price(row.completionPrice),
    toolsSupported: supported.includes('tools'),
    agenticIndex: typeof bench.agentic_index === 'number' ? bench.agentic_index : null,
    contextLength: row.contextLength,
    modality: row.modality,
  };
}

export const load: PageServerLoad = async ({ url }) => {
  const requested = Number(url.searchParams.get('days'));
  const days = (WINDOWS as readonly number[]).includes(requested) ? requested : 30;

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const since = (d: number) => new Date(now.getTime() - d * 86_400_000);
  const windowStart = days === 1 ? todayStart : since(days);
  const inWindow = and(IS_LLM, gte(agentActions.createdAt, windowStart));

  const [
    todayTotals,
    weekTotals,
    monthTotals,
    windowTotals,
    perDay,
    byModel,
    byActivityModel,
    topSessions,
    firstTagged,
    catalogueRows,
    siteWorkloads,
    siteDefault,
    keyUsage,
    credits,
  ] = await Promise.all([
    db
      .select({ cost: COST, calls: CALLS, tokensIn: T_IN, tokensOut: T_OUT })
      .from(agentActions)
      .where(and(IS_LLM, gte(agentActions.createdAt, todayStart))),

    db
      .select({ cost: COST, calls: CALLS })
      .from(agentActions)
      .where(and(IS_LLM, gte(agentActions.createdAt, since(7)))),

    db
      .select({ cost: COST, calls: CALLS })
      .from(agentActions)
      .where(and(IS_LLM, gte(agentActions.createdAt, since(30)))),

    db
      .select({
        cost: COST,
        calls: CALLS,
        tokensIn: T_IN,
        tokensOut: T_OUT,
        cacheRead: T_CACHE,
        reasoning: T_REASON,
        unpriced: UNPRICED,
      })
      .from(agentActions)
      .where(inWindow),

    // Daily series. `date_trunc` in the DB's timezone, which is the same clock
    // the "today" tile uses — a UTC bucket here would put the evening's spend on
    // tomorrow for half the year (see reference: local day ≠ UTC day).
    db
      .select({
        day: sql<string>`to_char(date_trunc('day', ${agentActions.createdAt}), 'YYYY-MM-DD')`,
        cost: COST,
        calls: CALLS,
      })
      .from(agentActions)
      .where(inWindow)
      .groupBy(sql`date_trunc('day', ${agentActions.createdAt})`)
      .orderBy(sql`date_trunc('day', ${agentActions.createdAt})`),

    db
      .select({
        provider: agentActions.provider,
        model: agentActions.model,
        cost: COST,
        calls: CALLS,
        tokensIn: T_IN,
        tokensOut: T_OUT,
        cacheRead: T_CACHE,
        reasoning: T_REASON,
        unpriced: UNPRICED,
      })
      .from(agentActions)
      .where(inWindow)
      .groupBy(agentActions.provider, agentActions.model)
      .orderBy(sql`coalesce(sum(${agentActions.costUsd}), 0) desc`),

    // Grouped by activity AND model, because that is the unit a swap applies
    // to: one role can have run on three models across the window, and the
    // recommendation has to be about the one it is on now.
    db
      .select({
        activity: ACTIVITY,
        source: SOURCE,
        provider: agentActions.provider,
        model: agentActions.model,
        cost: COST,
        calls: CALLS,
        tokensIn: T_IN,
        tokensOut: T_OUT,
        cacheRead: T_CACHE,
        reasoning: T_REASON,
        unpriced: UNPRICED,
      })
      .from(agentActions)
      .where(inWindow)
      .groupBy(ACTIVITY, SOURCE, agentActions.provider, agentActions.model),

    db
      .select({
        sessionId: agentActions.sessionId,
        cost: COST,
        calls: CALLS,
        firstAt: sql<string>`min(${agentActions.createdAt})`,
        lastAt: sql<string>`max(${agentActions.createdAt})`,
      })
      .from(agentActions)
      .where(and(inWindow, isNotNull(agentActions.sessionId)))
      .groupBy(agentActions.sessionId)
      .orderBy(sql`coalesce(sum(${agentActions.costUsd}), 0) desc`)
      .limit(12),

    // When activity tagging actually started, so the page can say how much of
    // the window it can speak for instead of implying it covers all of it.
    db
      .select({ at: sql<string | null>`min(${agentActions.createdAt})` })
      .from(agentActions)
      .where(and(IS_LLM, isNotNull(ACTIVITY))),

    db
      .select({
        id: openrouterModels.id,
        name: openrouterModels.name,
        promptPrice: openrouterModels.promptPrice,
        completionPrice: openrouterModels.completionPrice,
        contextLength: openrouterModels.contextLength,
        modality: openrouterModels.modality,
        raw: openrouterModels.raw,
      })
      .from(openrouterModels),

    describeSiteWorkloads(),
    resolveDefaultModel(),
    getOpenRouterKeyUsage(),
    getOpenRouterCredits(),
  ]);

  // Hermes' own roles live in its config.yaml, not our DB. Best-effort exactly
  // as /api/jkai/models/workloads does it: an engine outage must not blank the
  // page, because the site half is still true and still actionable.
  let hermesWorkloads: WorkloadState[] = [];
  let hermesError: string | null = canManageHermes() ? null : 'Hermes is not reachable from this host.';
  if (canManageHermes()) {
    try {
      const rows = await rHermesModels();
      hermesWorkloads = HERMES_WORKLOADS.map((def) => {
        const row = rows.find((r) => r.id === def.id);
        const effectiveModelId = row?.modelId ?? '—';
        return {
          id: def.id,
          scope: def.scope,
          label: def.label,
          blurb: def.blurb,
          key: def.key,
          reason: def.reason,
          requires: def.requires,
          catalogue: def.catalogue,
          setModelId: row?.modelId ?? null,
          effectiveModelId,
          source: 'hermes' as const,
          divergesFromDefault: effectiveModelId !== siteDefault.modelId,
        };
      });
    } catch (err) {
      hermesError = err instanceof Error ? err.message : String(err);
    }
  }

  const catalogue = catalogueRows.map(toCatalogueModel);

  // ── Roll the (activity, model) grid into the shapes the page renders ──────
  const groups: SpendGroup[] = byActivityModel.map((r) => ({
    activity: activityKey(r.activity ?? null, r.source ?? null),
    source: r.source ?? null,
    provider: r.provider,
    model: r.model,
    calls: n(r.calls),
    tokensIn: n(r.tokensIn),
    tokensOut: n(r.tokensOut),
    costUsd: n(r.cost),
    unpricedCalls: n(r.unpriced),
  }));

  interface ActivityRow {
    key: string;
    calls: number;
    tokensIn: number;
    tokensOut: number;
    cacheRead: number;
    reasoning: number;
    costUsd: number;
    unpricedCalls: number;
    /** Models seen serving this activity in the window, dearest first. */
    models: { model: string | null; provider: string | null; costUsd: number; calls: number }[];
  }
  const activityMap = new Map<string, ActivityRow>();
  for (const r of byActivityModel) {
    const key = activityKey(r.activity ?? null, r.source ?? null);
    const row =
      activityMap.get(key) ??
      { key, calls: 0, tokensIn: 0, tokensOut: 0, cacheRead: 0, reasoning: 0, costUsd: 0, unpricedCalls: 0, models: [] };
    row.calls += n(r.calls);
    row.tokensIn += n(r.tokensIn);
    row.tokensOut += n(r.tokensOut);
    row.cacheRead += n(r.cacheRead);
    row.reasoning += n(r.reasoning);
    row.costUsd += n(r.cost);
    row.unpricedCalls += n(r.unpriced);
    row.models.push({ model: r.model, provider: r.provider, costUsd: n(r.cost), calls: n(r.calls) });
    activityMap.set(key, row);
  }
  const byActivity = [...activityMap.values()]
    .map((a) => ({ ...a, models: a.models.sort((x, y) => y.costUsd - x.costUsd) }))
    .sort((a, b) => b.costUsd - a.costUsd);

  // ── Recommendations ──────────────────────────────────────────────────────
  const labels = new Map(allActivities().map((a) => [a.key, a.label]));
  const toolRoles = new Set(WORKLOADS.filter((w) => w.requires === 'tools').map((w) => w.id));
  // Anything not a named role is a chat turn, a canvas node or a research
  // phase — all tool-driving. Assuming tools are needed is the safe default: it
  // can only remove candidates, never recommend one that cannot do the job.
  const swaps = findSwaps(groups, catalogue, labels, (a) => !a.startsWith('source:') ? toolRoles.has(a) : true);

  const w = windowTotals[0];
  const waste = findWaste(groups, {
    windowDays: days,
    cacheReadTokens: n(w?.cacheRead),
    totalInputTokens: n(w?.tokensIn),
  });

  // ── Reconciliation. Windows are matched to what OpenRouter reports, not the
  //    other way round: their day/week/month are the authoritative buckets and
  //    re-deriving our own would compare two different questions. ───────────
  const [today, week, month] = [todayTotals[0], weekTotals[0], monthTotals[0]];
  const reconciliation = {
    day: reconcile(keyUsage?.daily ?? null, n(today?.cost)),
    week: reconcile(keyUsage?.weekly ?? null, n(week?.cost)),
    month: reconcile(keyUsage?.monthly ?? null, n(month?.cost)),
  };

  return {
    days,
    windows: [...WINDOWS],
    totals: {
      today: { cost: n(today?.cost), calls: n(today?.calls), tokensIn: n(today?.tokensIn), tokensOut: n(today?.tokensOut) },
      week: { cost: n(week?.cost), calls: n(week?.calls) },
      month: { cost: n(month?.cost), calls: n(month?.calls) },
      window: {
        cost: n(w?.cost),
        calls: n(w?.calls),
        tokensIn: n(w?.tokensIn),
        tokensOut: n(w?.tokensOut),
        cacheRead: n(w?.cacheRead),
        reasoning: n(w?.reasoning),
        unpriced: n(w?.unpriced),
      },
    },
    perDay: perDay.map((d) => ({ day: d.day, cost: n(d.cost), calls: n(d.calls) })),
    byModel: byModel.map((m) => ({
      provider: m.provider,
      model: m.model,
      cost: n(m.cost),
      calls: n(m.calls),
      tokensIn: n(m.tokensIn),
      tokensOut: n(m.tokensOut),
      cacheRead: n(m.cacheRead),
      reasoning: n(m.reasoning),
      unpriced: n(m.unpriced),
    })),
    byActivity,
    topSessions: topSessions.map((s) => ({
      sessionId: s.sessionId,
      cost: n(s.cost),
      calls: n(s.calls),
      firstAt: s.firstAt,
      lastAt: s.lastAt,
    })),
    swaps,
    waste,
    reconciliation,
    provider: {
      key: keyUsage,
      credits,
      /** Account lifetime minus this key's lifetime — spend on keys that are
       *  not this one, which no amount of instrumenting this codebase can see. */
      otherKeysUsd:
        credits && keyUsage ? Math.max(0, credits.usedUsd - keyUsage.lifetime) : null,
    },
    workloads: {
      siteDefaultModelId: siteDefault.modelId,
      site: siteWorkloads,
      hermes: hermesWorkloads,
      hermesError,
      hermesManageable: canManageHermes(),
    },
    /** Only the fields the switcher and the swap table need — the full
     *  catalogue row carries a `raw` blob per model and would be megabytes. */
    catalogue: catalogue
      .filter((c) => c.promptPrice != null)
      .sort((a, b) => (a.promptPrice ?? 0) - (b.promptPrice ?? 0)),
    taggingSince: firstTagged[0]?.at ?? null,
  };
};
