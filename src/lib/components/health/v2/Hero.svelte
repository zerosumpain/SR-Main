<script lang="ts">
  import type { HealthDay } from '$lib/health/series-30d-service';
  import Readiness from './Readiness.svelte';

  type Factor = { value: number; weight: number };
  type ReadinessData = {
    score: number;
    label: string;
    recommendation: string;
    factors: {
      recovery: Factor;
      hrvTrend: Factor & { direction: 'up' | 'down' | 'stable'; raw?: number; avg7d?: number };
      sleepQuality: Factor;
      loadBalance: Factor & { zone: string };
    };
  } | null;

  let {
    today,
    headline,
    strap,
    todayDeltas,
    rhrBaseline,
    readiness,
    onevidence,
  }: {
    today: HealthDay;
    headline: { primary: string; ghost: string };
    strap: string;
    todayDeltas: { recDelta: number; hrvDeltaPct: number; rhrDelta: number; sleepDelta: number };
    rhrBaseline: number;
    readiness: ReadinessData;
    onevidence?: (id: string) => void;
  } = $props();

  const dateTag = new Date()
    .toLocaleDateString('en', { day: '2-digit', month: 'short', year: 'numeric' })
    .toUpperCase();

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
      ? '→ at 7d avg'
      : (sleepDeltaMin > 0 ? '↑ ' : '↓ ') +
        Math.floor(Math.abs(sleepDeltaMin) / 60) +
        'h ' +
        Math.round(Math.abs(sleepDeltaMin) % 60) +
        'm vs 7d',
  );
</script>

<section class="h-hero">
  <div class="h-hero-inner">
    <p class="h-section-num">01 / TODAY · {dateTag}</p>

    {#if readiness}
      <Readiness {readiness} {onevidence} />
    {/if}

    <p class="h-hero-editorial" class:lead={!readiness}>
      <span class="h-hero-ed-headline">{headline.primary} {headline.ghost}</span>
      <span class="h-hero-ed-strap">{strap}</span>
    </p>

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
          {fmtDelta(todayDeltas.hrvDeltaPct, '% vs yest')}
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
          {fmtDelta(todayDeltas.rhrDelta, ` vs base ${rhrBaseline}`)}
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
</section>

<style>
  .h-hero {
    position: relative;
    padding: 56px 32px 44px;
    border-bottom: 1px solid var(--divider);
  }
  .h-hero-inner {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 22px;
    max-width: 1480px;
    margin: 0 auto;
    width: 100%;
  }
  .h-section-num {
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.15em;
    color: var(--text-ghost);
    margin: 0;
    text-transform: uppercase;
  }
  .h-hero-editorial {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin: 0;
    border-left: 3px solid var(--accent);
    padding-left: 16px;
  }
  .h-hero-ed-headline {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: clamp(28px, 4vw, 44px);
    line-height: 0.95;
    letter-spacing: -0.03em;
    text-transform: uppercase;
    color: var(--text-primary);
  }
  .h-hero-ed-strap {
    font-family: var(--font-body);
    font-size: 15px;
    line-height: 1.5;
    color: var(--text-secondary);
    max-width: 560px;
  }
  /* When readiness is unavailable, the editorial line becomes the hero lead. */
  .h-hero-editorial.lead .h-hero-ed-headline {
    font-size: clamp(48px, 8vw, 104px);
    line-height: 0.86;
  }

  .h-today {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0;
    border-top: 2px solid var(--card-border);
    border-bottom: 2px solid var(--card-border);
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
  }
  .h-today-cell:last-child {
    border-right: none;
  }
  @media (max-width: 720px) {
    .h-today-cell:nth-child(2) {
      border-right: none;
    }
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
    color: var(--trend-down);
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
    color: var(--trend-down);
  }
  .h-today-delta.flat {
    color: var(--text-muted);
  }

  @media (max-width: 720px) {
    .h-hero {
      padding: 40px 16px 32px;
    }
  }
</style>
