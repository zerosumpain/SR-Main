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
  import GroundDashboard from '$lib/components/health/GroundDashboard.svelte';
  import CoachCard from '$lib/components/health/CoachCard.svelte';
  import HighlightBadge from '$lib/components/health/HighlightBadge.svelte';
  import TrackThumb from '$lib/components/trails/TrackThumb.svelte';
  import { fmtAgo } from '$lib/components/health/v2/utils';
  import { formatDistance, formatDuration, formatLocalDate, activityLabel } from '$lib/trails/format';
  import { formatTemperature } from '$lib/trails/activity-meta';

  let { data } = $props();

  // One page, two audiences. `data.mode` is decided server-side and the two
  // payloads have no overlap beyond the aggregate body metrics — an anonymous
  // visitor is never SENT the ground data, so there is nothing here to hide.
  const owner = $derived(data.mode === 'owner' ? data : null);

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
  const hasSeries = $derived((data.series?.length ?? 0) > 0);

  const showToday = $derived(!!owner?.coach);
  const showOutings = $derived((owner?.outings?.length ?? 0) > 0);
  const showGround = $derived(!!owner?.dashboard);
  const showTraining = $derived(
    !!owner &&
      ((!!owner.trainingLoad && !(owner.trainingLoad.acute === 0 && owner.trainingLoad.chronic === 0)) ||
        // getMonotony() can never report "insufficient" — the service zero-fills
        // seven calendar days before computing, so sufficiency is always 'ok'
        // even against an empty database. The mean and sd are the real guard.
        (suff(owner.monotony) && (owner.monotony?.value?.mean ?? 0) > 0 && (owner.monotony?.value?.sd ?? 0) > 0) ||
        suff(owner.polarised)),
  );
  const showRecovery = $derived(!!owner && (suff(owner.recoveryDebt) || suff(owner.autonomic)));
  const showBreakdown = $derived(!!owner && !!data.today && !!data.yesterday && !!data.rings);
  const showSleepRhythm = $derived(!!owner && (suff(owner.sleepRegularity) || suff(owner.circadian)));
  const showFitness = $derived(
    suff(data.vo2max) ||
      (!!data.stats?.weekly &&
        (data.stats.weekly.activities > 0 ||
          (data.stats.personalRecords?.length ?? 0) > 0 ||
          data.stats.weekly.avgRecovery > 0)),
  );
  const showCorrelations = $derived((owner?.correlations?.length ?? 0) > 0);
  const showFeatured = $derived((data.featuredActivities?.length ?? 0) > 0);
  const showNarrative = $derived(!!data.narrative);

  // Eyebrow numbers used to be hard-coded 01–10 against conditional sections, so
  // a thin data day printed 01, 02, 05, 06, 09 with visible gaps. They are
  // derived from what is actually on the page now.
  const order = $derived.by(() => {
    const keys: string[] = [];
    if (showToday) keys.push('today');
    keys.push('signals');
    if (hasSeries) keys.push('pulse');
    if (showOutings) keys.push('outings');
    if (showGround) keys.push('ground');
    if (showTraining) keys.push('training');
    if (showRecovery) keys.push('recovery');
    if (showBreakdown) keys.push('breakdown');
    if (showSleepRhythm) keys.push('sleep');
    if (showFitness) keys.push('fitness');
    if (showCorrelations) keys.push('correlations');
    if (showNarrative) keys.push('narrative');
    if (showFeatured) keys.push('featured');
    return keys;
  });
  const num = $derived((key: string) => {
    const i = order.indexOf(key);
    return i < 0 ? '' : String(i + 1).padStart(2, '0');
  });

  // The public headline row: aggregates only, and every one of them says where
  // it came from. "No data" and "exactly average" are otherwise the same number.
  type Signal = { label: string; value: string; unit: string; note: string };
  const signals = $derived.by((): Signal[] => {
    const out: Signal[] = [];
    if (data.readiness) {
      out.push({
        label: 'Readiness',
        value: String(Math.round(data.readiness.score)),
        unit: '/100',
        note: data.readiness.label ?? '',
      });
    }
    if (suff(data.vo2max) && data.vo2max && data.vo2max.value.current > 0) {
      out.push({
        label: 'Cardio fitness',
        value: data.vo2max.value.current.toFixed(1),
        unit: 'ml/kg/min',
        note: `${data.vo2max.value.band} · ${Math.round(data.vo2max.value.percentile)}th percentile`,
      });
    }
    if (data.trainingLoad && !(data.trainingLoad.acute === 0 && data.trainingLoad.chronic === 0)) {
      out.push({
        label: 'Load ratio',
        value: data.trainingLoad.ratio.toFixed(2),
        unit: 'acute:chronic',
        note: data.trainingLoad.zone ?? '',
      });
    }
    if (suff(data.sleepRegularity) && typeof data.sleepRegularity?.value === 'number') {
      out.push({
        label: 'Sleep regularity',
        value: String(Math.round(data.sleepRegularity.value)),
        unit: 'SRI',
        note: 'higher is steadier',
      });
    }
    if (data.stats?.weekly) {
      out.push({
        label: 'This week',
        value: String(data.stats.weekly.activities),
        unit: data.stats.weekly.activities === 1 ? 'session' : 'sessions',
        note: data.stats.weekly.avgRecovery > 0 ? `${Math.round(data.stats.weekly.avgRecovery)}% avg recovery` : '',
      });
    }
    if (data.rhrBaseline > 0 && data.today) {
      out.push({
        label: 'Resting HR',
        value: String(Math.round(data.today.rhr || data.rhrBaseline)),
        unit: 'bpm',
        note: `${Math.round(data.rhrBaseline)} bpm baseline`,
      });
    }
    return out;
  });
</script>

<svelte:head>
  <title>Health — Strange Ramblings</title>
  <meta
    name="description"
    content="Live health dashboard — readiness, training load, cardio fitness, sleep regularity, and thirty days of body signals."
  />
  <meta property="og:title" content="Health — Strange Ramblings" />
  <meta
    property="og:description"
    content="Live health dashboard — readiness, training load, cardio fitness, sleep regularity, and thirty days of body signals."
  />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://strangeramblings.com/health" />
  {#if owner}
    <!-- The signed-in hub carries outings, segments and ground. Never indexed. -->
    <meta name="robots" content="noindex" />
  {/if}
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

  {#if owner}
    <nav class="h-hubnav" aria-label="Health sections">
      <a href="/health/activities">Activities</a>
      <a href="/health/segments">Segments</a>
      <a href="/health/plan">Plan</a>
      <a href="/health/routes">Routes</a>
      <a href="/health/record">Record</a>
    </nav>
  {/if}

  {#if data.provenance?.seriesIsMock}
    <!--
      With no real day in the window the series service substitutes a complete,
      deterministic fake so the page still renders during a cold start. It is
      plausible and, until now, indistinguishable from measurement. Say so.
    -->
    <p class="h-provenance">
      Sample data — no readings have synced into this window yet. Nothing below is a measurement.
    </p>
  {/if}

  {#if data.today && data.headline && data.todayDeltas && data.readiness}
    <Hero
      today={data.today}
      headline={data.headline}
      strap={data.strap}
      todayDeltas={data.todayDeltas}
      rhrBaseline={data.rhrBaseline}
      readiness={data.readiness}
      onevidence={openEvidence}
    />
  {/if}

  {#if showToday && owner?.coach}
    <section class="h-section">
      <div class="h-section-inner">
        <div class="h-section-head">
          <div>
            <p class="h-section-num">{num('today')} / TODAY · THE SESSION</p>
            <h2 class="h-section-title">WHAT TO DO ABOUT IT</h2>
          </div>
          <p class="h-section-strap">
            One session, chosen from the load you are actually carrying, and the ground worth taking it to.
          </p>
        </div>
        <CoachCard plan={owner.coach} />
      </div>
    </section>
  {/if}

  <section class="h-section tinted">
    <div class="h-section-inner">
      <div class="h-section-head">
        <div>
          <p class="h-section-num">{num('signals')} / SIGNALS</p>
          <h2 class="h-section-title">WHERE THE BODY IS</h2>
        </div>
        <p class="h-section-strap">
          The short version. Every figure is an aggregate; the detail is below.
        </p>
      </div>
      {#if signals.length}
        <div class="cellgrid h-signals">
          {#each signals as s (s.label)}
            <div class="h-signal">
              <p class="h-signal-value">{s.value}<span class="h-signal-unit">{s.unit}</span></p>
              <p class="h-signal-label">{s.label}</p>
              {#if s.note}<p class="h-signal-note">{s.note}</p>{/if}
            </div>
          {/each}
        </div>
      {:else}
        <p class="h-empty">Nothing has synced recently enough to read.</p>
      {/if}
    </div>
  </section>

  {#if hasSeries}
    <section class="h-section">
      <div class="h-section-inner">
        <div class="h-section-head">
          <div>
            <p class="h-section-num">{num('pulse')} / 30 DAYS · ALL METRICS</p>
            <h2 class="h-section-title">THE PULSE GRID</h2>
          </div>
          <p class="h-section-strap">
            Every cell is a day, coloured against that row's own baseline. Cool is better than usual.
          </p>
        </div>
        <PulseGrid series={data.series} />
        {#if data.annotations?.length}
          <div class="h-annot-grid">
            {#each data.annotations as annot, i (i)}
              <div class="h-annot">
                <p class="h-annot-when">{annot.when}</p>
                <!-- Built server-side from numeric fields in computeAnnotations. -->
                <p class="h-annot-text">{@html annot.text}</p>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </section>
  {/if}

  {#if showOutings && owner}
    <section class="h-section tinted">
      <div class="h-section-inner">
        <div class="h-section-head">
          <div>
            <p class="h-section-num">{num('outings')} / RECENT · WHAT WAS GOOD ABOUT IT</p>
            <h2 class="h-section-title">THE LAST FIVE</h2>
          </div>
          <p class="h-section-strap">
            Every outing has something true to say for itself. <a href="/health/activities">All of them →</a>
          </p>
        </div>
        <ul class="h-outings">
          {#each owner.outings as o (o.id)}
            <li>
              <a class="h-outing" href="/health/activities/{encodeURIComponent(o.id)}" data-activity-row>
                <TrackThumb polyline={o.polyline} size={44} />
                <span class="h-outing-main">
                  <span class="h-outing-name">{o.name}</span>
                  <span class="h-outing-meta">
                    {activityLabel(o.activityType)} · {formatLocalDate(o.startDateLocal, o.startDate)}
                    {#if o.temperatureC != null} · {formatTemperature(o.temperatureC)}{/if}
                    {#if o.segmentCount > 0} · {o.segmentCount} segment{o.segmentCount === 1 ? '' : 's'}{/if}
                  </span>
                </span>
                <span class="h-outing-stats">
                  <span>{formatDistance(o.distanceM)}</span>
                  <span>{formatDuration(o.durationS)}</span>
                </span>
                {#if o.highlight}
                  <span class="h-outing-badge"><HighlightBadge highlight={o.highlight} size="sm" /></span>
                {/if}
              </a>
            </li>
          {/each}
        </ul>
      </div>
    </section>
  {/if}

  {#if showGround && owner}
    <section class="h-section">
      <div class="h-section-inner">
        <div class="h-section-head">
          <div>
            <p class="h-section-num">{num('ground')} / THE GROUND · PHYSIOLOGY</p>
            <h2 class="h-section-title">WHAT THE OUTINGS DID</h2>
          </div>
          <p class="h-section-strap">
            Progression from the workouts themselves — efficiency, cost, load and the segments they crossed.
          </p>
        </div>
        <GroundDashboard dashboard={owner.dashboard} segments={owner.segments} />
      </div>
    </section>
  {/if}

  {#if showTraining && owner}
    <section class="h-section tinted">
      <div class="h-section-inner">
        <div class="h-section-head">
          <div>
            <p class="h-section-num">{num('training')} / LOAD · INJURY RISK</p>
            <h2 class="h-section-title">ARE YOU OVERREACHING?</h2>
          </div>
          <p class="h-section-strap">
            Acute load vs your chronic base. The sweet spot keeps you building without breaking.
          </p>
        </div>
        <TrainingLoad
          trainingLoad={owner.trainingLoad}
          monotony={owner.monotony}
          polarised={owner.polarised}
          onevidence={openEvidence}
        />
      </div>
    </section>
  {/if}

  {#if showRecovery && owner}
    <section class="h-section">
      <div class="h-section-inner">
        <div class="h-section-head">
          <div>
            <p class="h-section-num">{num('recovery')} / RECOVERY · AUTONOMIC</p>
            <h2 class="h-section-title">HOW DEEP IS THE HOLE?</h2>
          </div>
          <p class="h-section-strap">
            Cumulative sleep debt and where your nervous system sits against its own baseline.
          </p>
        </div>
        <RecoverySignals
          recoveryDebt={owner.recoveryDebt}
          autonomic={owner.autonomic}
          onevidence={openEvidence}
        />
      </div>
    </section>
  {/if}

  {#if owner && data.today && data.yesterday && data.rings}
    <section class="h-section tinted">
      <div class="h-section-inner">
        <div class="h-section-head">
          <div>
            <p class="h-section-num">{num('breakdown')} / METRICS · TODAY &amp; 30D</p>
            <h2 class="h-section-title">THE BREAKDOWN</h2>
          </div>
          <p class="h-section-strap">Each card: a number, a sparkline, and what to do about it.</p>
        </div>
        <Breakdown
          series={data.series}
          today={data.today}
          yesterday={data.yesterday}
          workouts={owner.workouts}
          rhrBaseline={data.rhrBaseline}
          rings={data.rings}
        />
      </div>
    </section>
  {/if}

  {#if showSleepRhythm && owner}
    <section class="h-section">
      <div class="h-section-inner">
        <div class="h-section-head">
          <div>
            <p class="h-section-num">{num('sleep')} / SLEEP · RHYTHM</p>
            <h2 class="h-section-title">IS YOUR CLOCK STEADY?</h2>
          </div>
          <p class="h-section-strap">
            Duration is only half of sleep. Regularity and timing are the other half.
          </p>
        </div>
        <SleepConsistency
          sleepRegularity={owner.sleepRegularity}
          circadian={owner.circadian}
          onevidence={openEvidence}
        />
      </div>
    </section>
  {/if}

  {#if showFitness}
    <section class="h-section tinted">
      <div class="h-section-inner">
        <div class="h-section-head">
          <div>
            <p class="h-section-num">{num('fitness')} / FITNESS · RECORDS</p>
            <h2 class="h-section-title">THE LONG GAME</h2>
          </div>
          <p class="h-section-strap">
            Cardio fitness against the population, the week's volume, and the all-time bests.
          </p>
        </div>
        <Fitness vo2max={data.vo2max} stats={data.stats} onevidence={openEvidence} />
      </div>
    </section>
  {/if}

  {#if showCorrelations && owner}
    <section class="h-section">
      <div class="h-section-inner">
        <div class="h-section-head">
          <div>
            <p class="h-section-num">{num('correlations')} / CORRELATIONS · LIGHTLY SCIENTIFIC</p>
            <h2 class="h-section-title">WHAT MOVES WHAT</h2>
          </div>
          <p class="h-section-strap">
            N is small. Take with a pinch of salt and a glass of water.
          </p>
        </div>
        <Correlations items={owner.correlations} />
      </div>
    </section>
  {/if}

  {#if showNarrative && data.narrative}
    <section class="h-section tinted">
      <div class="h-section-inner">
        <p class="h-section-num">{num('narrative')} / NARRATIVE</p>
        <Narrative narrative={data.narrative} />
        {#if data.narrative.stats}
          <div class="h-week-wrap">
            <WeekInNumbers stats={data.narrative.stats} />
          </div>
        {/if}
      </div>
    </section>
  {/if}

  {#if showFeatured}
    <section class="h-section">
      <div class="h-section-inner">
        <div class="h-section-head">
          <div>
            <p class="h-section-num">{num('featured')} / FIELD NOTES · GPS TRACES</p>
            <h2 class="h-section-title">EPIC ACTIVITIES</h2>
          </div>
          <p class="h-section-strap">
            The days that earned a name. Chosen by hand; everything else stays private.
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

  .h-hubnav {
    display: flex;
    gap: 0;
    flex-wrap: wrap;
    border-bottom: 1px solid var(--line-hair);
    background: var(--surface-rail);
    padding: 0 32px;
  }
  .h-hubnav a {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--text-muted);
    text-decoration: none;
    padding: 12px 16px;
    border-right: 1px solid var(--line-hair);
  }
  .h-hubnav a:first-child {
    border-left: 1px solid var(--line-hair);
  }
  .h-hubnav a:hover {
    color: var(--accent);
    background: var(--accent-tint-04);
  }

  .h-provenance {
    margin: 0;
    padding: 10px 32px;
    background: var(--warn-bg);
    border-bottom: 1px solid var(--warn-border);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--warn);
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
  .h-section-strap a {
    color: var(--accent);
  }
  .h-section-num {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.15em;
    color: var(--text-ghost);
    margin: 0 0 8px 0;
    text-transform: uppercase;
  }

  /* Signals — the shared .cellgrid primitive sets the hairlines; this only
     picks the column count, and every child sets min-width: 0 so a narrow
     column cannot collapse the track to zero. */
  .h-signals {
    grid-template-columns: repeat(6, minmax(0, 1fr));
  }
  @media (max-width: 1100px) {
    .h-signals {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
  .h-signal {
    min-width: 0;
    padding: 18px 16px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .h-signal-value {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: var(--fs-num-md);
    letter-spacing: -0.02em;
    color: var(--text-primary);
    margin: 0;
    line-height: 1;
  }
  .h-signal-unit {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    color: var(--text-ghost);
    margin-left: 6px;
    text-transform: none;
  }
  .h-signal-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--text-secondary);
    margin: 0;
  }
  .h-signal-note {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    color: var(--text-ghost);
    margin: 0;
  }

  .h-empty {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-ghost);
    margin: 0;
  }

  .h-outings {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: 1px solid var(--line);
  }
  .h-outing {
    display: grid;
    grid-template-columns: 44px minmax(0, 1fr) auto minmax(0, 260px);
    align-items: center;
    gap: 16px;
    padding: 12px 8px;
    border-bottom: 1px solid var(--line-hair);
    text-decoration: none;
    color: inherit;
  }
  .h-outing:hover {
    background: var(--accent-tint-04);
  }
  .h-outing-main {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .h-outing-name {
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .h-outing-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    color: var(--text-ghost);
  }
  .h-outing-stats {
    display: flex;
    gap: 14px;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-secondary);
  }
  .h-outing-badge {
    min-width: 0;
    justify-self: end;
  }
  @media (max-width: 900px) {
    .h-outing {
      grid-template-columns: 44px minmax(0, 1fr);
      row-gap: 8px;
    }
    .h-outing-stats,
    .h-outing-badge {
      grid-column: 2;
      justify-self: start;
    }
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
    transition:
      color 0.18s,
      border-color 0.18s;
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
    0%,
    100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.5;
      transform: scale(1.25);
    }
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
    .h-hubnav,
    .h-provenance {
      padding-left: 16px;
      padding-right: 16px;
    }
  }
</style>
