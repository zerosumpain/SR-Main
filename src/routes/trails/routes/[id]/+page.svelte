<script lang="ts">
  import { goto } from '$app/navigation';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import TrackMap from '$lib/components/trails/TrackMap.svelte';
  import LineChart from '$lib/components/trails/LineChart.svelte';
  import OfflineDownload from '$lib/components/trails/OfflineDownload.svelte';
  import {
    formatDistance,
    formatDuration,
    formatElevation,
    activityLabel,
  } from '$lib/trails/format';
  import { estimateTimeS } from '$lib/trails/field/nav';
  import type { TrackPoint } from '$lib/trails/track';
  import type { Coord } from '$lib/trails/scoring';

  let { data } = $props();

  const r = $derived(data.route);
  let deleting = $state(false);

  // The map component wants the 4-tuple track shape; a planned route has no
  // timestamps, so the time slot is zero throughout.
  const trackPoints = $derived(
    (r.coordinates as Coord[]).map(
      ([lng, lat, ele]) => [lng, lat, ele ?? null, 0] as TrackPoint,
    ),
  );

  const elevationPoints = $derived.by(() => {
    const coords = r.coordinates as Coord[];
    const out: [number, number][] = [];
    let d = 0;
    const R = 6371008.8;
    for (let i = 0; i < coords.length; i++) {
      if (i > 0) {
        const [lng0, lat0] = coords[i - 1];
        const [lng1, lat1] = coords[i];
        const dLat = ((lat1 - lat0) * Math.PI) / 180;
        const dLng = ((lng1 - lng0) * Math.PI) / 180;
        const x = dLng * Math.cos((((lat0 + lat1) / 2) * Math.PI) / 180);
        d += Math.sqrt(x * x + dLat * dLat) * R;
      }
      const ele = coords[i][2];
      if (typeof ele === 'number') out.push([d, ele]);
    }
    return out;
  });

  const ourEstimate = $derived(estimateTimeS(r.distanceM, r.ascentM ?? 0, r.sport));

  async function remove() {
    if (!confirm(`Delete "${r.name}"? This cannot be undone.`)) return;
    deleting = true;
    const res = await fetch(`/api/trails/routes/${r.id}`, { method: 'DELETE' });
    if (res.ok) await goto('/trails/routes');
    else deleting = false;
  }
</script>

<svelte:head>
  <title>{r.name} — Routes</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<PageHeader title="Strange Ramblings" />

<main class="wrap">
  <header class="page-hdr">
    <div>
      <div class="kicker">Route · {activityLabel(r.sport)}</div>
      <h1>{r.name}</h1>
      <p class="sub">{r.source === 'imported' ? 'Imported' : 'Planned'} route</p>
    </div>
    <a class="back-link" href="/trails/routes">All routes</a>
  </header>

  <section class="nm-sec stat-grid">
    <div class="stat">
      <span class="stat-value">{formatDistance(r.distanceM)}</span>
      <span class="sr-label-tight">Distance</span>
    </div>
    <div class="stat">
      <span class="stat-value">{formatElevation(r.ascentM)}</span>
      <span class="sr-label-tight">Climb</span>
    </div>
    <div class="stat">
      <span class="stat-value">{formatDuration(r.durationS ?? ourEstimate)}</span>
      <span class="sr-label-tight">{r.durationS ? 'Router est.' : 'Naismith est.'}</span>
    </div>
    <div class="stat">
      <span class="stat-value">{r.score == null ? '—' : Math.round(r.score * 100)}</span>
      <span class="sr-label-tight">Score</span>
    </div>
  </section>

  {#if r.scoreBreakdown}
    {@const b = r.scoreBreakdown}
    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">Why it scored that</span>
      </div>
      <dl class="breakdown">
        <div><dt>Retraced</dt><dd>{Math.round(b.overlap.ratio * 100)}%</dd></div>
        <div><dt>Out-and-back</dt><dd>{b.spurs.spurs.length}</dd></div>
        <div><dt>Longest spur</dt><dd>{Math.round(b.spurs.longestM)} m</dd></div>
        <div><dt>Off-road</dt><dd>{Math.round(b.terrain.offRoadShare * 100)}%</dd></div>
        <div><dt>Main road</dt><dd>{Math.round(b.terrain.mainRoadShare * 100)}%</dd></div>
        <div><dt>Climb/km</dt><dd>{Math.round(b.profile.gainPerKm)} m</dd></div>
      </dl>
      {#if b.notes?.length}
        <ul class="notes">
          {#each b.notes as note (note)}<li>{note}</li>{/each}
        </ul>
      {/if}
    </section>
  {/if}

  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Route</span>
      <span class="nm-sec-meta">{r.coordinates.length} points</span>
    </div>
    <TrackMap coordinates={trackPoints} bounds={r.bounds} height="440px" offline />
  </section>

  {#if elevationPoints.length > 1}
    <section class="nm-sec">
      <div class="nm-sec-hd"><span class="sr-label-tight">Profile</span></div>
      <LineChart
        points={elevationPoints}
        label="Elevation"
        unitSuffix=" m"
        xKind="distance"
        fill
        colour="var(--accent-ink)"
      />
    </section>
  {/if}

  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Offline map</span>
      <span class="nm-sec-meta">stored on this device</span>
    </div>
    <OfflineDownload routeId={r.id} routeName={r.name} bounds={r.bounds} />
  </section>

  <section class="nm-sec">
    <div class="nm-sec-hd"><span class="sr-label-tight">Take it out</span></div>
    <div class="actions">
      <a class="nm-save-btn" href="/trails/record?route={r.id}">Follow and record</a>
      <a class="row-link" href="/api/trails/routes/{r.id}/gpx">Download GPX</a>
      <button class="row-link danger" onclick={remove} disabled={deleting}>
        {deleting ? 'Deleting…' : 'Delete route'}
      </button>
    </div>
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
    min-width: 0;
  }
  .stat-value {
    font-family: var(--font-mono);
    font-size: var(--fs-num-md);
    color: var(--text-primary);
    line-height: 1.1;
  }

  .breakdown {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
    gap: 0.75rem;
    margin: 0;
  }
  .breakdown div {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
  }
  .breakdown dt {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-ghost);
  }
  .breakdown dd {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-primary);
  }
  .notes {
    margin: 0.85rem 0 0;
    padding-left: 1.1rem;
    font-size: var(--fs-body-sm);
    line-height: 1.55;
    color: var(--text-secondary);
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 1.1rem;
    flex-wrap: wrap;
  }
  .row-link {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    color: var(--accent);
    text-decoration: none;
  }
  .row-link:hover {
    text-decoration: underline;
  }
  .row-link.danger {
    color: var(--error);
  }
</style>
