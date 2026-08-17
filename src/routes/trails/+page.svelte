<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import TrackThumb from '$lib/components/trails/TrackThumb.svelte';
  import {
    formatDistance,
    formatDuration,
    formatPace,
    formatSpeed,
    formatElevation,
    formatHeartrate,
    formatLocalDate,
    activityLabel,
    isPaceSport,
  } from '$lib/trails/format';

  let { data } = $props();

  const RANGES = [
    { label: 'All', days: null },
    { label: '30d', days: 30 },
    { label: '90d', days: 90 },
    { label: '1y', days: 365 },
  ];

  function href(next: { type?: string; days?: number | null }): string {
    const type = next.type ?? data.filter.type;
    const days = next.days === undefined ? data.filter.days : next.days;
    const params = new URLSearchParams();
    if (type && type !== 'all') params.set('type', type);
    if (days) params.set('days', String(days));
    const q = params.toString();
    return q ? `/trails?${q}` : '/trails';
  }

  const hasTypes = $derived(data.types.length > 0);
</script>

<svelte:head>
  <title>Trails — Strange Ramblings</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<PageHeader title="Strange Ramblings" />

<main class="wrap">
  <header class="page-hdr">
    <div>
      <div class="kicker">Health · Trails</div>
      <h1>Trails</h1>
      <p class="sub">
        Every outdoor workout Apple Health has sent, with its GPS trace, heart rate and splits.
      </p>
    </div>
    <nav class="hdr-nav">
      <a href="/trails/plan">Plan</a>
      <a href="/trails/routes">Routes</a>
      <a href="/trails/record">Record</a>
      <a href="/health">Health</a>
    </nav>
  </header>

  {#if data.error}
    <div class="nm-sec nm-sec-error">
      <span class="sr-label-tight error">{data.error}</span>
    </div>
  {/if}

  <section class="nm-sec totals">
    <div class="stat">
      <span class="stat-value">{data.totals.count}</span>
      <span class="sr-label-tight">Activities</span>
    </div>
    <div class="stat">
      <span class="stat-value">{formatDistance(data.totals.distanceM)}</span>
      <span class="sr-label-tight">Distance</span>
    </div>
    <div class="stat">
      <span class="stat-value">{formatDuration(data.totals.durationS)}</span>
      <span class="sr-label-tight">Moving</span>
    </div>
    <div class="stat">
      <span class="stat-value">{formatElevation(data.totals.elevationGainM)}</span>
      <span class="sr-label-tight">Climbed</span>
    </div>
  </section>

  {#if hasTypes}
    <nav class="filters" aria-label="Filter activities">
      <div class="filter-row">
        <span class="sr-label-tight">Sport</span>
        <a class="chip" class:on={data.filter.type === 'all'} href={href({ type: 'all' })}>All</a>
        {#each data.types as t (t.activityType)}
          <a
            class="chip"
            class:on={data.filter.type === t.activityType}
            href={href({ type: t.activityType })}
          >
            {activityLabel(t.activityType)}
            <span class="chip-count">{t.count}</span>
          </a>
        {/each}
      </div>
      <div class="filter-row">
        <span class="sr-label-tight">Since</span>
        {#each RANGES as r (r.label)}
          <a class="chip" class:on={data.filter.days === r.days} href={href({ days: r.days })}>
            {r.label}
          </a>
        {/each}
      </div>
    </nav>
  {/if}

  {#if data.rows.length === 0}
    <section class="nm-sec empty-state">
      <p class="empty-title">Nothing here yet.</p>
      <p class="empty-body">
        Activities arrive from Health Auto Export on the phone. Enable <strong
          >Export Version 2</strong
        >
        with <strong>Include Workout Metrics</strong> and <strong>Route Data</strong>, pointed at
        <code>/api/health/apple/ingest</code>. The webhook has no retroactive push, so history
        starts from the moment it is switched on.
      </p>
    </section>
  {:else}
    <ol class="activity-list">
      {#each data.rows as row (row.id)}
        {@const pace = isPaceSport(row.activityType)}
        <li>
          <a class="activity-row" href="/trails/{encodeURIComponent(row.id)}" data-activity-row>
            <TrackThumb polyline={row.polyline} />

            <div class="row-main">
              <span class="row-name">{row.name}</span>
              <span class="row-meta">
                <span class="type-tag">{activityLabel(row.activityType)}</span>
                {formatLocalDate(row.startDateLocal, row.startDate)}
              </span>
            </div>

            <dl class="row-stats">
              <div><dt>Dist</dt><dd>{formatDistance(row.distanceM)}</dd></div>
              <div><dt>Time</dt><dd>{formatDuration(row.activeDurationS ?? row.durationS)}</dd></div>
              <div>
                <dt>{pace ? 'Pace' : 'Speed'}</dt>
                <dd>{pace ? formatPace(row.avgPaceSPerKm) : formatSpeed(row.avgPaceSPerKm)}</dd>
              </div>
              <div><dt>Climb</dt><dd>{formatElevation(row.elevationGainM)}</dd></div>
              <div><dt>HR</dt><dd>{formatHeartrate(row.avgHeartrate)}</dd></div>
            </dl>
          </a>
        </li>
      {/each}
    </ol>
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
    font-family: var(--font-display);
    font-size: 2.2rem;
    font-weight: 900;
    line-height: 1.05;
  }
  .sub {
    margin: 0.6rem 0 0;
    font-size: 0.95rem;
    line-height: 1.5;
    color: var(--text-secondary);
    max-width: 64ch;
  }
  .hdr-nav {
    display: flex;
    gap: 1rem;
    flex-shrink: 0;
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .hdr-nav a {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--accent);
    text-decoration: none;
  }
  .hdr-nav a:hover {
    text-decoration: underline;
  }

  .totals {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
    gap: 1rem;
  }

  .stat {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .stat-value {
    font-family: var(--font-mono);
    font-size: var(--fs-num-md);
    color: var(--text-primary);
    line-height: 1.1;
  }

  .filters {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    margin-bottom: 1.5rem;
  }

  .filter-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem;
  }

  .filter-row :global(.sr-label-tight) {
    margin-right: 0.35rem;
  }

  .chip {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    padding: 0.3rem 0.6rem;
    border: 1px solid var(--line-strong);
    background: transparent;
    color: var(--text-secondary);
    text-decoration: none;
  }
  .chip:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .chip.on {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg);
  }
  .chip-count {
    opacity: 0.65;
    margin-left: 0.3rem;
  }

  .activity-list {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: 1px solid var(--line-strong);
  }

  .activity-row {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.75rem 0.25rem;
    border-bottom: 1px solid var(--line-hair);
    text-decoration: none;
    color: inherit;
  }
  .activity-row:hover {
    background: var(--surface-sunken);
  }

  .row-main {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-width: 0;
    flex: 1 1 auto;
  }

  .row-name {
    font-family: var(--font-body);
    font-size: var(--fs-body);
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-meta {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }

  .type-tag {
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--accent-ink);
  }

  .row-stats {
    display: flex;
    gap: 1.1rem;
    margin: 0;
    flex-shrink: 0;
  }

  .row-stats div {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 4.2rem;
  }

  .row-stats dt {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-ghost);
  }

  .row-stats dd {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-primary);
  }

  .empty-state {
    align-items: flex-start;
  }
  .empty-title {
    margin: 0 0 0.4rem;
    font-family: var(--font-body);
    font-size: var(--fs-body-lg);
    color: var(--text-primary);
  }
  .empty-body {
    margin: 0;
    font-size: var(--fs-body-sm);
    line-height: 1.6;
    color: var(--text-secondary);
    max-width: 60ch;
  }
  .empty-body code {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    background: var(--surface-sunken);
    padding: 0.05rem 0.3rem;
  }

  /* Below the stats-row breakpoint the numbers wrap under the name rather than
     squeezing the title to nothing. */
  @media (max-width: 780px) {
    .activity-row {
      flex-wrap: wrap;
    }
    .row-stats {
      width: 100%;
      flex-wrap: wrap;
      gap: 0.75rem 1rem;
    }
  }
</style>
