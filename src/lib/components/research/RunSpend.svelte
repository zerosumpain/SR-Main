<script lang="ts">
  /**
   * What this run has cost, while it is still costing it.
   *
   * Research spends two budgets and neither was visible: model tokens (real
   * cash, through OpenRouter) and Tavily credits (a fixed monthly allowance).
   * A nine-hour investigation was quietly consuming both with nothing on the
   * page to say so.
   *
   * Deliberately not charts. Every figure here is a single magnitude with no
   * series and no time axis, so the honest form is the number — the one bar on
   * the panel is a part-of-whole against a known limit, which is the case a
   * meter is for. It uses one hue, and the figures are always printed as text
   * beside it, so the bar is never the only thing carrying the value.
   */
  import StatTiles, { type Stat } from './StatTiles.svelte';

  let {
    sessionId,
    live = false,
    final = false,
  }: {
    sessionId: string;
    /** Poll while the run is going. A finished run's spend does not move. */
    live?: boolean;
    /** The run is over. A paused run's bill is neither live nor final. */
    final?: boolean;
  } = $props();

  interface ModelSpend {
    model: string | null;
    calls: number;
    tokensInput: number;
    tokensOutput: number;
    costUsd: number;
  }
  interface Spend {
    llm: {
      calls: number;
      pricedCalls: number;
      tokensInput: number;
      tokensOutput: number;
      costUsd: number;
      byModel: ModelSpend[];
    };
    tavily: { searches: number; extracts: number; credits: number };
    account: { plan: string | null; used: number; limit: number | null } | null;
  }

  let spend = $state<Spend | null>(null);
  let failed = $state(false);

  // Timer and abort handles are machinery the template never reads. As $state
  // they would re-trigger the effect that creates them — the documented route
  // to effect_update_depth_exceeded in this codebase.
  let poll: ReturnType<typeof setInterval> | null = null;

  const POLL_MS = 6_000;

  async function refresh() {
    try {
      // The account figure is memoised for a minute server-side, so asking for
      // it on every poll costs one Tavily call a minute, not one per poll.
      const res = await fetch(`/api/research/${sessionId}/spend?account=1`);
      if (!res.ok) {
        failed = true;
        return;
      }
      spend = (await res.json()) as Spend;
      failed = false;
    } catch {
      failed = true;
    }
  }

  $effect(() => {
    void refresh();
    if (live) poll = setInterval(refresh, POLL_MS);
    return () => {
      if (poll) clearInterval(poll);
      poll = null;
    };
  });

  function money(usd: number): string {
    if (usd === 0) return '$0.00';
    // Research calls are fractions of a cent each; two decimal places would
    // report most runs as costing nothing at all.
    return usd < 1 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
  }

  function compact(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    // One scale across the row. Mixing "9,160" and "14k" in adjacent tiles
    // makes two numbers of the same magnitude look like different kinds of
    // thing, which is the opposite of what a tile row is for.
    if (n >= 100_000) return `${Math.round(n / 1000)}k`;
    if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`;
    return n.toLocaleString('en-GB');
  }

  const tiles = $derived.by((): Stat[] => {
    if (!spend) return [];
    const { llm, tavily } = spend;
    const unpriced = llm.calls - llm.pricedCalls;
    return [
      {
        label: 'Model spend',
        value: money(llm.costUsd),
        // Codex-served models price as null rather than zero — real quota, no
        // cash — so saying "$0.00" for them would be a lie of omission.
        note: unpriced > 0 ? `${unpriced} call${unpriced === 1 ? '' : 's'} on subscription quota` : null,
      },
      { label: 'Model calls', value: llm.calls },
      { label: 'Tokens in', value: compact(llm.tokensInput) },
      { label: 'Tokens out', value: compact(llm.tokensOutput) },
      {
        label: 'Tavily credits',
        value: tavily.credits,
        note: `${tavily.searches} search${tavily.searches === 1 ? '' : 'es'} · ${tavily.extracts} extract${tavily.extracts === 1 ? '' : 's'}`,
      },
    ];
  });

  const maxModelCost = $derived(Math.max(...(spend?.llm.byModel ?? []).map((m) => m.costUsd), 0.000001));

  /** Share of the Tavily plan consumed, or null on a plan with no ceiling. */
  const planShare = $derived.by(() => {
    const a = spend?.account;
    if (!a || !a.limit) return null;
    return Math.min(1, a.used / a.limit);
  });
  /**
   * A status tone, not decoration — and it always ships with the sentence
   * underneath saying what it means, never colour alone.
   */
  const planTight = $derived(planShare !== null && planShare >= 0.8);
</script>

<section class="nm-sec" id="spend">
  <div class="nm-sec-hd">
    <span class="sr-label-tight">What this run cost</span>
    <span class="nm-sec-meta">
      {#if live}updating while it runs{:else if final}final{:else}so far{/if}
    </span>
  </div>

  {#if failed && !spend}
    <p class="note">Could not read the spend for this run.</p>
  {:else if !spend}
    <p class="note">Reading the meter…</p>
  {:else}
    <StatTiles stats={tiles} />

    {#if spend.account}
      <div class="plan">
        <div class="plan-hd">
          <span class="sr-label-tight">Tavily account</span>
          <span class="plan-figures">
            {spend.account.used.toLocaleString('en-GB')}
            {#if spend.account.limit}of {spend.account.limit.toLocaleString('en-GB')}{/if}
            credits used{spend.account.plan ? ` · ${spend.account.plan} plan` : ''}
          </span>
        </div>
        {#if planShare !== null}
          <div class="meter" role="img" aria-label="{Math.round(planShare * 100)}% of the Tavily plan used">
            <span class="fill" class:tight={planTight} style:width="{Math.max(1, planShare * 100)}%"></span>
          </div>
          <p class="plan-why" class:tight={planTight}>
            {Math.round(planShare * 100)}% of the month's allowance is gone{planTight
              ? ' — an investigation can spend a hundred credits, so there may not be room for another.'
              : '.'}
          </p>
        {:else}
          <p class="plan-why">This plan has no published ceiling, so there is no share to show.</p>
        {/if}
      </div>
    {/if}

    {#if spend.llm.byModel.length}
      <div class="models">
        <div class="sr-label-tight">Where the tokens went</div>
        <ul>
          {#each spend.llm.byModel as m (m.model)}
            <li>
              <span class="mdl">{m.model}</span>
              <span class="bar-cell">
                <span class="bar" style:width="{(m.costUsd / maxModelCost) * 100}%"></span>
              </span>
              <span class="figs">
                {money(m.costUsd)} · {m.calls} call{m.calls === 1 ? '' : 's'} ·
                {compact(m.tokensInput + m.tokensOutput)} tokens
              </span>
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  {/if}
</section>

<style>
  /* .nm-sec, .nm-sec-hd, .sr-label-tight, .nm-sec-meta: $lib/styles/nm-tokens.css */
  .note { margin: 0; font-family: var(--font-mono); font-size: var(--fs-label); color: var(--text-ghost); font-style: italic; }

  .plan { margin-top: 0.5rem; }
  .plan-hd { display: flex; align-items: baseline; gap: 0.6rem; flex-wrap: wrap; }
  .plan-figures { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-secondary); }

  /* One measure against a known limit: one hue, a recessive track, and a 4px
     rounded data end anchored to the left baseline. */
  .meter { position: relative; height: 10px; margin-top: 0.4rem; background: var(--card-bg); border: 1px solid var(--line-hair); }
  .fill { position: absolute; inset: 0 auto 0 0; background: var(--accent); border-radius: 0 4px 4px 0; }
  .fill.tight { background: var(--warn); }
  .plan-why { margin: 0.35rem 0 0; font-size: 0.8rem; line-height: 1.4; color: var(--text-muted); }
  .plan-why.tight { color: var(--text-primary); }

  .models { margin-top: 1rem; padding-top: 0.7rem; border-top: 1px solid var(--line-hair); }
  .models ul { list-style: none; margin: 0.45rem 0 0; padding: 0; display: grid; gap: 0.4rem; }
  .models li { display: grid; grid-template-columns: minmax(0, 1fr) 120px auto; gap: 0.6rem; align-items: center; }
  .mdl { font-family: var(--font-mono); font-size: 0.78rem; color: var(--text-primary); overflow-wrap: anywhere; }
  .bar-cell { position: relative; height: 8px; background: var(--card-bg); }
  .bar { position: absolute; inset: 0 auto 0 0; background: var(--accent); opacity: 0.72; border-radius: 0 2px 2px 0; }
  .figs { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-secondary); white-space: nowrap; }

  @media (max-width: 620px) {
    .models li { grid-template-columns: minmax(0, 1fr); }
    .bar-cell { display: none; }
  }
</style>
