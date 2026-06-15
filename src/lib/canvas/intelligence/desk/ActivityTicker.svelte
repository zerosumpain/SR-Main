<!-- src/lib/canvas/intelligence/desk/ActivityTicker.svelte -->
<script lang="ts">
  import { tick } from 'svelte';
  import type { FeedEvent } from './feedFormatter';

  let {
    logs,
    live = false,
    feed = [] as readonly FeedEvent[],
    connectionState = 'idle' as 'connecting' | 'live' | 'reconnecting' | 'idle' | 'closed',
    rateBuckets = [] as readonly number[],
  }: {
    logs: readonly { message: string; timestamp: number }[];
    live?: boolean;
    feed?: readonly FeedEvent[];
    connectionState?: 'connecting' | 'live' | 'reconnecting' | 'idle' | 'closed';
    rateBuckets?: readonly number[];
  } = $props();

  // Respect prefers-reduced-motion: jump scroll instead of smooth.
  const reducedMotion =
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;

  let feedEl = $state<HTMLDivElement | null>(null);

  // Auto-scroll to bottom when feed grows.
  $effect(() => {
    // Touch feed to register dependency.
    void feed.length;
    tick().then(() => {
      if (!feedEl) return;
      if (reducedMotion) {
        feedEl.scrollTop = feedEl.scrollHeight;
      } else {
        feedEl.scrollTo({ top: feedEl.scrollHeight, behavior: 'smooth' });
      }
    });
  });

  // Sparkline: compute SVG polyline points from rateBuckets.
  const SPARK_W = 48;
  const SPARK_H = 14;

  function sparklinePoints(buckets: readonly number[]): string {
    if (!buckets || buckets.length === 0) return '';
    const max = Math.max(...buckets, 1);
    const step = SPARK_W / Math.max(buckets.length - 1, 1);
    return buckets
      .map((v, i) => {
        const x = i * step;
        const y = SPARK_H - (v / max) * SPARK_H;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }

  // Derived values (no $state — just computed in template).
  function connLabel(cs: typeof connectionState): string {
    if (cs === 'connecting') return 'connecting…';
    if (cs === 'live') return '● LIVE';
    if (cs === 'reconnecting') return '● reconnecting';
    if (cs === 'idle') return '● idle';
    return '● closed';
  }

  function toneClass(tone: string): string {
    switch (tone) {
      case 'fact':      return 'tone-fact';
      case 'challenge': return 'tone-challenge';
      case 'entity':    return 'tone-entity';
      case 'link':      return 'tone-link';
      case 'source':    return 'tone-source';
      default:          return 'tone-log';
    }
  }
</script>

<div class="ticker" class:live aria-label="Research activity ticker">
  <!-- Left: pulse indicator + sparkline -->
  <div class="pulse-zone" class:conn-live={connectionState === 'live'}
    class:conn-reconnecting={connectionState === 'reconnecting'}
    class:conn-idle={connectionState === 'idle' || connectionState === 'closed'}
    class:conn-connecting={connectionState === 'connecting'}>
    <span class="conn-label" title="SSE connection state">{connLabel(connectionState)}</span>
    <svg
      class="sparkline"
      width={SPARK_W}
      height={SPARK_H}
      aria-hidden="true"
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
    >
      {#if rateBuckets.length > 1}
        <polyline
          points={sparklinePoints(rateBuckets)}
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linejoin="round"
          stroke-linecap="round"
        />
      {/if}
    </svg>
  </div>

  <!-- Centre: scrolling terminal feed -->
  <div class="feed-scroll" bind:this={feedEl} aria-live="polite" aria-label="Event feed">
    {#each feed as ev (ev.seq)}
      <span class="feed-line {toneClass(ev.tone)}">{ev.text}</span>
    {/each}
    {#if feed.length === 0}
      <span class="feed-line tone-log">idle · standing by</span>
    {/if}
  </div>
</div>

<style>
  .ticker {
    display: flex;
    align-items: stretch;
    height: 76px;          /* ~6 feed lines × 13px */
    background: #1a1008;
    border-top: 1px solid rgba(250, 246, 238, 0.12);
    color: #ede4d4;
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: 11px;
    letter-spacing: 0.02em;
    overflow: hidden;
    z-index: 30;
    flex-shrink: 0;
  }

  /* ── pulse zone ── */
  .pulse-zone {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 0 10px;
    border-right: 1px solid rgba(250, 246, 238, 0.10);
    flex-shrink: 0;
    min-width: 84px;
  }

  .conn-label {
    font-size: 9px;
    letter-spacing: 0.10em;
    white-space: nowrap;
    font-weight: 600;
  }

  /* State colours */
  .conn-live .conn-label     { color: var(--success, #4caf81); }
  .conn-live .sparkline      { color: var(--success, #4caf81); }
  .conn-reconnecting .conn-label { color: var(--warn, #e6a817); }
  .conn-reconnecting .sparkline  { color: var(--warn, #e6a817); }
  .conn-connecting .conn-label   { color: rgba(237, 228, 212, 0.55); }
  .conn-connecting .sparkline    { color: rgba(237, 228, 212, 0.25); }
  .conn-idle .conn-label     { color: rgba(237, 228, 212, 0.40); }
  .conn-idle .sparkline      { color: rgba(237, 228, 212, 0.20); }

  /* Pulse when live */
  .conn-live .conn-label {
    animation: pulse-live 2s ease-in-out infinite;
  }
  @keyframes pulse-live {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.55; }
  }

  .sparkline {
    display: block;
  }

  /* ── feed scroll ── */
  .feed-scroll {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    padding: 4px 10px;
    gap: 0;
    scrollbar-width: none;    /* Firefox */
  }
  .feed-scroll::-webkit-scrollbar { display: none; }

  .feed-line {
    display: block;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.55;
    font-size: 10.5px;
    opacity: 0.85;
    padding: 0;
  }

  /* Tone colours */
  .tone-fact      { color: var(--accent, #c8a26b); opacity: 1; }
  .tone-challenge { color: #e05c5c; opacity: 1; }
  .tone-entity    { color: var(--success, #4caf81); opacity: 1; }
  .tone-link      { color: rgba(237, 228, 212, 0.65); }
  .tone-source    { color: rgba(237, 228, 212, 0.85); }
  .tone-log       { color: rgba(237, 228, 212, 0.45); }

  /* Live blink on the outer dot when active */
  .ticker.live .pulse-zone { /* outer state already handled by conn-* classes */ }
</style>
