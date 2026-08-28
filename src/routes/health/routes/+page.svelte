<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import TrackThumb from '$lib/components/trails/TrackThumb.svelte';
  import { formatDistance, formatDuration, formatElevation, activityLabel } from '$lib/trails/format';

  let { data } = $props();
</script>

<svelte:head>
  <title>Saved routes — Health</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<PageHeader title="Strange Ramblings" />

<main class="wrap">
  <header class="page-hdr">
    <div>
      <div class="kicker">Health · Routes</div>
      <h1>Saved routes</h1>
      <p class="sub">Planned routes, ready to download for offline use or follow in the field.</p>
    </div>
    <a class="back-link" href="/health/plan">Plan a route</a>
  </header>

  {#if data.error}
    <div class="nm-sec nm-sec-error"><span class="sr-label-tight error">{data.error}</span></div>
  {/if}

  {#if data.routes.length === 0}
    <section class="nm-sec">
      <p class="empty-title">No saved routes yet.</p>
      <p class="empty-body">
        Plan one on <a href="/health/plan">the planner</a> and save it — it will appear here with an
        offline map download and a follow-along recorder.
      </p>
    </section>
  {:else}
    <ol class="route-list">
      {#each data.routes as route (route.id)}
        <li>
          <a class="route-row" href="/health/routes/{route.id}" data-route-row>
            <TrackThumb polyline={route.polyline} />
            <div class="row-main">
              <span class="row-name">{route.name}</span>
              <span class="row-meta">
                <span class="type-tag">{activityLabel(route.sport)}</span>
                {route.source === 'imported' ? 'imported' : 'planned'}
              </span>
            </div>
            <dl class="row-stats">
              <div><dt>Dist</dt><dd>{formatDistance(route.distanceM)}</dd></div>
              <div><dt>Climb</dt><dd>{formatElevation(route.ascentM)}</dd></div>
              <div><dt>Est</dt><dd>{formatDuration(route.durationS)}</dd></div>
              <div>
                <dt>Score</dt>
                <dd>{route.score == null ? '—' : Math.round(route.score * 100)}</dd>
              </div>
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
  .back-link {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--accent);
    text-decoration: none;
    flex-shrink: 0;
  }

  .empty-title {
    margin: 0 0 0.4rem;
    font-size: var(--fs-body-lg);
    color: var(--text-primary);
  }
  .empty-body {
    margin: 0;
    font-size: var(--fs-body-sm);
    line-height: 1.6;
    color: var(--text-secondary);
  }

  .route-list {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: 1px solid var(--line-strong);
  }
  .route-row {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.75rem 0.25rem;
    border-bottom: 1px solid var(--line-hair);
    text-decoration: none;
    color: inherit;
  }
  .route-row:hover {
    background: var(--surface-sunken);
  }
  .row-main {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    flex: 1 1 auto;
    min-width: 0;
  }
  .row-name {
    font-size: var(--fs-body);
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row-meta {
    display: flex;
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
    min-width: 4rem;
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

  @media (max-width: 780px) {
    .route-row {
      flex-wrap: wrap;
    }
    .row-stats {
      width: 100%;
      flex-wrap: wrap;
      gap: 0.75rem 1rem;
    }
  }
</style>
