<script lang="ts">
  import { onMount } from 'svelte';
  import type { HealthDay } from '$lib/health/series-30d-service';
  import Ecg from './Ecg.svelte';
  import Orbit from './Orbit.svelte';
  import Biome from './Biome.svelte';

  type Variant = 'ecg' | 'orbit' | 'biome';

  let {
    series,
    today,
    headline,
    strap,
    todayDeltas,
  }: {
    series: HealthDay[];
    today: HealthDay;
    headline: { primary: string; ghost: string };
    strap: string;
    todayDeltas: { recDelta: number; hrvDeltaPct: number; rhrDelta: number; sleepDelta: number };
  } = $props();

  let variant = $state<Variant>('ecg');

  onMount(() => {
    try {
      const stored = localStorage.getItem('sr.health.viz');
      if (stored === 'ecg' || stored === 'orbit' || stored === 'biome') variant = stored;
    } catch {
      // ignore
    }
  });

  function setVariant(v: Variant) {
    variant = v;
    try {
      localStorage.setItem('sr.health.viz', v);
    } catch {
      // ignore
    }
  }

  const dateTag = new Date()
    .toLocaleDateString('en', { day: '2-digit', month: 'short', year: 'numeric' })
    .toUpperCase();

  const footMeta = $derived(
    variant === 'ecg'
      ? 'CH1 · 250 Hz · LIVE'
      : variant === 'orbit'
        ? 'TODAY vs 30d BASELINE'
        : 'BIOME · AMBIENT',
  );

  function fmtDelta(n: number, suffix = '', sign = true): string {
    if (n === 0) return `→ ${suffix}`;
    const arrow = n > 0 ? '↑' : '↓';
    const num = sign ? Math.abs(n) : n;
    return `${arrow} ${num}${suffix}`;
  }

  function recoveryClass(rec: number): string {
    if (rec < 40) return 'bad';
    if (rec >= 67) return 'accent';
    return '';
  }

  const sleepDeltaMin = $derived(todayDeltas.sleepDelta / 60);
  const sleepDeltaText = $derived(
    sleepDeltaMin === 0
      ? '→ at baseline'
      : (sleepDeltaMin > 0 ? '↑ ' : '↓ ') +
        Math.floor(Math.abs(sleepDeltaMin) / 60) +
        'h ' +
        Math.round(Math.abs(sleepDeltaMin) % 60) +
        'm',
  );
</script>

<section class="h-hero">
  <div class="h-hero-bg">
    {#if variant === 'ecg'}
      <Ecg rhr={today.rhr || 64} />
    {:else if variant === 'orbit'}
      <Orbit {series} {today} />
    {:else}
      <Biome rhr={today.rhr || 64} />
    {/if}
  </div>

  <div class="h-hero-inner">
    <div class="h-hero-left">
      <p class="h-section-num">01 / TODAY · {dateTag}</p>
      <h1 class="h-hero-headline">
        {headline.primary}<br /><span class="ghost">{headline.ghost}</span>
      </h1>
      <p class="h-hero-strap">{strap}</p>
      <div class="h-today">
        <div class="h-today-cell">
          <p class="h-today-label">RECOVERY</p>
          <p class="h-today-value {recoveryClass(today.rec)}">
            {today.rec}<span class="h-today-unit">%</span>
          </p>
          <p
            class="h-today-delta"
            class:up={todayDeltas.recDelta > 0}
            class:down={todayDeltas.recDelta < 0}
            class:flat={todayDeltas.recDelta === 0}
          >
            {fmtDelta(todayDeltas.recDelta, ' vs 7d avg')}
          </p>
        </div>
        <div class="h-today-cell">
          <p class="h-today-label">HRV</p>
          <p class="h-today-value">{today.hrv}<span class="h-today-unit">ms</span></p>
          <p
            class="h-today-delta"
            class:up={todayDeltas.hrvDeltaPct > 0}
            class:down={todayDeltas.hrvDeltaPct < 0}
            class:flat={todayDeltas.hrvDeltaPct === 0}
          >
            {fmtDelta(todayDeltas.hrvDeltaPct, '% overnight')}
          </p>
        </div>
        <div class="h-today-cell">
          <p class="h-today-label">RESTING HR</p>
          <p class="h-today-value">{today.rhr}<span class="h-today-unit">bpm</span></p>
          <p
            class="h-today-delta"
            class:up={todayDeltas.rhrDelta < 0}
            class:down={todayDeltas.rhrDelta > 0}
            class:flat={todayDeltas.rhrDelta === 0}
          >
            {fmtDelta(todayDeltas.rhrDelta, ' vs baseline')}
          </p>
        </div>
        <div class="h-today-cell">
          <p class="h-today-label">SLEEP</p>
          <p class="h-today-value">
            {today.slept.toFixed(1)}<span class="h-today-unit">h</span>
          </p>
          <p
            class="h-today-delta"
            class:up={sleepDeltaMin > 0}
            class:down={sleepDeltaMin < 0}
            class:flat={sleepDeltaMin === 0}
          >
            {sleepDeltaText}
          </p>
        </div>
      </div>
    </div>
  </div>

  <div class="h-hero-bg-foot">
    <span class="h-foot-meta">SIGNATURE · {variant.toUpperCase()} · {footMeta}</span>
    <div class="h-viz-tabs" role="tablist" aria-label="Hero visual">
      <button
        class="h-viz-tab"
        aria-pressed={variant === 'ecg'}
        onclick={() => setVariant('ecg')}>ECG</button
      >
      <button
        class="h-viz-tab"
        aria-pressed={variant === 'orbit'}
        onclick={() => setVariant('orbit')}>Orbit</button
      >
      <button
        class="h-viz-tab"
        aria-pressed={variant === 'biome'}
        onclick={() => setVariant('biome')}>Biome</button
      >
    </div>
  </div>
</section>

<style>
  .h-hero {
    position: relative;
    padding: 64px 32px 56px;
    overflow: hidden;
    border-bottom: 1px solid var(--divider);
    min-height: 680px;
    display: flex;
    flex-direction: column;
  }
  .h-hero-bg {
    position: absolute;
    inset: 0;
    z-index: 0;
    pointer-events: none;
  }
  .h-hero-bg::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(
      to right,
      var(--bg) 0%,
      rgba(237, 228, 212, 0.5) 25%,
      rgba(237, 228, 212, 0.2) 60%,
      rgba(237, 228, 212, 0.6) 100%
    );
    pointer-events: none;
  }
  .h-hero-bg-foot {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 32px;
    z-index: 4;
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--text-muted);
    border-top: 1px solid var(--divider);
    background: color-mix(in srgb, var(--bg) 80%, transparent);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
    flex-wrap: wrap;
    gap: 12px;
  }
  .h-foot-meta {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .h-hero-inner {
    position: relative;
    z-index: 5;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 48px;
    max-width: 1480px;
    margin: 0 auto;
    width: 100%;
    flex: 1;
    align-items: stretch;
  }
  .h-hero-left {
    display: flex;
    flex-direction: column;
    gap: 18px;
    padding-bottom: 56px;
    justify-content: flex-end;
    max-width: 760px;
  }
  .h-section-num {
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.15em;
    color: var(--text-ghost);
    margin: 0 0 8px 0;
    text-transform: uppercase;
  }
  .h-hero-headline {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: clamp(56px, 9vw, 132px);
    line-height: 0.86;
    letter-spacing: -0.03em;
    text-transform: uppercase;
    margin: 0;
    color: var(--text-primary);
  }
  .h-hero-headline :global(.ghost) {
    color: var(--text-ghost);
  }
  .h-hero-strap {
    font-size: 16px;
    line-height: 1.5;
    max-width: 480px;
    margin: 0;
    color: var(--text-secondary);
    border-left: 3px solid var(--accent);
    padding-left: 14px;
  }

  .h-today {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0;
    border-top: 2px solid var(--card-border);
    border-bottom: 2px solid var(--card-border);
    margin-top: 24px;
  }
  @media (max-width: 720px) {
    .h-today {
      grid-template-columns: 1fr 1fr;
    }
  }
  .h-today-cell {
    padding: 14px 18px;
    border-right: 1px solid var(--divider);
    display: flex;
    flex-direction: column;
    gap: 4px;
    position: relative;
  }
  .h-today-cell:last-child {
    border-right: none;
  }
  .h-today-label {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0;
  }
  .h-today-value {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 36px;
    letter-spacing: -0.02em;
    line-height: 1;
    margin: 0;
    color: var(--text-primary);
  }
  .h-today-value.accent {
    color: var(--accent);
  }
  .h-today-value.bad {
    color: #8a3a08;
  }
  .h-today-unit {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.1em;
    color: var(--text-muted);
    margin-left: 4px;
    text-transform: uppercase;
  }
  .h-today-delta {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    margin: 0;
  }
  .h-today-delta.up {
    color: var(--accent);
  }
  .h-today-delta.down {
    color: #8a3a08;
  }
  .h-today-delta.flat {
    color: var(--text-muted);
  }

  .h-viz-tabs {
    display: inline-flex;
    gap: 0;
    pointer-events: auto;
  }
  .h-viz-tab {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--text-muted);
    background: transparent;
    border: 1px solid var(--card-border);
    padding: 4px 10px;
    cursor: pointer;
    margin-left: -1px;
    transition: all 0.18s ease-out;
    border-radius: 0;
  }
  .h-viz-tab:hover {
    color: var(--text-primary);
  }
  .h-viz-tab[aria-pressed='true'] {
    color: #fff;
    background: var(--accent);
    border-color: var(--accent);
  }

  @media (max-width: 720px) {
    .h-hero {
      padding: 48px 16px 80px;
      min-height: 560px;
    }
    .h-hero-bg-foot {
      padding: 10px 16px;
    }
  }
</style>
