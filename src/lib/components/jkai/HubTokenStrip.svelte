<script lang="ts">
  import { formatGbp } from '$lib/canvas/stats/costFormat';
  import type { CodexMeter } from '$lib/jkai/usage-meter';

  let {
    tokensToday,
    spendUsd,
    budgetUsd,
    credit = null,
    codex = null,
    contextTokens = null,
    contextFraction = null,
    liveRuns = 0,
    bpm = null,
    variant = 'desktop',
  }: {
    tokensToday: number;
    spendUsd: number;
    budgetUsd: number;
    /** Live OpenRouter credit position. When present, `budgetUsd` IS
     *  `credit.remainingUsd` and the strip says so; when null the strip has
     *  fallen back to the static app_settings budget. */
    credit?: { remainingUsd: number; totalUsd: number; usedUsd: number } | null;
    /** Set only while a `codex/` model is answering. When present it REPLACES
     *  the spend chunk: that turn spends subscription quota, not credit, so a
     *  pound figure would be describing money the turn will never touch. */
    codex?: CodexMeter | null;
    contextTokens?: number | null;
    contextFraction?: number | null;
    liveRuns?: number;
    bpm?: number | null;
    /** `mobile` drops spend (it is promoted to the header pill) and never hides
     *  a chunk — the phone strip scrolls horizontally instead. */
    variant?: 'desktop' | 'mobile';
  } = $props();

  /** Header-local token formatter: `128.4K`, `34.2K`, `1.2M`. Deliberately not
   *  $lib/canvas/stats/costFormat's formatTokens — that renders a lowercase
   *  `128k` for the stats tables, and this strip is set in uppercase mono where
   *  the tenth matters (it is the number that moves during a turn). */
  function compactTokens(v: number): string {
    if (v < 1000) return String(Math.round(v));
    if (v < 1_000_000) return `${(v / 1000).toFixed(1)}K`;
    return `${(v / 1_000_000).toFixed(1)}M`;
  }

  const isMobile = $derived(variant === 'mobile');
  const budgetPct = $derived(
    budgetUsd > 0 ? Math.max(0, Math.min(100, (spendUsd / budgetUsd) * 100)) : 0,
  );

  /** Hover detail for the spend chunk. With a live balance this is the whole
   *  picture — purchased, used, left — so the one-line strip doesn't have to
   *  carry three numbers. */
  const spendTitle = $derived(
    credit
      ? `Spent today ${formatGbp(spendUsd)} · OpenRouter credit ${formatGbp(credit.remainingUsd)} left of ${formatGbp(credit.totalUsd)} purchased (${formatGbp(credit.usedUsd)} used)`
      : `Spent today ${formatGbp(spendUsd)} of a ${formatGbp(budgetUsd)} daily budget — OpenRouter balance unavailable`,
  );
  const contextPct = $derived(
    contextFraction === null ? null : Math.max(0, Math.min(100, Math.round(contextFraction * 100))),
  );
  const showContext = $derived(contextTokens !== null && contextPct !== null);
</script>

<!-- The continuous ledger strip. Never wraps: on desktop chunks drop
     right-to-left as the viewport narrows (BPM → CTX → budget bar → RUNS), so
     TOK and spend are the last two standing. Each droppable chunk owns the
     separator that precedes it, so nothing ever leaves a dangling `/`. -->
<div class="strip" class:mobile={isMobile} aria-label="Usage ledger">
  <span class="chunk"><b>{compactTokens(tokensToday)}</b> tok</span>

  {#if !isMobile}
    <span class="unit unit-spend">
      <span class="sep" aria-hidden="true">/</span>
      {#if codex}
        <span class="chunk spend" title={codex.title}>
          <b class="accent" class:warn={codex.limitReached}
            >{Math.round(codex.remainingPercent)}%</b
          ><span class="of">
            {codex.windowLabel.toLowerCase()} left{codex.resetIn
              ? ` · ${codex.resetIn}`
              : ''}</span
          >
        </span>
      {:else}
        <span class="chunk spend" title={spendTitle}>
          <b class="accent">{formatGbp(spendUsd)}</b><span class="of">
            of {formatGbp(budgetUsd)}{credit ? ' credit' : ''}</span
          >
        </span>
      {/if}
      <!-- Fill is what has been CONSUMED in both modes: spend against the
           balance, or the tightest quota window against its ceiling. -->
      <span class="budget-bar" aria-hidden="true">
        <span
          class="budget-fill"
          class:warn={codex?.limitReached}
          style="width: {codex ? codex.usedPercent : budgetPct}%"
        ></span>
      </span>
    </span>
  {/if}

  {#if showContext}
    <span class="unit unit-ctx">
      <span class="sep" aria-hidden="true">/</span>
      <span class="chunk"><b>{compactTokens(contextTokens ?? 0)}</b> ctx <b>{contextPct}%</b></span>
    </span>
  {/if}

  {#if liveRuns > 0}
    <span class="unit unit-runs">
      <span class="sep" aria-hidden="true">/</span>
      <span class="chunk"
        ><span class="live-dot"></span><b>{liveRuns}</b> {liveRuns === 1 ? 'run' : 'runs'}</span
      >
    </span>
  {/if}

  {#if bpm !== null}
    <span class="unit unit-bpm">
      <span class="sep" aria-hidden="true">/</span>
      <span class="chunk"><b>{bpm}</b> bpm</span>
    </span>
  {/if}
</div>

<style>
  .strip {
    display: flex;
    align-items: center;
    gap: 13px;
    min-width: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 400;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
    white-space: nowrap;
  }
  .unit {
    display: inline-flex;
    align-items: center;
    gap: 13px;
  }
  .chunk {
    display: inline-flex;
    align-items: center;
    gap: 0.45ch;
    white-space: nowrap;
  }
  /* Every figure in the ledger ticks in place during a turn — tabular stops the
     strip shivering as digits change width. */
  .chunk b {
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    color: var(--text-primary);
  }
  .chunk b.accent {
    color: var(--accent);
  }
  /* Quota exhausted — calls are being refused, not merely running low. */
  .chunk b.accent.warn {
    color: var(--error);
  }
  .spend .of {
    opacity: 0.75;
  }
  .sep {
    opacity: 0.35;
  }
  .budget-bar {
    display: inline-flex;
    width: 52px;
    height: 5px;
    flex: none;
    background: var(--line);
  }
  .budget-fill {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  .budget-fill.warn {
    background: var(--error);
  }
  .live-dot {
    width: 6px;
    height: 6px;
    flex: none;
    border-radius: var(--radius-pill);
    background: var(--accent);
    animation: hub-pulse 1.5s ease-in-out infinite;
  }
  @keyframes hub-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.35;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .live-dot {
      animation: none;
    }
  }

  .strip.mobile {
    font-size: var(--fs-label-xs);
  }

  /* Drop order as the header tightens — BPM first, spend last. Suspended for
     the phone strip, which scrolls. */
  @media (max-width: 1279px) {
    .strip:not(.mobile) .unit-bpm {
      display: none;
    }
  }
  @media (max-width: 1099px) {
    .strip:not(.mobile) .unit-ctx {
      display: none;
    }
  }
  @media (max-width: 979px) {
    .strip:not(.mobile) .budget-bar {
      display: none;
    }
  }
  @media (max-width: 859px) {
    .strip:not(.mobile) .unit-runs {
      display: none;
    }
  }
</style>
