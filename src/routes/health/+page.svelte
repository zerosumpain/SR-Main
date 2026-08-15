<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Hero from '$lib/components/health/v2/Hero.svelte';
  import Narrative from '$lib/components/health/v2/Narrative.svelte';
  import WeekInNumbers from '$lib/components/health/v2/WeekInNumbers.svelte';
  import PulseGrid from '$lib/components/health/v2/PulseGrid.svelte';
  import Breakdown from '$lib/components/health/v2/Breakdown.svelte';
  import TrainingLoad from '$lib/components/health/v2/TrainingLoad.svelte';
  import RecoverySignals from '$lib/components/health/v2/RecoverySignals.svelte';
  import SleepConsistency from '$lib/components/health/v2/SleepConsistency.svelte';
  import Fitness from '$lib/components/health/v2/Fitness.svelte';
  import Correlations from '$lib/components/health/v2/Correlations.svelte';
  import EpicActivities from '$lib/components/health/v2/EpicActivities.svelte';
  import MethodologyDrawer from '$lib/components/health/v2/MethodologyDrawer.svelte';
  import { fmtAgo } from '$lib/components/health/v2/utils';

  let { data } = $props();

  const a = $derived(data.analytics);

  // Methodology drawer — opened by any EvidenceChip across the page.
  let evidenceOpen = $state(false);
  let evidenceFocus = $state<string | null>(null);
  function openEvidence(id: string) {
    evidenceFocus = id;
    evidenceOpen = true;
  }

  const suff = (m: { sufficiency?: string } | null | undefined) =>
    !!m && m.sufficiency !== 'insufficient';

  const stale = $derived(data.syncedAgoSeconds > 12 * 3600);

  const showTraining = $derived(
    (!!a.trainingLoad && !(a.trainingLoad.acute === 0 && a.trainingLoad.chronic === 0)) ||
      (suff(a.monotony) && (a.monotony?.value?.mean ?? 0) > 0 && (a.monotony?.value?.sd ?? 0) > 0) ||
      suff(a.polarised),
  );
  const showRecovery = $derived(suff(a.recoveryDebt) || suff(a.autonomic));
  const showSleepRhythm = $derived(suff(a.sleepRegularity) || suff(a.circadian));
  const showFitness = $derived(
    suff(a.vo2max) ||
      (!!a.stats?.weekly &&
        (a.stats.weekly.activities > 0 ||
          (a.stats.personalRecords?.length ?? 0) > 0 ||
          a.stats.weekly.avgRecovery > 0)),
  );
</script>

<svelte:head>
  <title>Health — Strange Ramblings</title>
  <meta
    name="description"
    content="Live health dashboard — readiness, training load, injury risk, autonomic balance, sleep regularity, body signals."
  />
  <meta property="og:title" content="Health — Strange Ramblings" />
  <meta
    property="og:description"
    content="Live health dashboard — readiness, training load, injury risk, autonomic balance, sleep regularity, body signals."
  />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://strangeramblings.com/health" />
</svelte:head>

<div class="h-root">
  <PageHeader title="HEALTH">
    {#snippet meta()}
      <span class="h-sync-meta" class:stale>
        <span class="h-pulse-dot" class:stale aria-hidden="true"></span>
        {stale ? 'Stale' : 'Live'} · synced {fmtAgo(data.syncedAgoSeconds)} ago
      </span>
    {/snippet}
  </PageHeader>

  <Hero
    today={data.today}
    headline={data.headline}
    strap={data.strap}
    todayDeltas={data.todayDeltas}
    rhrBaseline={data.rhrBaseline}
    readiness={a.readiness}
    onevidence={openEvidence}
  />

  <section class="h-section">
    <div class="h-section-inner">
      <p class="h-section-num">02 / NARRATIVE</p>
      <Narrative narrative={data.narrative} />
      {#if data.narrative?.stats}
        <div class="h-week-wrap">
          <WeekInNumbers stats={data.narrative.stats} />
        </div>
      {/if}
    </div>
  </section>

  {#if showTraining}
    <section class="h-section tinted">
      <div class="h-section-inner">
        <div class="h-section-head">
          <div>
            <p class="h-section-num">03 / LOAD · INJURY RISK</p>
            <h2 class="h-section-title">ARE YOU OVERREACHING?</h2>
          </div>
          <p class="h-section-strap">
            Acute load vs your chronic base. The sweet spot keeps you building without breaking.
          </p>
        </div>
        <TrainingLoad
          trainingLoad={a.trainingLoad}
          monotony={a.monotony}
          polarised={a.polarised}
          onevidence={openEvidence}
        />
      </div>
    </section>
  {/if}

  {#if showRecovery}
    <section class="h-section">
      <div class="h-section-inner">
        <div class="h-section-head">
          <div>
            <p class="h-section-num">04 / RECOVERY · AUTONOMIC</p>
            <h2 class="h-section-title">HOW DEEP IS THE HOLE?</h2>
          </div>
          <p class="h-section-strap">
            Cumulative sleep debt and where your nervous system sits against its own baseline.
          </p>
        </div>
        <RecoverySignals
          recoveryDebt={a.recoveryDebt}
          autonomic={a.autonomic}
          onevidence={openEvidence}
        />
      </div>
    </section>
  {/if}

  <section class="h-section tinted">
    <div class="h-section-inner">
      <div class="h-section-head">
        <div>
          <p class="h-section-num">05 / 30 DAYS · ALL METRICS</p>
          <h2 class="h-section-title">THE PULSE GRID</h2>
        </div>
        <p class="h-section-strap">
          Every cell is a day. Each row is scaled to its own range — read down a row, not across.
        </p>
      </div>
      <PulseGrid series={data.series} />
      {#if data.annotations?.length}
        <div class="h-annot-grid">
          {#each data.annotations as annot, i (i)}
            <div class="h-annot">
              <p class="h-annot-when">{annot.when}</p>
              <p class="h-annot-text">{@html annot.text}</p>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </section>

  <section class="h-section">
    <div class="h-section-inner">
      <div class="h-section-head">
        <div>
          <p class="h-section-num">06 / METRICS · TODAY & 30D</p>
          <h2 class="h-section-title">THE BREAKDOWN</h2>
        </div>
        <p class="h-section-strap">Each card: a number, a sparkline, and what to do about it.</p>
      </div>
      <Breakdown
        series={data.series}
        today={data.today}
        yesterday={data.yesterday}
        workouts={data.workouts}
        rhrBaseline={data.rhrBaseline}
        rings={data.rings}
      />
    </div>
  </section>

  {#if showSleepRhythm}
    <section class="h-section tinted">
      <div class="h-section-inner">
        <div class="h-section-head">
          <div>
            <p class="h-section-num">07 / SLEEP · RHYTHM</p>
            <h2 class="h-section-title">IS YOUR CLOCK STEADY?</h2>
          </div>
          <p class="h-section-strap">
            Duration is only half of sleep. Regularity and timing are the other half.
          </p>
        </div>
        <SleepConsistency
          sleepRegularity={a.sleepRegularity}
          circadian={a.circadian}
          onevidence={openEvidence}
        />
      </div>
    </section>
  {/if}

  {#if showFitness}
    <section class="h-section">
      <div class="h-section-inner">
        <div class="h-section-head">
          <div>
            <p class="h-section-num">08 / FITNESS · RECORDS</p>
            <h2 class="h-section-title">THE LONG GAME</h2>
          </div>
          <p class="h-section-strap">
            Cardio fitness against the population, the week's volume, and the all-time bests.
          </p>
        </div>
        <Fitness vo2max={a.vo2max} stats={a.stats} onevidence={openEvidence} />
      </div>
    </section>
  {/if}

  <section class="h-section tinted">
    <div class="h-section-inner">
      <div class="h-section-head">
        <div>
          <p class="h-section-num">09 / CORRELATIONS · LIGHTLY SCIENTIFIC</p>
          <h2 class="h-section-title">WHAT MOVES WHAT</h2>
        </div>
        <p class="h-section-strap">
          N is small. Take with a pinch of salt and a glass of water.
        </p>
      </div>
      <Correlations items={data.correlations} />
    </div>
  </section>

  {#if data.featuredActivities?.length}
    <section class="h-section">
      <div class="h-section-inner">
        <div class="h-section-head">
          <div>
            <p class="h-section-num">10 / FIELD NOTES · GPS TRACES</p>
            <h2 class="h-section-title">EPIC ACTIVITIES</h2>
          </div>
          <p class="h-section-strap">
            The days that earned a name. Routes drawn from Strava.
          </p>
        </div>
        <EpicActivities activities={data.featuredActivities} />
      </div>
    </section>
  {/if}

  <footer class="h-footer">
    <p class="h-footer-mark">STRANGE RAMBLINGS · /HEALTH</p>
    <div class="h-footer-right">
      <button type="button" class="h-method-btn" onclick={() => openEvidence('')}>
        METHODOLOGY
      </button>
      <p class="h-disclaimer">Not medical advice · Source: Whoop, Apple Health, Strava</p>
    </div>
  </footer>
</div>

<MethodologyDrawer
  open={evidenceOpen}
  focusId={evidenceFocus}
  onclose={() => (evidenceOpen = false)}
/>

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
    border-bottom: 1px solid var(--line-hair);
  }
  .h-section.tinted {
    background: var(--surface-sunken);
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
    font-size: var(--fs-label-xs);
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0;
    max-width: 360px;
    text-align: right;
  }
  .h-section-num {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.15em;
    color: var(--text-ghost);
    margin: 0 0 8px 0;
    text-transform: uppercase;
  }

  .h-week-wrap {
    margin-top: 24px;
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
    background: var(--accent-tint-04);
  }
  .h-annot-when {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--accent);
    margin: 0 0 4px 0;
  }
  .h-annot-text {
    font-size: var(--fs-nav);
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
    font-size: var(--fs-nav);
    text-transform: uppercase;
    letter-spacing: -0.02em;
    color: var(--text-ghost);
    margin: 0;
  }
  .h-footer-right {
    display: flex;
    align-items: center;
    gap: 18px;
    flex-wrap: wrap;
  }
  .h-method-btn {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--text-muted);
    background: transparent;
    border: 1px solid var(--line-strong);
    padding: 5px 12px;
    cursor: pointer;
    transition: color 0.18s, border-color 0.18s;
  }
  .h-method-btn:hover {
    color: var(--accent);
    border-color: var(--accent);
  }
  .h-disclaimer {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--text-ghost);
    margin: 0;
  }

  .h-sync-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--text-muted);
    display: inline-flex;
    align-items: center;
  }
  .h-sync-meta.stale {
    color: var(--warn);
  }
  .h-pulse-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: var(--accent-glow);
    animation: sr-pulse 1.5s ease-in-out infinite;
    display: inline-block;
    margin-right: 8px;
  }
  .h-pulse-dot.stale {
    background: var(--warn);
    box-shadow: none;
    animation: none;
  }
  @keyframes sr-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.5; transform: scale(1.25); }
  }
  @media (prefers-reduced-motion: reduce) {
    .h-pulse-dot {
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
