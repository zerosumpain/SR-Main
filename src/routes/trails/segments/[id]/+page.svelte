<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import TrackMap from '$lib/components/trails/TrackMap.svelte';
  import DateLineChart from '$lib/components/trails/DateLineChart.svelte';
  import SegmentLeaderboard from '$lib/components/trails/SegmentLeaderboard.svelte';
  import {
    formatDistance,
    formatDuration,
    formatElevation,
    formatPace,
    formatSpeed,
    activityLabel,
    isPaceSport,
  } from '$lib/trails/format';

  let { data } = $props();

  const segment = $derived(data.segment);
  const pace = $derived(isPaceSport(segment.activityType));

  const best = $derived.by(() => {
    const efforts = segment.efforts;
    if (!efforts.length) return null;
    const ranked = (read: (e: (typeof efforts)[number]) => number | null, dir: 1 | -1) =>
      efforts
        .filter((e) => read(e) != null)
        .sort((a, b) => ((read(a) as number) - (read(b) as number)) * dir)[0] ?? null;
    return {
      fastest: ranked((e) => e.durationS, 1),
      efficient: ranked((e) => e.efficiencyFactor, -1),
      cheapest: ranked((e) => e.beatsPerKm, 1),
    };
  });

  /** Efficiency against the calendar — the trend the whole exercise is for. */
  const efficiencyTrend = $derived(
    segment.efforts
      .filter((e) => e.efficiencyFactor != null)
      .map((e) => ({ date: e.startDateLocal.slice(0, 10), value: e.efficiencyFactor as number }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  );

  const stats = $derived([
    { label: 'Length', value: formatDistance(segment.distanceM) },
    { label: 'Climb', value: formatElevation(segment.elevationGainM) },
    { label: 'Descent', value: formatElevation(segment.elevationLossM) },
    { label: 'Efforts', value: String(segment.effortCount) },
    {
      label: 'Best time',
      value: best?.fastest ? formatDuration(best.fastest.durationS) : '—',
    },
    {
      label: pace ? 'Best pace' : 'Best speed',
      value: best?.fastest
        ? pace
          ? formatPace(best.fastest.paceSPerKm)
          : formatSpeed(best.fastest.paceSPerKm)
        : '—',
    },
    {
      label: 'Best efficiency',
      value: best?.efficient?.efficiencyFactor?.toFixed(2) ?? '—',
    },
    {
      label: 'Lowest cost',
      value: best?.cheapest?.beatsPerKm ? `${Math.round(best.cheapest.beatsPerKm)} b/km` : '—',
    },
  ]);
</script>

<svelte:head>
  <title>{segment.name} — Segments</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<PageHeader title="Strange Ramblings" />

<main class="wrap">
  <header class="page-hdr">
    <div>
      <div class="kicker">Trails · Segment</div>
      <h1>{segment.name}</h1>
      <p class="sub">
        <span class="type-tag">{activityLabel(segment.activityType)}</span>
        {segment.descriptor}
      </p>
    </div>
    <a class="back-link" href="/trails/segments">All segments</a>
  </header>

  <dl class="stats">
    {#each stats as stat (stat.label)}
      <div><dt>{stat.label}</dt><dd>{stat.value}</dd></div>
    {/each}
  </dl>

  {#if segment.coordinates.length > 1}
    <section class="nm-sec">
      <h2 class="sec-title">The ground</h2>
      <TrackMap coordinates={segment.coordinates} bounds={segment.bounds} height="360px" />
    </section>
  {/if}

  <section class="nm-sec">
    <h2 class="sec-title">Every effort</h2>
    <SegmentLeaderboard efforts={segment.efforts} paceSport={pace} />
  </section>

  {#if efficiencyTrend.length > 2}
    <section class="nm-sec">
      <h2 class="sec-title">Efficiency over time</h2>
      <p class="sec-note">
        Metres per minute per beat, each effort on its own date. Rising means you are covering this
        same ground for fewer heartbeats than you used to.
      </p>
      <DateLineChart points={efficiencyTrend} label="Efficiency" dp={2} />
    </section>
  {/if}
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
    font-family: var(--font-mono);
    font-size: 2rem;
    font-weight: 500;
    line-height: 1.1;
    overflow-wrap: anywhere;
  }
  .sub {
    margin: 0.6rem 0 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-secondary);
  }
  .type-tag {
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--accent);
    margin-right: 0.5rem;
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

  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(10.5rem, 1fr));
    gap: 1px;
    margin: 0 0 2rem;
    background: var(--line-hair);
    border: 1px solid var(--line-hair);
  }
  .stats > div {
    background: var(--bg);
    padding: 0.7rem 0.85rem;
    min-width: 0;
  }
  .stats dt {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-muted);
  }
  .stats dd {
    margin: 0.25rem 0 0;
    font-family: var(--font-mono);
    font-size: var(--fs-body-lg);
    color: var(--text-primary);
  }

  .nm-sec {
    margin-bottom: 2rem;
  }
  .sec-title {
    margin: 0 0 0.75rem;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-muted);
    font-weight: 500;
  }
  .sec-note {
    margin: 0 0 0.9rem;
    font-size: 0.9rem;
    line-height: 1.55;
    color: var(--text-secondary);
    max-width: 68ch;
  }

  @media (max-width: 640px) {
    .page-hdr {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.75rem;
    }
    .page-hdr h1 {
      font-size: 1.5rem;
    }
  }
</style>
