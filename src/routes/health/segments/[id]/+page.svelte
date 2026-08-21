<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import TrackMap from '$lib/components/trails/TrackMap.svelte';
  import DateLineChart from '$lib/components/trails/DateLineChart.svelte';
  import SegmentLeaderboard from '$lib/components/trails/SegmentLeaderboard.svelte';
  import FormSpark from '$lib/components/trails/FormSpark.svelte';
  import { formLabel } from '$lib/trails/segments/form';
  import { formatTemperature } from '$lib/trails/activity-meta';
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

  /**
   * The PB as it stood on each effort's day — a step line that only ever falls.
   *
   * The efficiency chart above answers "am I fitter"; this answers "when did I
   * last actually take time off this". A flat stretch of years is the honest
   * shape when nothing has beaten the record.
   */
  const pbProgression = $derived.by(() => {
    const chronological = [...segment.efforts].sort((a, b) => a.startedAt - b.startedAt);
    let best = Number.POSITIVE_INFINITY;
    const out: Array<{ date: string; value: number }> = [];
    for (const e of chronological) {
      if (!(e.durationS > 0)) continue;
      best = Math.min(best, e.durationS);
      // Two efforts on one day would make a duplicate {#each} key inside the
      // chart, which throws each_key_duplicate and blanks the page — the last
      // reading of a day wins.
      const date = e.startDateLocal.slice(0, 10);
      const prev = out[out.length - 1];
      if (prev?.date === date) prev.value = best;
      else out.push({ date, value: best });
    }
    return out;
  });

  /** Temperature against pace on this piece of ground. */
  const conditions = $derived(segment.conditions);
  const conditionsDelta = $derived(
    conditions.quickestC != null && conditions.slowestC != null
      ? Math.round((conditions.quickestC - conditions.slowestC) * 10) / 10
      : null,
  );

  /** Other ground's best EF next to this segment's best, in percent. */
  function efficiencyDeltaPct(otherEf: number | null): number | null {
    const ref = segment.bests.efficiencyFactor;
    if (otherEf == null || ref == null || !(ref > 0)) return null;
    return ((otherEf - ref) / ref) * 100;
  }

  const stats = $derived([
    { label: 'Length', value: formatDistance(segment.distanceM) },
    { label: 'Climb', value: formatElevation(segment.elevationGainM) },
    { label: 'Descent', value: formatElevation(segment.elevationLossM) },
    { label: 'Gradient', value: `${segment.gradientPct > 0 ? '+' : ''}${segment.gradientPct}%` },
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
    {
      label: 'Off the PB',
      value:
        segment.form.gapPct == null
          ? '—'
          : segment.form.gapPct === 0
            ? 'PB is recent'
            : `${(segment.form.gapPct * 100).toFixed(1)}%`,
    },
    {
      label: 'PB set',
      value: segment.form.daysSincePb == null ? '—' : `${segment.form.daysSincePb}d before last`,
    },
  ]);
</script>

<svelte:head>
  <title>{segment.name} — Health</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<PageHeader title="Strange Ramblings" />

<main class="wrap">
  <header class="page-hdr">
    <div>
      <div class="kicker">Health · Segment</div>
      <h1>{segment.name}</h1>
      <p class="sub">
        <span class="type-tag">{activityLabel(segment.activityType)}</span>
        {segment.descriptor}
      </p>
    </div>
    <a class="back-link" href="/health/segments">All segments</a>
  </header>

  <dl class="stats cellgrid">
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

  <section class="nm-sec">
    <h2 class="sec-title">Form</h2>
    <div class="form-row">
      <FormSpark form={segment.form} width={140} height={34} />
      <p class="sec-note form-note">{formLabel(segment.form)}</p>
    </div>
    <p class="sec-note">
      The median time of the last three efforts against the three before them. Medians, not means:
      one effort spent waiting at a gate is a forty-percent outlier on a short segment, and a mean
      would call that a collapse in form.
    </p>
  </section>

  {#if pbProgression.length > 2}
    <section class="nm-sec">
      <h2 class="sec-title">Personal best over time</h2>
      <p class="sec-note">
        The record as it stood on the day. It only ever falls — a long flat stretch means nothing
        has beaten it since.
      </p>
      <DateLineChart
        points={pbProgression}
        label="Best time"
        unitSuffix=" s"
        dp={0}
        colour="var(--accent-ink)"
      />
    </section>
  {/if}

  {#if conditions.sample >= 4}
    <section class="nm-sec">
      <h2 class="sec-title">Conditions</h2>
      <dl class="stats cellgrid conditions">
        <div><dt>Typical</dt><dd>{formatTemperature(conditions.meanC)}</dd></div>
        <div><dt>On the quickest</dt><dd>{formatTemperature(conditions.quickestC)}</dd></div>
        <div><dt>On the slowest</dt><dd>{formatTemperature(conditions.slowestC)}</dd></div>
        <div>
          <dt>Difference</dt>
          <dd>
            {conditionsDelta == null
              ? '—'
              : `${conditionsDelta > 0 ? '+' : ''}${conditionsDelta.toFixed(1)}°C`}
          </dd>
        </div>
      </dl>
      <p class="sec-note">
        Ambient temperature the watch recorded on the parent outing, across {conditions.sample}
        efforts that carried a reading. There is no weather history in this system — this is the
        only honest answer to what it was like that day, and three efforts a side rather than one,
        because a single quick effort on a cold morning proves nothing.
      </p>
    </section>
  {/if}

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

  {#if data.similar.byClimb.length > 0 || data.similar.byEfficiency.length > 0}
    <section class="nm-sec">
      <h2 class="sec-title">Comparable ground</h2>
      <p class="sec-note">
        Two ways to put this stretch beside the others you know. <em>Looks the same</em> is the
        nearest {activityLabel(segment.activityType).toLowerCase()} segments in gradient and length
        — if your efficiency here beats your efficiency there, that is fitness on this ground, not
        the hill being kinder. <em>Costs the same</em> is the segments whose best efficiency sits
        closest to this one's, whatever they look like on the map.
      </p>
      <div class="compare-grid">
        {#if data.similar.byClimb.length > 0}
          <div class="compare">
            <h3 class="compare-title">Looks the same</h3>
            {@render compareTable(data.similar.byClimb)}
          </div>
        {/if}
        {#if data.similar.byEfficiency.length > 0}
          <div class="compare">
            <h3 class="compare-title">Costs the same</h3>
            {@render compareTable(data.similar.byEfficiency)}
          </div>
        {/if}
      </div>
    </section>
  {/if}
</main>

{#snippet compareTable(rows: typeof data.similar.byClimb)}
  <table class="compare-table">
    <thead>
      <tr>
        <th scope="col">Segment</th>
        <th scope="col" class="num">Profile</th>
        <th scope="col" class="num" title="That segment's best efficiency factor — metres per minute per beat">
          Best effic.
        </th>
        <th scope="col" class="num" title="Its best efficiency relative to this segment's best">
          vs here
        </th>
      </tr>
    </thead>
    <tbody>
      {#each rows as entry (entry.row.id)}
        {@const other = entry.row}
        {@const delta = efficiencyDeltaPct(other.bests.efficiencyFactor)}
        <tr>
          <th scope="row">
            <a href="/health/segments/{other.id}">{other.name}</a>
          </th>
          <td class="num profile">
            {formatDistance(other.distanceM)} ·
            {other.gradientPct > 0 ? '+' : ''}{other.gradientPct}%
          </td>
          <td class="num">{other.bests.efficiencyFactor?.toFixed(2) ?? '—'}</td>
          <td class="num" class:up={delta != null && delta > 0} class:down={delta != null && delta < 0}>
            {delta == null ? '—' : `${delta > 0 ? '+' : ''}${delta.toFixed(1)}%`}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
{/snippet}

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

  /* The shared .cellgrid primitive draws the one-border-per-edge cells; this
     block only sets the columns and the tighter stat padding. */
  .stats {
    grid-template-columns: repeat(auto-fit, minmax(10.5rem, 1fr));
    margin: 0 0 2rem;
  }
  .stats > div {
    background: var(--bg);
    padding: 0.7rem 0.85rem;
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
  .sec-note em {
    font-style: normal;
    color: var(--text-primary);
  }

  .compare-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1.5rem;
  }
  @media (max-width: 860px) {
    .compare-grid {
      grid-template-columns: 1fr;
    }
  }
  .compare {
    min-width: 0;
    overflow-x: auto;
  }
  .compare-title {
    margin: 0 0 0.5rem;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--accent);
    font-weight: 500;
  }
  .compare-table {
    width: 100%;
    border-collapse: collapse;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
  }
  .compare-table th,
  .compare-table td {
    padding: 0.4rem 0.5rem;
    border-bottom: 1px solid var(--line-hair);
    text-align: left;
    white-space: nowrap;
  }
  .compare-table thead th {
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-muted);
    font-weight: 500;
    border-bottom: 1px solid var(--line-strong);
  }
  .compare-table tbody th {
    font-weight: 500;
    max-width: 12rem;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .compare-table tbody th a {
    color: var(--text-primary);
    text-decoration: none;
    border-bottom: 1px solid var(--line-hair);
  }
  .compare-table tbody th a:hover {
    border-bottom-color: var(--accent);
  }
  .compare-table .num {
    text-align: right;
  }
  .compare-table .profile {
    color: var(--text-muted);
  }
  .compare-table .up {
    color: var(--success);
  }
  .compare-table .down {
    color: var(--error);
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

  .form-row {
    display: flex;
    align-items: center;
    gap: 1.25rem;
    flex-wrap: wrap;
    margin-bottom: 0.5rem;
  }
  .form-note {
    margin: 0;
  }
  .conditions {
    grid-template-columns: repeat(4, minmax(0, 1fr));
    margin-bottom: 0.75rem;
  }
  @media (max-width: 640px) {
    .conditions {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
