<svelte:head>
  <title>Family location history — Strange Ramblings</title>
  <link rel="stylesheet" href="/vendor/leaflet.min.css" />
  <script src="/vendor/leaflet.min.js"></script>
</svelte:head>

<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import type {
    FamilyLocationState,
    FamilyLocationTransition,
    FamilyLocationVisit,
  } from '$lib/family-location-history';

  type PersonHistory = {
    entityId: string;
    status: 'ok' | 'no_data' | 'unavailable' | 'error';
    error?: string;
    transitions: FamilyLocationTransition[];
    visits: FamilyLocationVisit[];
    summary: { awaySeconds: number; outings: number; latestState: FamilyLocationState };
  };
  type HistoryResponse = {
    requestedRange: { start: string; end: string };
    generatedAt: string;
    people: Record<string, PersonHistory>;
  };

  const PERSON_COLOUR_TOKENS = ['--accent', '--accent-ink', '--success', '--warn', '--error'];
  let history = $state<HistoryResponse | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let mapContainer = $state<HTMLDivElement | undefined>(undefined);
  let map: any = null;
  let markerLayer: any = null;

  const people = $derived(history ? Object.entries(history.people) : []);
  const pointCount = $derived(people.reduce((count, [, person]) => count + person.transitions.filter((item) => item.point).length, 0));

  onMount(() => {
    void refresh();
  });

  onDestroy(() => map?.remove());

  async function refresh() {
    loading = true;
    error = null;
    try {
      const response = await fetch('/api/family-life360-history', { cache: 'no-store' });
      if (!response.ok) throw new Error(`History request failed (${response.status})`);
      history = await response.json();
      await tick();
      updateMap();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Unable to load location history';
    } finally {
      loading = false;
    }
  }

  function colourFor(index: number): string {
    return getComputedStyle(document.documentElement).getPropertyValue(PERSON_COLOUR_TOKENS[index]).trim();
  }

  function updateMap() {
    if (!mapContainer || !history || pointCount === 0) {
      map?.remove();
      map = null;
      markerLayer = null;
      return;
    }
    const L = (window as any).L;
    if (!L) return;
    if (!map) {
      map = L.map(mapContainer).setView([54, -2], 7);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 18,
      }).addTo(map);
      markerLayer = L.layerGroup().addTo(map);
    }
    markerLayer.clearLayers();
    const points: [number, number][] = [];
    people.forEach(([name, person], personIndex) => {
      const colour = colourFor(personIndex);
      person.transitions.forEach((transition) => {
        if (!transition.point) return;
        const { lat, lng } = transition.point;
        points.push([lat, lng]);
        L.circleMarker([lat, lng], {
          radius: 7,
          color: colour,
          fillColor: colour,
          fillOpacity: 0.8,
          weight: 2,
        })
          .bindPopup(`<strong>${name}</strong><br>${transition.state} · ${formatDate(transition.at)}`)
          .addTo(markerLayer);
      });
    });
    if (points.length) map.fitBounds(points, { padding: [32, 32], maxZoom: 13 });
  }

  function formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleString('en-GB', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London',
    });
  }

  function personName(name: string): string {
    return name.charAt(0).toUpperCase() + name.slice(1);
  }
</script>

<div class="wrap">
  <header class="page-hdr">
    <div>
      <div class="kicker">Private family record</div>
      <h1>Location history</h1>
      <p class="lede">Transition points from Home Assistant, not a route trace.</p>
    </div>
    <button class="nm-save-btn" onclick={refresh} disabled={loading} aria-label="Refresh family location history">
      {loading ? 'Loading…' : 'Refresh'}
    </button>
  </header>

  {#if error}
    <section class="nm-sec nm-sec-error" role="alert">
      <p>{error}</p>
      <button class="nm-btn-ghost" onclick={refresh}>Try again</button>
    </section>
  {:else if loading && !history}
    <section class="nm-sec" aria-live="polite"><p>Loading the last five days of transition history…</p></section>
  {:else if history}
    <section class="nm-sec range" aria-label="History range">
      <header class="nm-sec-hd"><span class="sr-label-tight">Requested range</span></header>
      <p>{formatDate(history.requestedRange.start)} to {formatDate(history.requestedRange.end)}</p>
      <p class="meta">Generated {formatDate(history.generatedAt)} · times shown in Europe/London.</p>
    </section>

    <section class="nm-sec">
      <header class="nm-sec-hd"><span class="sr-label-tight">Transition point map</span></header>
      {#if pointCount > 0}
        <div class="map" bind:this={mapContainer} aria-label="Map of family transition points"></div>
        <ul class="legend" aria-label="Map legend">
          {#each people as [name], index}
            <li><span class="legend-dot" style={`background: var(${PERSON_COLOUR_TOKENS[index]})`}></span>{personName(name)}</li>
          {/each}
        </ul>
      {:else}
        <p>No transition coordinates were returned for this range. The timeline below remains available.</p>
      {/if}
      <p class="meta">Each dot is a reported change of state. Dots are deliberately not joined into a route.</p>
    </section>

    <section class="summary-grid" aria-label="Family summary">
      {#each people as [name, person]}
        <article class="nm-sec person-card">
          <header class="nm-sec-hd"><span class="sr-label-tight">{personName(name)}</span></header>
          {#if person.status === 'ok'}
            <dl>
              <div><dt>Time away</dt><dd>{formatDuration(person.summary.awaySeconds)}</dd></div>
              <div><dt>Outings</dt><dd>{person.summary.outings}</dd></div>
              <div><dt>Latest known</dt><dd class="state">{person.summary.latestState}</dd></div>
            </dl>
          {:else}
            <p class="status-message">{person.status === 'no_data' ? 'No history in this range.' : person.error || 'History is unavailable.'}</p>
          {/if}
        </article>
      {/each}
    </section>

    <section class="nm-sec" aria-label="Chronological visit timeline">
      <header class="nm-sec-hd"><span class="sr-label-tight">Visit timeline</span></header>
      {#if people.some(([, person]) => person.visits.length > 0)}
        <ol class="timeline">
          {#each people.flatMap(([name, person]) => person.visits.map((visit) => ({ name, visit }))).sort((a, b) => a.visit.start.localeCompare(b.visit.start)) as item}
            <li>
              <span class="timeline-date">{formatDate(item.visit.start)}</span>
              <strong>{personName(item.name)}</strong> was away for {formatDuration(item.visit.durationSeconds)}.
            </li>
          {/each}
        </ol>
      {:else}
        <p>No away visits were recorded in this range.</p>
      {/if}
    </section>
  {/if}
</div>

<style>
  .wrap { max-width: 1100px; margin: 2rem auto 4rem; padding: 0 1.5rem; color: var(--text-primary); font-family: var(--font-body); }
  .page-hdr { display: flex; justify-content: space-between; align-items: flex-end; gap: 1.5rem; margin-bottom: 1.75rem; padding-bottom: 1rem; border-bottom: 2px solid var(--line-title); }
  .kicker, .meta, dt, .timeline-date { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: var(--tracking-label); color: var(--text-muted); }
  .kicker { text-transform: uppercase; color: var(--accent); margin-bottom: 0.35rem; }
  h1 { margin: 0; font-family: var(--font-display); font-size: var(--fs-display-sm); line-height: 1.05; }
  .lede { margin: 0.55rem 0 0; color: var(--text-secondary); }
  p { margin: 0; line-height: 1.5; }
  .range p + p { margin-top: 0.3rem; }
  .map { height: 25rem; border: 1px solid var(--line-strong); }
  .legend { display: flex; flex-wrap: wrap; gap: 0.75rem 1rem; padding: 0; margin: 0.9rem 0; list-style: none; font-family: var(--font-mono); font-size: var(--fs-label-xs); }
  .legend li { display: flex; gap: 0.4rem; align-items: center; }
  .legend-dot { width: 0.75rem; height: 0.75rem; border: 1px solid var(--text-primary); border-radius: 50%; }
  .summary-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 0.65rem; }
  .person-card { margin-bottom: 0; }
  dl { display: grid; gap: 0.85rem; margin: 0; }
  dl div { display: grid; gap: 0.1rem; }
  dt { text-transform: uppercase; }
  dd { margin: 0; font-family: var(--font-display); font-size: var(--fs-body-lg); }
  .state { text-transform: capitalize; }
  .status-message { color: var(--text-secondary); }
  .timeline { display: grid; gap: 0.65rem; padding: 0; margin: 0; list-style: none; }
  .timeline li { border-left: 3px solid var(--accent); padding-left: 0.75rem; line-height: 1.5; }
  .timeline-date { display: block; margin-bottom: 0.15rem; }
  :global(.leaflet-container) { font-family: var(--font-body); background: var(--surface-sunken); }
  @media (max-width: 800px) { .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 560px) { .wrap { margin-top: 1.25rem; padding: 0 1rem; } .page-hdr { align-items: flex-start; flex-direction: column; } .map { height: 18rem; } .summary-grid { grid-template-columns: 1fr; } }
</style>
