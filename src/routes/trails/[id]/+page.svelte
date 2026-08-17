<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import TrackMap from '$lib/components/trails/TrackMap.svelte';
  import LineChart from '$lib/components/trails/LineChart.svelte';
  import SplitsTable from '$lib/components/trails/SplitsTable.svelte';
  import {
    formatDistance,
    formatDuration,
    formatPace,
    formatSpeed,
    formatElevation,
    formatHeartrate,
    formatEnergy,
    formatLocalDate,
    activityLabel,
    isPaceSport,
  } from '$lib/trails/format';

  let { data } = $props();

  const a = $derived(data.activity);
  const pace = $derived(isPaceSport(a.activityType));

  const elevationPoints = $derived(
    a.elevation.map((p) => [p.distanceM, p.elevationM] as [number, number]),
  );

  const heartRate = $derived(a.series.find((s) => s.metric === 'heart_rate') ?? null);
  const cadence = $derived(a.series.find((s) => s.metric === 'cadence') ?? null);

  const stats = $derived([
    { label: 'Distance', value: formatDistance(a.distanceM) },
    { label: 'Moving', value: formatDuration(a.activeDurationS ?? a.durationS) },
    {
      label: pace ? 'Avg pace' : 'Avg speed',
      value: pace ? formatPace(a.avgPaceSPerKm) : formatSpeed(a.avgPaceSPerKm),
    },
    { label: 'Climb', value: formatElevation(a.elevationGainM) },
    { label: 'Descent', value: formatElevation(a.elevationLossM) },
    { label: 'Avg HR', value: formatHeartrate(a.avgHeartrate) },
    { label: 'Max HR', value: formatHeartrate(a.maxHeartrate) },
    { label: 'Energy', value: formatEnergy(a.activeEnergyKj) },
  ]);
</script>

<svelte:head>
  <title>{a.name} — Trails</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<PageHeader title="Strange Ramblings" />

<main class="wrap">
  <header class="page-hdr">
    <div>
      <div class="kicker">Trails · {activityLabel(a.activityType)}</div>
      <h1>{a.name}</h1>
      <p class="sub">{formatLocalDate(a.startDateLocal, a.startDate)}</p>
    </div>
    <a class="back-link" href="/trails">All trails</a>
  </header>

  <section class="nm-sec stat-grid">
    {#each stats as s (s.label)}
      <div class="stat">
        <span class="stat-value">{s.value}</span>
        <span class="sr-label-tight">{s.label}</span>
      </div>
    {/each}
  </section>

  {#if a.coordinates && a.coordinates.length > 1}
    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">Route</span>
        <span class="nm-sec-meta">{a.coordinates.length} points</span>
      </div>
      <TrackMap coordinates={a.coordinates} bounds={a.bounds} colourBy="pace" height="440px" />
    </section>
  {/if}

  {#if elevationPoints.length > 1 || heartRate || cadence}
    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">Traces</span>
      </div>

      {#if elevationPoints.length > 1}
        <LineChart
          points={elevationPoints}
          label="Elevation"
          unitSuffix=" m"
          xKind="distance"
          fill
          colour="var(--accent-ink)"
        />
      {/if}

      {#if heartRate}
        <LineChart
          points={heartRate.samples}
          label="Heart rate"
          unitSuffix=" bpm"
          xKind="time"
          colour="var(--accent)"
        />
      {/if}

      {#if cadence}
        <LineChart
          points={cadence.samples}
          label="Cadence"
          unitSuffix=" spm"
          xKind="time"
          colour="var(--text-secondary)"
        />
      {/if}
    </section>
  {/if}

  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Splits</span>
      <span class="nm-sec-meta">per kilometre</span>
    </div>
    <SplitsTable splits={a.splits} paceSport={pace} />
  </section>

  <section class="nm-sec provenance">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Provenance</span>
    </div>
    <dl class="prov-list">
      <div><dt>Source</dt><dd>{a.source}</dd></div>
      <div><dt>Reported as</dt><dd>{a.rawType ?? '—'}</dd></div>
      <div><dt>Local offset</dt><dd>{a.timezone ?? '—'}</dd></div>
      <div><dt>GPS trace</dt><dd>{a.hasTrack ? 'yes' : 'no'}</dd></div>
    </dl>
  </section>
</main>

<style>
  .wrap {
    max-width: 1100px;
    margin: 0 auto;
    padding: 2rem 1.5rem 4rem;
  }

  .page-hdr {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 1.5rem;
    margin-bottom: 1.75rem;
    padding-bottom: 1rem;
    border-bottom: 2px solid var(--text-primary);
  }
  .kicker {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: var(--accent);
    margin-bottom: 0.35rem;
  }
  .page-hdr h1 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 2.2rem;
    font-weight: 900;
    line-height: 1.05;
  }
  .sub {
    margin: 0.6rem 0 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-secondary);
  }
  .back-link {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--accent);
    text-decoration: none;
    flex-shrink: 0;
  }
  .back-link:hover {
    text-decoration: underline;
  }

  /* Fixed column count rather than auto-fit: eight stats against an auto-fit
     track fits seven on a row and orphans the eighth. Four-up divides evenly. */
  .stat-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 1rem 1.25rem;
  }

  @media (max-width: 700px) {
    .stat-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  .stat {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    /* minmax(0, …) on the track is not enough on its own: a grid item's default
       min-width is auto, so a long value would push the column instead of
       wrapping inside it. */
    min-width: 0;
  }

  .stat-value {
    font-family: var(--font-mono);
    font-size: var(--fs-num-md);
    color: var(--text-primary);
    line-height: 1.1;
  }

  .prov-list {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
    gap: 0.75rem;
    margin: 0;
  }

  .prov-list div {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }

  .prov-list dt {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-ghost);
  }

  .prov-list dd {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-primary);
    overflow-wrap: anywhere;
  }
</style>
