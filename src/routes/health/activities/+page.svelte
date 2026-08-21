<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Bars, { type Bar } from '$lib/components/trails/Bars.svelte';
  import ActivityTable from '$lib/components/health/ActivityTable.svelte';
  import type { ACWRZone } from '$lib/health/analytics/acwr';
  import { formatDistance, formatDuration } from '$lib/trails/format';

  let { data } = $props();

  const STRIP_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function shortDay(day: string): string {
    const dt = new Date(Date.parse(day + 'T00:00:00Z'));
    return `${dt.getUTCDate()} ${STRIP_MONTHS[dt.getUTCMonth()]}`;
  }

  const weekBars = $derived.by((): Bar[] => {
    return (data.strip?.weeks ?? []).map((w) => ({
      key: w.weekStart,
      tick: shortDay(w.weekStart),
      value: w.totalS,
      readout: w.totalS
        ? `${formatDuration(w.totalS)}${w.totalDistanceM ? ` · ${formatDistance(w.totalDistanceM)}` : ''}`
        : 'no workouts',
      readoutSub: `wk ${shortDay(w.weekStart)}`,
    }));
  });

  const acwr = $derived(data.strip?.strainAcwr ?? null);
  const ACWR_TONE: Record<ACWRZone, 'good' | 'warn' | 'bad'> = {
    detraining: 'warn',
    undertraining: 'warn',
    optimal: 'good',
    caution: 'warn',
    danger: 'bad',
  };

  const hasRows = $derived((data.rows?.length ?? 0) > 0);
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
        Every heading below sorts and filters, and every row carries the single best thing about
        that outing.
      </p>
    </div>
    <nav class="hdr-nav">
      <a href="/health">Dashboard</a>
      <a href="/health/segments">Segments</a>
      <a href="/health/plan">Plan</a>
      <a href="/health/routes">Routes</a>
      <a href="/health/record">Record</a>
    </nav>
  </header>

  {#if data.error}
    <div class="nm-sec nm-sec-error">
      <span class="sr-label-tight error">{data.error}</span>
    </div>
  {/if}

  {#if data.truncated}
    <div class="nm-sec nm-sec-error">
      <span class="sr-label-tight error">
        Showing the most recent {data.limit} activities only — older outings are not in this table,
        and neither are they in its totals.
      </span>
    </div>
  {/if}

  {#if data.strip && weekBars.some((b) => b.value > 0)}
    <section class="nm-sec strip">
      <div class="strip-chart">
        <Bars
          bars={weekBars}
          label="Training — last 12 weeks"
          height={110}
          formatY={(v) => `${(v / 3600).toFixed(v >= 36000 ? 0 : 1)}h`}
        />
      </div>
      <div class="strip-side">
        {#if acwr && acwr.sufficiency === 'ok'}
          <span class="sr-label-tight">Load ratio</span>
          <span class="strip-acwr">{acwr.value.ratio.toFixed(2)}</span>
          <span class="tag" class:good={ACWR_TONE[acwr.value.zone] === 'good'} class:warn={ACWR_TONE[acwr.value.zone] === 'warn'} class:bad={ACWR_TONE[acwr.value.zone] === 'bad'}>
            {acwr.value.zone.toUpperCase()}
          </span>
        {/if}
        <a class="strip-link" href="/health">Full dashboard →</a>
      </div>
    </section>
  {/if}

  {#if !hasRows}
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
    {#if data.highlightsFailed}
      <p class="degraded">
        The excellence engine did not answer, so the Excellence column is empty. Everything else on
        this page is unaffected.
      </p>
    {/if}
    <ActivityTable
      rows={data.rows}
      highlights={data.highlights}
      initialQuery={data.initialQuery}
    />
  {/if}
</main>

<style>
  .wrap {
    max-width: 1400px;
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

  .strip {
    display: flex;
    align-items: flex-end;
    gap: 1.5rem;
  }

  .strip-chart {
    flex: 1 1 auto;
    min-width: 0;
  }

  .strip-side {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.3rem;
    flex-shrink: 0;
    padding-bottom: 0.25rem;
  }

  .strip-acwr {
    font-family: var(--font-mono);
    font-size: var(--fs-num-md);
    color: var(--text-primary);
    line-height: 1.1;
  }

  .tag {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    padding: 0.15rem 0.5rem;
    border: 1px solid var(--line-strong);
    color: var(--text-secondary);
  }
  .tag.good {
    border-color: var(--success);
    color: var(--success);
  }
  .tag.warn {
    border-color: var(--warn);
    color: var(--warn);
  }
  .tag.bad {
    border-color: var(--error);
    color: var(--error);
  }

  .strip-link {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--accent);
    text-decoration: none;
    margin-top: 0.35rem;
  }
  .strip-link:hover {
    text-decoration: underline;
  }

  @media (max-width: 700px) {
    .strip {
      flex-direction: column;
      align-items: stretch;
    }
    .strip-side {
      flex-direction: row;
      align-items: baseline;
      gap: 0.6rem;
    }
  }

  .degraded {
    margin: 0 0 1rem;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.5;
    color: var(--warn);
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
</style>
