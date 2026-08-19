<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import TrackThumb from '$lib/components/trails/TrackThumb.svelte';
  import { activityLabel } from '$lib/trails/format';

  let { data } = $props();

  // Plain let, not $state: this is a request handle, never read by the template
  // as reactive state — only the two flags below are.
  let rebuilding = $state(false);
  let rebuildNote = $state<string | null>(null);

  async function rebuild() {
    if (rebuilding) return;
    rebuilding = true;
    rebuildNote = null;
    try {
      const res = await fetch('/api/trails/segments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      const body = await res.json();
      if (!res.ok) {
        rebuildNote = body?.error ?? 'Rebuild failed.';
        return;
      }
      rebuildNote =
        `${body.segments} segments from ${body.activitiesConsidered} activities ` +
        `(${body.created} new, ${body.kept} kept, ${body.removed} retired) in ` +
        `${(body.elapsedMs / 1000).toFixed(1)}s. Reload to see them.`;
    } catch (err) {
      rebuildNote = (err as Error)?.message ?? 'Rebuild failed.';
    } finally {
      rebuilding = false;
    }
  }
</script>

<svelte:head>
  <title>Segments — Trails</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<PageHeader title="Strange Ramblings" />

<main class="wrap">
  <header class="page-hdr">
    <div>
      <div class="kicker">Trails · Segments</div>
      <h1>Ground you have covered twice</h1>
      <p class="sub">
        Stretches of at least 500 m that turn up in more than one outing of the same kind, matched
        wherever two traces stay within 20 m of each other. Each one gets a name and a leaderboard.
      </p>
    </div>
    <a class="back-link" href="/trails">All trails</a>
  </header>

  {#if data.error}
    <div class="nm-sec nm-sec-error"><span class="sr-label-tight error">{data.error}</span></div>
  {/if}

  {#if data.types.length > 1 || data.activeType}
    <nav class="filters">
      <a class="chip" class:on={!data.activeType} href="/trails/segments">
        All <span class="count">{data.types.reduce((n, t) => n + t.count, 0)}</span>
      </a>
      {#each data.types as type (type.activityType)}
        <a
          class="chip"
          class:on={data.activeType === type.activityType}
          href="/trails/segments?type={type.activityType}"
        >
          {activityLabel(type.activityType)} <span class="count">{type.count}</span>
        </a>
      {/each}
    </nav>
  {/if}

  {#if data.segments.length === 0}
    <section class="nm-sec">
      <p class="empty-title">No segments yet.</p>
      <p class="empty-body">
        Either nothing has been walked, run or ridden twice yet, or the segments have not been
        built. Building reads every stored GPS trace and compares it against the others.
      </p>
      <button type="button" class="rebuild" disabled={rebuilding} onclick={rebuild}>
        {rebuilding ? 'Building…' : 'Build segments'}
      </button>
      {#if rebuildNote}<p class="note">{rebuildNote}</p>{/if}
    </section>
  {:else}
    <ol class="segment-list">
      {#each data.segments as segment (segment.id)}
        <li>
          <a class="segment-row" href="/trails/segments/{segment.id}" data-segment-row>
            <TrackThumb polyline={segment.polyline} />
            <div class="row-main">
              <span class="row-name">{segment.name}</span>
              <span class="row-meta">
                <span class="type-tag">{activityLabel(segment.activityType)}</span>
                {segment.shortDescriptor}
              </span>
            </div>
            <span class="row-efforts">
              <span class="efforts-n">{segment.effortCount}</span>
              <span class="efforts-l">efforts</span>
            </span>
          </a>
        </li>
      {/each}
    </ol>

    <footer class="foot">
      <button type="button" class="rebuild" disabled={rebuilding} onclick={rebuild}>
        {rebuilding ? 'Rebuilding…' : 'Rebuild segments'}
      </button>
      <p class="foot-note">
        A rebuild recomputes everything from the stored traces. Segments that land on the same
        ground keep their name, so nothing you have learned gets renamed.
      </p>
      {#if rebuildNote}<p class="note">{rebuildNote}</p>{/if}
    </footer>
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

  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 1.5rem;
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
  .chip .count {
    opacity: 0.65;
    margin-left: 0.3rem;
  }

  .segment-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .segment-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 1rem;
    padding: 0.75rem 0.25rem;
    border-bottom: 1px solid var(--line-hair);
    text-decoration: none;
    color: inherit;
  }
  .segment-row:hover {
    background: var(--surface-sunken);
  }
  .row-main {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-width: 0;
  }
  .row-name {
    font-family: var(--font-mono);
    font-size: var(--fs-body);
    color: var(--text-primary);
    overflow-wrap: anywhere;
  }
  .row-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }
  .type-tag {
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--accent);
    margin-right: 0.5rem;
  }
  .row-efforts {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    font-family: var(--font-mono);
  }
  .efforts-n {
    font-size: var(--fs-body-lg);
    color: var(--text-primary);
  }
  .efforts-l {
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-muted);
  }

  .foot {
    margin-top: 2rem;
    padding-top: 1.25rem;
    border-top: 1px solid var(--line-hair);
  }
  .rebuild {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    padding: 0.5rem 1rem;
    color: var(--text-primary);
    background: none;
    border: 1px solid var(--line-strong);
    cursor: pointer;
  }
  .rebuild:hover:not(:disabled) {
    color: var(--accent);
    border-color: var(--accent);
  }
  .rebuild:disabled {
    opacity: 0.55;
    cursor: progress;
  }
  .foot-note,
  .note {
    margin: 0.6rem 0 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.5;
    color: var(--text-muted);
    max-width: 70ch;
  }
  .note {
    color: var(--text-secondary);
  }

  .empty-title {
    margin: 0 0 0.4rem;
    font-size: var(--fs-body-lg);
    color: var(--text-primary);
  }
  .empty-body {
    margin: 0 0 1rem;
    font-size: 0.95rem;
    line-height: 1.55;
    color: var(--text-secondary);
    max-width: 62ch;
  }

  @media (max-width: 640px) {
    .page-hdr {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.75rem;
    }
    .segment-row {
      grid-template-columns: auto minmax(0, 1fr);
    }
    .row-efforts {
      grid-column: 2;
      flex-direction: row;
      align-items: baseline;
      gap: 0.35rem;
    }
  }
</style>
