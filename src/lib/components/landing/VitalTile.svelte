<script lang="ts">
  import { Tween } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';
  import { fly } from 'svelte/transition';
  import { dur } from '$lib/motion';

  type TileState = 'live' | 'idle' | 'stale' | 'static' | 'loading';

  let {
    label,
    num = null,
    fallback = '—',
    unit,
    sub,
    state = 'idle',
    href,
    dp = null,
    delay = 0,
  }: {
    label: string;
    /** Numeric headline. When null, `fallback` is shown instead (idle/offline). */
    num?: number | null;
    fallback?: string;
    unit: string;
    sub: string;
    state?: TileState;
    href: string;
    /** Decimal places — when set, the value renders with this precision (e.g. km). */
    dp?: number | null;
    /** Entrance stagger delay (ms). */
    delay?: number;
  } = $props();

  // Roll the headline number up the way policy-engine's LeverChart does. Starts
  // at 0 so the first paint counts up; dur() collapses to 0 under reduced motion
  // (instant value, no animation).
  const tween = new Tween(0, { duration: dur(420), easing: cubicOut });
  $effect(() => {
    if (num !== null) tween.target = num;
  });
  let shown = $derived(
    dp !== null ? tween.current.toFixed(dp) : Math.round(tween.current).toLocaleString('en-GB'),
  );
</script>

<a
  {href}
  class="tile"
  data-state={state}
  in:fly={{ y: 12, duration: dur(360), delay: dur(delay), easing: cubicOut }}
>
  <div class="tile-hd">
    <span class="tile-label">{label}</span>
    <span class="dot" data-state={state}></span>
  </div>
  <div class="tile-value">
    {#if num !== null}<span class="num">{shown}</span>{:else}<span class="num muted">{fallback}</span>{/if}
    <span class="unit">{unit}</span>
  </div>
  <p class="tile-sub">{sub}</p>
</a>

<style>
  /* A cell of the vitals rail, not a card: the grid draws the borders, so the
     tile brings only its contents and a hover wash. */
  .tile {
    display: flex;
    flex-direction: column;
    gap: 6px;
    text-decoration: none;
    color: var(--text-primary);
    position: relative;
    overflow: hidden;
    min-width: 0;
    transition: background var(--t-base) var(--ease-out);
  }
  .tile:hover {
    background: var(--accent-tint-04);
  }

  .tile-hd {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .tile-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label-wide);
    color: var(--text-muted);
  }

  .dot {
    width: 7px;
    height: 7px;
    border-radius: var(--radius-pill);
    flex-shrink: 0;
    background: var(--accent);
  }
  .dot[data-state='live'] {
    box-shadow: var(--accent-glow);
  }
  .dot[data-state='idle'] {
    background: transparent;
    border: 1.5px solid var(--text-ghost);
  }
  .dot[data-state='stale'] {
    background: var(--text-ghost);
  }
  .dot[data-state='loading'] {
    background: var(--text-ghost);
    opacity: 0.5;
  }

  .tile-value {
    display: flex;
    align-items: baseline;
    gap: 6px;
    margin-top: 2px;
  }
  /* Mono, not display: the rail is an instrument, and every figure in it ticks
     in place. Tabular so a 9 becoming a 10 does not shove the unit sideways. */
  .num {
    font-family: var(--font-mono);
    font-weight: 500;
    font-size: var(--fs-num-md);
    line-height: 1.05;
    letter-spacing: -0.01em;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }
  /* A live reading is the one figure on the deck that shouts. */
  .tile[data-state='live'] .num {
    color: var(--accent);
  }
  .num.muted {
    color: var(--text-ghost);
  }
  .unit {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-ghost);
  }

  .tile-sub {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.02em;
    color: var(--text-muted);
    margin: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tile[data-state='idle'] .tile-sub,
  .tile[data-state='loading'] .tile-sub {
    color: var(--text-ghost);
  }

  /* The live dot only breathes when motion is welcome. */
  @media (prefers-reduced-motion: no-preference) {
    .dot[data-state='live'] {
      animation: vital-pulse 1.6s ease-in-out infinite;
    }
    .tile[data-state='loading'] .num.muted {
      animation: vital-fade 1.4s ease-in-out infinite;
    }
  }

  @keyframes vital-pulse {
    0%,
    100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.4;
      transform: scale(0.7);
    }
  }
  @keyframes vital-fade {
    0%,
    100% {
      opacity: 0.4;
    }
    50% {
      opacity: 0.8;
    }
  }
</style>
