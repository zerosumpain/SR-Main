<script lang="ts">
  import { throughput, tokensFromChars, rate } from '$lib/jkai/throughput-bus.svelte';

  // `compact` is the collapsed icon-rail variant: bare number, no unit or
  // window label, and no click target (the rail is too narrow for one).
  let { compact = false }: { compact?: boolean } = $props();

  // Re-read the running clock 4×/s so the live figure moves. The effect reads
  // `throughput.live` and writes `now` without reading it — reading its own
  // write is what turns a ticker like this into an update loop.
  let now = $state(0);
  let ticker: ReturnType<typeof setInterval> | null = null;
  $effect(() => {
    if (!throughput.live) {
      if (ticker) { clearInterval(ticker); ticker = null; }
      return;
    }
    now = performance.now();
    ticker = setInterval(() => { now = performance.now(); }, 250);
    return () => { if (ticker) { clearInterval(ticker); ticker = null; } };
  });

  const liveActiveMs = $derived(
    throughput.activeMs +
      (throughput.startedAt === null ? 0 : Math.max(0, now - throughput.startedAt)),
  );
  const liveTps = $derived(rate(tokensFromChars(throughput.chars), liveActiveMs));
  const sessionTps = $derived(rate(throughput.sessionTokens, throughput.sessionActiveMs));

  // Click-to-cycle window, mirroring MetricsStrip's spend control. A live turn
  // always shows itself — the window choice applies once it settles.
  const VIEWS = [
    { key: 'last', label: 'last turn' },
    { key: 'session', label: 'session' },
  ] as const;
  let viewIdx = $state(0);
  const view = $derived(VIEWS[viewIdx]);
  function cycleView() {
    viewIdx = (viewIdx + 1) % VIEWS.length;
  }

  const shown = $derived.by(() => {
    if (throughput.live) return { value: liveTps, label: 'live', estimated: true };
    if (view.key === 'session') {
      return { value: sessionTps, label: 'session', estimated: !throughput.lastActual };
    }
    return { value: throughput.lastTps, label: 'last turn', estimated: !throughput.lastActual };
  });

  function fmt(v: number | null): string {
    if (v === null) return '—';
    return v >= 100 ? v.toFixed(0) : v.toFixed(1);
  }

  const TITLE =
    'Measured output throughput: reply tokens + reasoning tokens + tool-call tokens, ' +
    'over generation time only — time spent running tools (and waiting for the ' +
    'provider afterwards) is excluded. The live figure is a chars/4 estimate; ' +
    'it settles to the provider\'s reported output-token count when the turn ends ' +
    '(a leading ≈ means no provider count was available). Click to switch window.';
</script>

{#if compact}
  <!-- Collapsed rail: keep the metric reachable when the sidebar is a rail. -->
  <div class="tput-rail" class:live={throughput.live} title={TITLE}>
    <span class="rail-val">{fmt(shown.value)}</span>
    <span class="rail-unit">t/s</span>
  </div>
{:else}
  <button type="button" class="tput" class:live={throughput.live} onclick={cycleView} title={TITLE}>
    <span class="dot" class:on={throughput.live}></span>
    {#if shown.estimated && shown.value !== null}<span class="approx">≈</span>{/if}<span class="val">{fmt(shown.value)}</span>
    <span class="unit">tok/s</span>
    <span class="sep">·</span>
    <span class="win">{shown.label}</span>
  </button>
{/if}

<style>
  .tput {
    display: flex;
    align-items: center;
    gap: 0 4px;
    background: transparent;
    border: none;
    padding: 0;
    margin: 0;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-ghost);
    cursor: pointer;
    text-align: left;
    white-space: nowrap;
  }
  .tput:hover {
    color: var(--text-primary);
  }
  .tput.live {
    color: var(--accent);
  }
  .dot {
    width: 5px;
    height: 5px;
    border-radius: var(--radius-full, 100px);
    background: currentColor;
    opacity: 0.35;
    flex: none;
  }
  .dot.on {
    opacity: 1;
    animation: tput-pulse 1.4s ease-in-out infinite;
  }
  @keyframes tput-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }
  .approx {
    opacity: 0.6;
  }
  .val {
    font-variant-numeric: tabular-nums;
  }
  .sep {
    opacity: 0.5;
  }

  /* ---- collapsed rail ---- */
  .tput-rail {
    display: flex;
    flex-direction: column;
    align-items: center;
    line-height: 1.1;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-ghost);
  }
  .tput-rail.live {
    color: var(--accent);
  }
  .rail-val {
    font-variant-numeric: tabular-nums;
  }
  .rail-unit {
    font-size: 8px;
    opacity: 0.7;
  }
</style>
