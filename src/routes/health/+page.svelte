<script lang="ts">
  import HealthNav from '$lib/components/health/v2/HealthNav.svelte';
  import Hero from '$lib/components/health/v2/Hero.svelte';
  import Narrative from '$lib/components/health/v2/Narrative.svelte';
  import PulseGrid from '$lib/components/health/v2/PulseGrid.svelte';
  import Breakdown from '$lib/components/health/v2/Breakdown.svelte';
  import Correlations from '$lib/components/health/v2/Correlations.svelte';

  let { data } = $props();

  // Hand-curated annotation callouts. Replace with computed call-outs once tooling exists.
  const annotations = [
    {
      when: 'PEAK STRAIN DAY',
      text: `Hardest session in the window — visible spike on the strain row. Recovery and HRV pay for it the next morning.`,
    },
    {
      when: 'HRV TROUGH',
      text: `Lowest HRV reading lines up with elevated RHR — same physiology, two metrics. Watch for clustering.`,
    },
    {
      when: 'RECOVERY STREAK',
      text: `The greenest cells on the recovery row mark the days the body was, briefly, happy.`,
    },
  ];
</script>

<svelte:head>
  <title>Health — Strange Ramblings</title>
  <meta
    name="description"
    content="Live health dashboard — readiness, autonomic balance, training load, sleep, body signals."
  />
  <meta property="og:title" content="Health — Strange Ramblings" />
  <meta
    property="og:description"
    content="Live health dashboard — readiness, autonomic balance, training load, sleep, body signals."
  />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://strangeramblings.com/health" />
</svelte:head>

<div class="h-root">
  <HealthNav syncedAgoSeconds={data.syncedAgoSeconds} />

  <Hero
    series={data.series}
    today={data.today}
    headline={data.headline}
    strap={data.strap}
    todayDeltas={data.todayDeltas}
  />

  <section class="h-section">
    <div class="h-section-inner">
      <p class="h-section-num">02 / NARRATIVE</p>
      <Narrative narrative={data.narrative} />
    </div>
  </section>

  <section class="h-section tinted">
    <div class="h-section-inner">
      <div class="h-section-head">
        <div>
          <p class="h-section-num">03 / 30 DAYS · ALL METRICS</p>
          <h2 class="h-section-title">THE PULSE GRID</h2>
        </div>
        <p class="h-section-strap">
          Every cell is a day. Colour intensity scales with the metric.
        </p>
      </div>
      <PulseGrid series={data.series} />
      <div class="h-annot-grid">
        {#each annotations as a, i (i)}
          <div class="h-annot">
            <p class="h-annot-when">{a.when}</p>
            <p class="h-annot-text">{a.text}</p>
          </div>
        {/each}
      </div>
    </div>
  </section>

  <section class="h-section">
    <div class="h-section-inner">
      <div class="h-section-head">
        <div>
          <p class="h-section-num">04 / METRICS · TODAY & 30D</p>
          <h2 class="h-section-title">THE BREAKDOWN</h2>
        </div>
        <p class="h-section-strap">Each card: a number, a sparkline, a sentence.</p>
      </div>
      <Breakdown
        series={data.series}
        today={data.today}
        yesterday={data.yesterday}
        workouts={data.workouts}
      />
    </div>
  </section>

  <section class="h-section tinted">
    <div class="h-section-inner">
      <div class="h-section-head">
        <div>
          <p class="h-section-num">05 / CORRELATIONS · LIGHTLY SCIENTIFIC</p>
          <h2 class="h-section-title">WHAT MOVES WHAT</h2>
        </div>
        <p class="h-section-strap">
          N is small. Take with a pinch of salt and a glass of water.
        </p>
      </div>
      <Correlations items={data.correlations} />
    </div>
  </section>

  <footer class="h-footer">
    <p class="h-footer-mark">STRANGE RAMBLINGS · /HEALTH</p>
    <p class="h-disclaimer">Not medical advice · Source: Whoop, Apple Health, Strava</p>
  </footer>
</div>

<style>
  .h-root {
    min-height: 100vh;
    background: var(--bg);
    color: var(--text-primary);
    font-family: var(--font-body);
    position: relative;
    overflow-x: hidden;
  }

  .h-section {
    padding: 56px 32px;
    border-bottom: 1px solid var(--divider);
  }
  .h-section.tinted {
    background: var(--bg-section);
  }
  .h-section-inner {
    max-width: 1480px;
    margin: 0 auto;
  }
  .h-section-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 28px;
    gap: 24px;
    flex-wrap: wrap;
  }
  .h-section-title {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 40px;
    text-transform: uppercase;
    letter-spacing: -0.02em;
    line-height: 1;
    margin: 0;
    color: var(--text-primary);
  }
  .h-section-strap {
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0;
    max-width: 360px;
    text-align: right;
  }
  .h-section-num {
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.15em;
    color: var(--text-ghost);
    margin: 0 0 8px 0;
    text-transform: uppercase;
  }

  .h-annot-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
    margin-top: 20px;
  }
  @media (max-width: 900px) {
    .h-annot-grid {
      grid-template-columns: 1fr;
    }
  }
  .h-annot {
    border-left: 3px solid var(--accent);
    padding: 8px 14px;
    background: rgba(196, 87, 10, 0.04);
  }
  .h-annot-when {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--accent);
    margin: 0 0 4px 0;
  }
  .h-annot-text {
    font-size: 14px;
    line-height: 1.5;
    margin: 0;
    color: var(--text-primary);
  }
  .h-annot-text :global(em) {
    font-style: italic;
    color: var(--text-secondary);
  }

  .h-footer {
    padding: 36px 32px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 20px;
  }
  .h-footer-mark {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 14px;
    text-transform: uppercase;
    letter-spacing: -0.02em;
    color: var(--text-ghost);
    margin: 0;
  }
  .h-disclaimer {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--text-ghost);
    margin: 0;
  }

  @media (prefers-reduced-motion: reduce) {
    :global(.h-pulse-dot) {
      animation: none;
    }
  }

  @media (max-width: 720px) {
    .h-section {
      padding: 36px 16px;
    }
    .h-section-title {
      font-size: 28px;
    }
    .h-footer {
      padding: 24px 16px;
    }
  }
</style>
