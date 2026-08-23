/**
 * The arithmetic behind /admin/ops/costs. Pure and DB-free so the judgements it
 * makes — "this is your biggest spender", "this one could run for a third of
 * the money" — can be proved in a unit test rather than eyeballed on a chart.
 *
 * Same split as `$lib/routing/scoring`: the page's `+page.server.ts` does the
 * querying, this module does the thinking.
 */

/** One `agent_actions` llm_call row, already grouped by the query. */
export interface SpendGroup {
  /**
   * The activity key — a workload id, or `source:<name>` for spend outside any
   * named role. Resolved by the caller (`activityKey`) rather than here, so one
   * vocabulary serves the tables, the recommendations and the switcher.
   */
  activity: string;
  source: string | null;
  provider: string | null;
  model: string | null;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  /** Calls whose cost could not be established — an unpriced model, or a
   *  provider that reported no usage. Counted, never treated as zero. */
  unpricedCalls: number;
}

/**
 * What a model must be able to do to serve an activity — the same vocabulary as
 * `WorkloadDef['requires']`, redeclared here so this module stays free of any
 * import that would drag a registry (and its future dependencies) into a pure
 * arithmetic file.
 */
export type ActivityRequirement =
  | 'tools'
  | 'embeddings'
  | 'image-input'
  | 'audio-input'
  | 'image-output'
  | null;

/** OpenRouter encodes modality as `inputs->outputs`, e.g. `text+image->text`. */
function inputsOf(modality: string | null | undefined): string {
  if (!modality) return '';
  const i = modality.indexOf('->');
  return i === -1 ? modality : modality.slice(0, i);
}
function outputsOf(modality: string | null | undefined): string {
  if (!modality) return '';
  const i = modality.indexOf('->');
  return i === -1 ? '' : modality.slice(i + 2);
}

/**
 * Whether `m` could serve a role with this requirement.
 *
 * Where the catalogue cannot answer (no modality recorded), this returns FALSE
 * rather than null-means-yes — the opposite of `workloadBlockReason`, and
 * deliberately so. That guard is deciding whether to refuse an operator's
 * explicit choice, where the benefit of the doubt belongs to the human. This is
 * deciding whether to volunteer a suggestion, where an unverifiable candidate
 * should simply not be offered.
 */
export function canServe(m: CatalogueModel, requires: ActivityRequirement): boolean {
  switch (requires) {
    case 'tools':
      return m.toolsSupported;
    case 'image-input':
      return inputsOf(m.modality).includes('image');
    case 'audio-input':
      return inputsOf(m.modality).includes('audio');
    case 'image-output':
      return outputsOf(m.modality).includes('image');
    case 'embeddings':
      // OpenRouter's feed carries no embedding models at all, so there is
      // nothing here that could be verified as one.
      return false;
    case null:
      return true;
  }
}

/** A catalogue row, trimmed to what the analysis needs. */
export interface CatalogueModel {
  id: string;
  name: string;
  /** USD per input token. */
  promptPrice: number | null;
  /** USD per output token. */
  completionPrice: number | null;
  toolsSupported: boolean;
  /** Artificial Analysis agentic index — the quality axis, as elsewhere. */
  agenticIndex: number | null;
  contextLength: number | null;
  /** OpenRouter's `inputs->outputs` string. Only the picker uses it, to keep an
   *  image-generation role off a model that can only read pictures. */
  modality?: string | null;
}

// ── Prices ──────────────────────────────────────────────────────────────────

/**
 * What a model costs per million tokens AT THE MIX THIS ACTIVITY ACTUALLY USES.
 *
 * The catalogue's "blended" figure assumes 3:1 input:output, which is a fair
 * guess in the abstract and wrong for most real roles: entity extraction runs
 * enormous prompts against tiny JSON replies (nearer 40:1), while an image
 * caption is the reverse. Comparing two models on a 3:1 blend can therefore rank
 * them in the wrong order for the work in hand — a model with cheap input and
 * dear output is a bargain for extraction and a disaster for drafting.
 *
 * Returns null when either side of the price is unknown, rather than assuming
 * zero for the missing half.
 */
export function pricePerMTokens(
  m: Pick<CatalogueModel, 'promptPrice' | 'completionPrice'>,
  tokensIn: number,
  tokensOut: number,
): number | null {
  if (m.promptPrice == null || m.completionPrice == null) return null;
  if (m.promptPrice < 0 || m.completionPrice < 0) return null; // OpenRouter's -1 = variable
  const total = tokensIn + tokensOut;
  if (total <= 0) return null;
  const inShare = tokensIn / total;
  return (m.promptPrice * inShare + m.completionPrice * (1 - inShare)) * 1_000_000;
}

/** What `tokensIn`/`tokensOut` would have cost on `m`. Null when unpriceable. */
export function projectedCost(
  m: Pick<CatalogueModel, 'promptPrice' | 'completionPrice'>,
  tokensIn: number,
  tokensOut: number,
): number | null {
  if (m.promptPrice == null || m.completionPrice == null) return null;
  if (m.promptPrice < 0 || m.completionPrice < 0) return null;
  return m.promptPrice * tokensIn + m.completionPrice * tokensOut;
}

// ── Savings ─────────────────────────────────────────────────────────────────

export interface SwapSuggestion {
  /** The activity key this recommendation applies to. */
  activity: string;
  label: string;
  currentModelId: string;
  candidateModelId: string;
  candidateName: string;
  /** Observed spend on the current model over the window, USD. */
  currentCostUsd: number;
  /** What the same tokens would have cost on the candidate, USD. */
  projectedCostUsd: number;
  /** currentCost − projectedCost over the window, USD. Always > 0. */
  savingUsd: number;
  /** As a share of the current spend, 0–1. */
  savingShare: number;
  /** Quality index of each, so the trade is legible rather than implied. */
  currentQuality: number | null;
  candidateQuality: number | null;
  /** Why this candidate was allowed through the filter, in one line. */
  rationale: string;
}

export interface SwapOptions {
  /**
   * How much agentic-index the candidate is allowed to give up, as a fraction
   * of the current model's. 1 = must be at least as good.
   *
   * Defaults to 1: a cheaper model that is also WORSE is not a saving, it is a
   * different product, and a cost page that recommends one is telling you to
   * degrade the site without saying so. The page exposes the dial so a
   * deliberate trade can be made explicitly.
   */
  qualityFloorRatio?: number;
  /** Ignore activities that spent less than this over the window, USD. */
  minSpendUsd?: number;
  /** Ignore savings smaller than this share of current spend, 0–1. */
  minSavingShare?: number;
  /** Candidate must clear this context length when the current model does. */
  requireContextParity?: boolean;
  /**
   * Allow OpenRouter's `:free` variants as candidates.
   *
   * Off by default. They price at zero, so they win every comparison by a
   * landslide and produce a recommendation table that says "move everything to
   * free" — while carrying hard daily request caps that would stop the site
   * working by mid-morning. A saving that cannot be taken is not a saving.
   */
  allowFreeTier?: boolean;
}

const DEFAULTS: Required<SwapOptions> = {
  qualityFloorRatio: 1,
  minSpendUsd: 0.02,
  minSavingShare: 0.1,
  requireContextParity: true,
  allowFreeTier: false,
};

/** OpenRouter marks rate-limited free variants with a `:free` suffix. */
export function isFreeTier(id: string): boolean {
  return id.endsWith(':free');
}

/**
 * The cheapest catalogue model that could have done each activity's work, at
 * the same measured quality bar.
 *
 * Deliberately conservative in three ways, because the failure mode of a cost
 * dashboard is not missing a saving — it is confidently recommending a swap
 * that quietly makes the site worse:
 *
 *  - an unrated model is never proposed. `agenticIndex: null` means Artificial
 *    Analysis has not scored it, which is not evidence that it is good enough;
 *  - a model that cannot pass tool schemas is never proposed for a role that
 *    needs them, and a shorter context window disqualifies by default;
 *  - the comparison uses the activity's OWN token mix, not a nominal blend.
 */
export function findSwaps(
  groups: SpendGroup[],
  catalogue: CatalogueModel[],
  labels: Map<string, string>,
  /** What the activity's model must be able to do. */
  requirementFor: (activity: string) => ActivityRequirement,
  opts: SwapOptions = {},
): SwapSuggestion[] {
  const o = { ...DEFAULTS, ...opts };
  const byId = new Map(catalogue.map((c) => [c.id, c]));
  const out: SwapSuggestion[] = [];

  for (const g of groups) {
    if (!g.model || g.costUsd < o.minSpendUsd) continue;
    if (g.tokensIn + g.tokensOut <= 0) continue;
    const current = byId.get(g.model);
    // No catalogue row means no price and no quality index — nothing to compare
    // against. Codex models land here by construction (subscription-billed, not
    // in OpenRouter's feed), which is correct: there is no per-token saving to
    // find on a flat-rate plan.
    if (!current || current.agenticIndex == null) continue;

    const requires = requirementFor(g.activity);
    // A role with no declared requirement still must not be dropped from a
    // tool-capable model onto one that cannot pass schemas — the calls it is
    // already making prove it needs them.
    const mustHaveTools = requires === 'tools' || current.toolsSupported;
    const floor = current.agenticIndex * o.qualityFloorRatio;

    let best: { m: CatalogueModel; cost: number } | null = null;
    for (const c of catalogue) {
      if (c.id === current.id) continue;
      if (!o.allowFreeTier && isFreeTier(c.id)) continue;
      if (c.agenticIndex == null || c.agenticIndex < floor) continue;
      if (mustHaveTools && !c.toolsSupported) continue;
      // Without this the table recommends a cheap text-only model for the
      // vision role, and the page's own save guard then 400s it — advice the
      // page will refuse to carry out.
      if (!canServe(c, requires)) continue;
      if (
        o.requireContextParity &&
        current.contextLength != null &&
        (c.contextLength == null || c.contextLength < current.contextLength)
      ) {
        continue;
      }
      const cost = projectedCost(c, g.tokensIn, g.tokensOut);
      if (cost == null) continue;
      if (!best || cost < best.cost) best = { m: c, cost };
    }
    if (!best) continue;

    // Compare like with like: the observed `costUsd` can include per-request
    // fees (a grounded search) that no per-token projection can reproduce, so
    // the baseline is the CURRENT model re-priced on the same arithmetic as the
    // candidate. Falls back to the observed figure when the current model is
    // unpriced.
    const baseline = projectedCost(current, g.tokensIn, g.tokensOut) ?? g.costUsd;
    const saving = baseline - best.cost;
    if (saving <= 0) continue;
    const share = baseline > 0 ? saving / baseline : 0;
    if (share < o.minSavingShare) continue;

    out.push({
      activity: g.activity,
      label: labels.get(g.activity) ?? g.activity,
      currentModelId: current.id,
      candidateModelId: best.m.id,
      candidateName: best.m.name,
      currentCostUsd: baseline,
      projectedCostUsd: best.cost,
      savingUsd: saving,
      savingShare: share,
      currentQuality: current.agenticIndex,
      candidateQuality: best.m.agenticIndex,
      rationale:
        `${best.m.name} scores ${best.m.agenticIndex?.toFixed(1) ?? '?'} against ` +
        `${current.agenticIndex.toFixed(1)}, and at this activity's ` +
        `${describeMix(g.tokensIn, g.tokensOut)} token mix costs ` +
        `${((best.cost / Math.max(baseline, 1e-9)) * 100).toFixed(0)}% as much.`,
    });
  }

  return out.sort((a, b) => b.savingUsd - a.savingUsd);
}

/** "12:1 in:out" — the ratio that decides which of two price columns matters. */
export function describeMix(tokensIn: number, tokensOut: number): string {
  if (tokensOut <= 0) return 'input-only';
  if (tokensIn <= 0) return 'output-only';
  const r = tokensIn / tokensOut;
  return r >= 1 ? `${r.toFixed(r >= 10 ? 0 : 1)}:1 in:out` : `1:${(1 / r).toFixed(1)} in:out`;
}

// ── Waste signals ───────────────────────────────────────────────────────────

export interface WasteSignal {
  id: string;
  severity: 'warn' | 'info';
  title: string;
  detail: string;
  /** USD this signal is worth, when that can be established. */
  valueUsd: number | null;
}

/**
 * Things worth knowing that are not "swap this model".
 *
 * Each one is a fact plus its price. A cost page full of unquantified advice
 * ("consider caching!") is wallpaper; the point is to say what a thing is
 * costing so it can be ranked against everything else.
 */
export function findWaste(
  groups: SpendGroup[],
  opts: {
    windowDays: number;
    cacheReadTokens?: number;
    totalInputTokens?: number;
    /**
     * Input tokens on the rows that carry a cache figure at all. Rows written
     * before the column existed hold null, and a null is not a cache miss —
     * dividing by every input token would report a measurement gap as a
     * performance problem.
     */
    measuredInputTokens?: number;
  } = { windowDays: 30 },
): WasteSignal[] {
  const out: WasteSignal[] = [];
  const total = groups.reduce((s, g) => s + g.costUsd, 0);

  // 1. Unpriced calls — spend that IS happening and is not in the total.
  const unpriced = groups.reduce((s, g) => s + g.unpricedCalls, 0);
  const calls = groups.reduce((s, g) => s + g.calls, 0);
  if (unpriced > 0) {
    out.push({
      id: 'unpriced',
      severity: unpriced / Math.max(calls, 1) > 0.1 ? 'warn' : 'info',
      title: `${unpriced.toLocaleString()} call${unpriced === 1 ? '' : 's'} recorded with no cost`,
      detail:
        'The model was not in the OpenRouter catalogue when the call was priced, so the row carries a null cost rather than a fabricated zero. ' +
        'Every total on this page is therefore a floor, not a ceiling.',
      valueUsd: null,
    });
  }

  // 2. Concentration — one model or role carrying the bill.
  const byModel = new Map<string, number>();
  for (const g of groups) if (g.model) byModel.set(g.model, (byModel.get(g.model) ?? 0) + g.costUsd);
  const top = [...byModel.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top && total > 0 && top[1] / total >= 0.5) {
    out.push({
      id: 'concentration',
      severity: 'info',
      title: `${Math.round((top[1] / total) * 100)}% of spend is on one model`,
      detail: `${top[0]} accounts for $${top[1].toFixed(4)} of $${total.toFixed(4)}. A single swap moves most of the bill — and a single bad swap moves most of the quality.`,
      valueUsd: top[1],
    });
  }

  // 3. Cache reads — the one lever that costs nothing to pull.
  //
  // Measured against the rows that record a cache figure, never against the
  // whole window: an unmeasured window and a cold cache produce the same
  // ratio, and only one of them is a problem worth chasing.
  const totalIn = opts.totalInputTokens ?? 0;
  const measuredIn = opts.measuredInputTokens ?? 0;
  if (totalIn > 0 && measuredIn <= 0) {
    out.push({
      id: 'cache-unmeasured',
      severity: 'info',
      title: 'Cache hit rate is not measured over this window',
      detail:
        'No call in this window recorded a cache figure — the ledger only started keeping one on 22 Aug 2026, and earlier rows hold null rather than a zero that would read as a miss. ' +
        'Pick a shorter window, or come back once a full window has been recorded.',
      valueUsd: null,
    });
  } else if (measuredIn > 0) {
    const hit = (opts.cacheReadTokens ?? 0) / measuredIn;
    const coverage = measuredIn / Math.max(totalIn, 1);
    if (hit < 0.05) {
      out.push({
        id: 'cache',
        severity: 'info',
        title: `Prompt caching is doing almost nothing (${(hit * 100).toFixed(1)}% of measured input tokens)`,
        detail:
          'Cached input tokens bill at a fraction of the normal rate. A low hit rate usually means the prefix is churning — a timestamp, a shuffled tool list, a per-request id near the top of the system prompt. ' +
          `Measured over ${(coverage * 100).toFixed(0)}% of this window's input tokens; the rest predates the cache column.`,
        valueUsd: null,
      });
    }
  }

  // 4. Run rate — the number that makes a window comparable to a bill.
  if (total > 0) {
    const perDay = total / Math.max(opts.windowDays, 1);
    out.push({
      id: 'runrate',
      severity: 'info',
      title: `Run rate $${(perDay * 30).toFixed(2)} / month`,
      detail: `$${perDay.toFixed(4)} a day across the last ${opts.windowDays} days, if nothing changes.`,
      valueUsd: perDay * 365,
    });
  }

  return out;
}

// ── Reconciliation ──────────────────────────────────────────────────────────

export interface Reconciliation {
  /** What OpenRouter billed this key over the window, USD. Null when unknown. */
  billedUsd: number | null;
  /** What the ledger recorded over the same window, USD. */
  recordedUsd: number;
  /**
   * billed − recorded, in USD, but ONLY when it is spend nobody attributed.
   *
   * Null once the ledger records at least as much as the bill. The column that
   * shows this is headed "Unaccounted", and a negative unaccounted figure is
   * not a small number — it is a category error, printed on the one page whose
   * job is to not print those. The overshoot is not lost information: it is
   * exactly what `coverage` above 1 says, with the Codex explanation beside it.
   */
  gapUsd: number | null;
  /** recorded / billed, 0–1. Null when billed is unknown or zero. */
  coverage: number | null;
}

/**
 * How much of the provider's bill the ledger can account for.
 *
 * Ratios above 1 are possible and are NOT clamped: Codex calls are recorded
 * with a priced estimate but billed to a ChatGPT subscription rather than to
 * OpenRouter, so a Codex-heavy window legitimately records more than OpenRouter
 * charged. Hiding that would hide the explanation.
 */
export function reconcile(billedUsd: number | null, recordedUsd: number): Reconciliation {
  return {
    billedUsd,
    recordedUsd,
    // A hair over the bill is float noise on two figures that agree — production
    // printed `$-0.0000` for a day where billed and recorded matched exactly.
    gapUsd: billedUsd == null || billedUsd - recordedUsd < 0.00005 ? null : billedUsd - recordedUsd,
    coverage: billedUsd == null || billedUsd <= 0 ? null : recordedUsd / billedUsd,
  };
}
