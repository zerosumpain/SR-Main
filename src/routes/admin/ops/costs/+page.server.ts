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
import { rHermesModels, rTelemetry, canManageHermes } from '$lib/server/hermes-remote';
import type { Telemetry } from '$lib/server/hermes-sessions';
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
/**
 * Input tokens on the rows that actually CARRY a cache figure.
 *
 * `cache_read_tokens` was added on 2026-08-22, so every earlier row is null —
 * not zero. Dividing the cache total by all input tokens therefore reads "0.4%
 * cached" for a window that is mostly unmeasured, which is the difference
 * between "caching is broken" and "we have not looked yet". Only this
 * denominator can tell those apart.
 */
const T_IN_MEASURED = sql<number>`coalesce(sum(${agentActions.tokensInput}) filter (where ${agentActions.cacheReadTokens} is not null), 0)::bigint`;
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

/**
 * The OpenRouter usage bucket that matches a window, or null when none does.
 *
 * OpenRouter publishes day / week / month and nothing else, so 90 days has no
 * counterpart and returns null rather than being approximated from the monthly
 * figure. A reconciliation against a number that does not mean what the row
 * says is worse than no reconciliation.
 */
function windowBilled(
  usage: { daily: number; weekly: number; monthly: number } | null,
  days: number,
): number | null {
  if (!usage) return null;
  if (days === 1) return usage.daily;
  if (days === 7) return usage.weekly;
  if (days === 30) return usage.monthly;
  return null;
}

/**
 * When activity tagging actually started, so the page can say how much of the
 * window it can speak for rather than implying it covers all of it.
 *
 * Memoised, because the underlying query — `min(created_at)` filtered on a
 * jsonb key — can use no index and scans the whole ledger. Once a first tagged
 * row exists the answer is immutable, so it is asked exactly once per process;
 * before then it is asked again on the next load, which is the cheap case
 * anyway (an empty result on a table that is still small enough to scan).
 */
let taggingSinceMemo: string | null = null;
async function taggingSince(): Promise<{ at: string | null }[]> {
  if (taggingSinceMemo) return [{ at: taggingSinceMemo }];
  const [row] = await db
    .select({ at: sql<string | null>`min(${agentActions.createdAt})` })
    .from(agentActions)
    .where(and(IS_LLM, isNotNull(ACTIVITY)));
  taggingSinceMemo = row?.at ?? null;
  return [{ at: taggingSinceMemo }];
}

export const load: PageServerLoad = async ({ url }) => {
  const requested = Number(url.searchParams.get('days'));
  const days = (WINDOWS as readonly number[]).includes(requested) ? requested : 30;

  const now = new Date();
  // Midnight is computed by the DATABASE, not by Node. The daily series buckets
  // with `date_trunc` in the Postgres session timezone, so deriving "today"
  // from the Node process clock made the tile and the chart disagree whenever
  // the two hosts' timezones did — silently, and only for part of the year.
  const todayStart = sql`date_trunc('day', now())`;
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
        cacheMeasuredIn: T_IN_MEASURED,
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

    taggingSince(),

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

  /**
   * The Hermes engine keeps its OWN ledger, in its own SQLite session store, and
   * it is the largest thing the site's ledger cannot see: the engine is a
   * separate Python runtime that never goes through the SvelteKit gateway, so
   * WhatsApp DMs, canvas chats, delegation children and its auxiliary models
   * bill to the shared OpenRouter key and appear here nowhere.
   *
   * Read it as a SECOND SOURCE rather than merged into `agent_actions` — the
   * same treatment /admin/ops/tool-usage gives it, and for the same reason: the
   * two stores have different coverage and different clocks, and folding one
   * into the other hides which is which. Best-effort; the engine being
   * unreachable must not blank the page.
   */
  let hermesSpend: Telemetry | null = null;
  let hermesSpendError: string | null = null;
  if (canManageHermes()) {
    try {
      hermesSpend = await rTelemetry(days);
    } catch (err) {
      hermesSpendError = err instanceof Error ? err.message : String(err);
    }
  } else {
    hermesSpendError = 'The engine session store lives on homeserv.';
  }

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
  const groupMap = new Map<string, SpendGroup>();
  for (const r of byActivityModel) {
    const activity = activityKey(r.activity ?? null, r.source ?? null);
    const k = `${activity}\u0000${r.provider ?? ''}\u0000${r.model ?? ''}`;
    const g =
      groupMap.get(k) ??
      {
        activity,
        source: r.source ?? null,
        provider: r.provider,
        model: r.model,
        calls: 0,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        unpricedCalls: 0,
      };
    g.calls += n(r.calls);
    g.tokensIn += n(r.tokensIn);
    g.tokensOut += n(r.tokensOut);
    g.costUsd += n(r.cost);
    g.unpricedCalls += n(r.unpriced);
    groupMap.set(k, g);
  }
  const groups: SpendGroup[] = [...groupMap.values()];

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
    activityMap.set(key, row);
  }
  // Model lists come from the collapsed groups, not the raw rows — the same
  // model under two sources must be one entry, or the expander's `{#each}` key
  // repeats and Svelte throws.
  for (const g of groups) {
    activityMap
      .get(g.activity)
      ?.models.push({ model: g.model, provider: g.provider, costUsd: g.costUsd, calls: g.calls });
  }
  const byActivity = [...activityMap.values()]
    .map((a) => ({ ...a, models: a.models.sort((x, y) => y.costUsd - x.costUsd) }))
    .sort((a, b) => b.costUsd - a.costUsd);

  // ── Recommendations ──────────────────────────────────────────────────────
  const labels = new Map(allActivities().map((a) => [a.key, a.label]));
  const requires = new Map(WORKLOADS.map((w) => [w.id, w.requires]));
  // Anything not a named role is a chat turn, a canvas node or a research
  // phase — all tool-driving. Assuming tools are needed is the safe default: it
  // can only remove candidates, never recommend one that cannot do the job.
  const swaps = findSwaps(groups, catalogue, labels, (a) =>
    a.startsWith('source:') ? 'tools' : (requires.get(a) ?? null),
  );

  const w = windowTotals[0];
  const waste = findWaste(groups, {
    windowDays: days,
    cacheReadTokens: n(w?.cacheRead),
    totalInputTokens: n(w?.tokensIn),
    measuredInputTokens: n(w?.cacheMeasuredIn),
  });

  /**
   * Reconciliation.
   *
   * OpenRouter publishes three usage counters and does not document whether
   * they are rolling or period-to-date, so the ledger side is computed on
   * rolling windows and the page says which is which rather than implying the
   * two definitions match. Where they diverge the effect is one-directional and
   * predictable: early in a calendar period a period-to-date counter is smaller
   * than a rolling window, so coverage reads HIGH, not low. A tracker that
   * over-reports its own completeness would be the dangerous direction, and
   * this is not it.
   */
  const [today, week, month] = [todayTotals[0], weekTotals[0], monthTotals[0]];

  /**
   * The two ledgers overlap on exactly one thing, and adding them without
   * removing it would double-count.
   *
   * /jkai web-chat turns are Hermes sessions that the chat endpoint ALSO
   * back-fills into `agent_actions` with `source='jkai-chat'`. Every other
   * Hermes session (WhatsApp, canvas, delegation, smoke) exists only in the
   * engine's store. So the honest total is
   *   site ledger − jkai-chat + the whole engine figure.
   *
   * Only computable for the selected window, because the engine's telemetry is
   * fetched for that window. The day/week/month rows below therefore stay on
   * the site ledger alone and say so — a number that silently changes meaning
   * per row is worse than three that each say what they are.
   */
  const jkaiChatInWindow = byActivityModel
    .filter((r) => (r.activity ?? null) === null && r.source === 'jkai-chat')
    .reduce((acc, r) => acc + n(r.cost), 0);
  const combinedWindowUsd =
    hermesSpend ? n(w?.cost) - jkaiChatInWindow + hermesSpend.overview.costUsd : null;

  /**
   * Does the engine's spend even land on the key we are reconciling against?
   *
   * On homeserv it does — the site and Hermes read the same `sk-or-v1-…`. On
   * the VPS they do not: production authenticates with its own key while the
   * engine keeps billing homeserv's. Adding the engine's $12.78 to the site
   * ledger and dividing by production's key produced ~300% "coverage", which
   * reads as a Codex artefact rather than the category error it is.
   *
   * Three-valued on purpose. `null` means the engine did not say — an older
   * homeserv build, or an unreadable Hermes `.env` — and an unknown must render
   * as a caveat, never as either claim.
   */
  const engineKey = hermesSpend?.keyFingerprint ?? null;
  const siteKey = keyUsage?.fingerprint ?? null;
  const enginesShareKey: boolean | null =
    engineKey && siteKey ? engineKey === siteKey : null;

  const reconciliation = {
    day: reconcile(keyUsage?.daily ?? null, n(today?.cost)),
    week: reconcile(keyUsage?.weekly ?? null, n(week?.cost)),
    month: reconcile(keyUsage?.monthly ?? null, n(month?.cost)),
    /**
     * The selected window, counting the engine too — but ONLY where that is a
     * like-for-like comparison. Where the engine bills a different key, the
     * combined figure is still shown (it is the honest total spend); it just
     * is not divided by a bill that never covered it.
     */
    window:
      enginesShareKey === true
        ? reconcile(windowBilled(keyUsage, days), combinedWindowUsd ?? n(w?.cost))
        : reconcile(null, combinedWindowUsd ?? n(w?.cost)),
    combinedWindowUsd,
    jkaiChatOverlapUsd: jkaiChatInWindow,
    enginesShareKey,
    engineKeyLabel: engineKey,
    siteKeyLabel: siteKey,
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
        /** Denominator for the cache share — see `T_IN_MEASURED`. */
        cacheMeasuredIn: n(w?.cacheMeasuredIn),
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
    hermesSpend,
    hermesSpendError,
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
