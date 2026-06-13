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
  .tile {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px 13px 13px;
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    text-decoration: none;
    color: var(--text-primary);
    position: relative;
    overflow: hidden;
    transition:
      border-color var(--t-base) var(--ease-out),
      transform var(--t-base) var(--ease-out),
      background var(--t-base) var(--ease-out),
      box-shadow var(--t-base) var(--ease-out);
  }
  .tile:hover {
    border-color: var(--accent);
    background: var(--accent-tint-04);
    transform: translateY(-2px);
    box-shadow: var(--shadow-sm);
  }
  /* Accent rail wipes in from the left on hover (brand `>` gesture). */
  .tile::before {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--accent);
    transform: scaleY(0);
    transform-origin: top;
    transition: transform var(--t-base) var(--ease-spring);
  }
  .tile:hover::before {
    transform: scaleY(1);
  }

  .tile-hd {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .tile-label {
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    color: var(--text-muted);
  }

  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
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
  .num {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 30px;
    line-height: 1;
    letter-spacing: -0.02em;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }
  .num.muted {
    color: var(--text-ghost);
  }
  .unit {
    font-family: var(--font-mono);
    font-size: 8.5px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-ghost);
  }

  .tile-sub {
    font-family: var(--font-mono);
    font-size: 9.5px;
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
