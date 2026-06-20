<script lang="ts">
  // Drawer body for a selected POI (pub / walk / attraction). Name + kind/dog/food
  // tags, the description prose, a live Google rating with highlight/lowlight
  // snippets (fail-soft → hidden), and TripAdvisor / Google deep-links. Opaque
  // panel so it can float over the map.
  import { app } from '../lib/appState.svelte';
  import { getRating, type Rating } from '../lib/ratings';
  import { fmtDist, fmtTime } from '../lib/format';
  import type { Poi, PoiKind } from '../lib/types';

  const KIND_LABEL: Record<PoiKind, string> = {
    pub: 'Pub',
    walk: 'Walk',
    attraction: 'Attraction',
    shop: 'Shop',
    fuel: 'Fuel',
    fishing: 'Fishing',
    swim: 'Swimming',
  };

  const sel = $derived(app.selected);
  const poi = $derived<Poi | null>(
    sel?.kind === 'poi' ? app.data?.pois.find((p) => p.id === sel.id) ?? null : null,
  );

  let rating = $state<Rating | null>(null);

  // Refetch whenever the selected POI changes. getRating is cached + never throws.
  $effect(() => {
    const p = poi;
    if (!p) {
      rating = null;
      return;
    }
    rating = null;
    let cancelled = false;
    getRating({ place_id: p.place_id, name: p.name, lat: p.lat, lng: p.lng }).then((r) => {
      if (!cancelled) rating = r;
    });
    return () => {
      cancelled = true;
    };
  });

  // Round a rating to whole/half stars for the glyph row.
  function stars(r: number): string {
    const full = Math.floor(r);
    const half = r - full >= 0.5;
    return '★'.repeat(full) + (half ? '⯪' : '') + '☆'.repeat(5 - full - (half ? 1 : 0));
  }

  // A POI isn't a graph node, so a trip "stop" for it is the mooring you'd tie up
  // at to reach it. Mirror the mooring add-flow: chain from the last stop.
  const access = $derived(poi ? app.poiAccess(poi.id) : null);
  const accessNode = $derived(access?.mooring.node_id ?? null);
  const inTrip = $derived(app.itinerary.length > 0);
  const isLast = $derived(!!accessNode && app.lastStopNodeId === accessNode);
  const already = $derived(!!accessNode && app.itinerary.includes(accessNode));
  const addLeg = $derived(inTrip && accessNode && !isLast ? app.legFromLast(accessNode) : null);
  const walkBit = $derived(access && access.dist_m > 60 ? ` · ${fmtDist(access.dist_m, app.units)} walk` : '');

  function addPoiStop() {
    if (!poi || !accessNode) return;
    app.addStopWithNote(accessNode, `${poi.name} · ${KIND_LABEL[poi.kind] ?? 'Place'}`);
    app.closeSelection();
  }
</script>

{#if poi}
  <aside class="card" role="dialog" aria-label="Place detail">
    <header class="head">
      <div class="head-text">
        <span class="kicker">{KIND_LABEL[poi.kind] ?? 'Place'}</span>
        <h2 class="title">{poi.name}</h2>
      </div>
      <button class="close" onclick={() => app.closeSelection()} aria-label="Close">×</button>
    </header>

    <div class="tags">
      <span class="tag">{KIND_LABEL[poi.kind] ?? 'Place'}</span>
      {#if poi.dog_friendly === true}
        <span class="tag tag-dog"><svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="7" r="1.4" /><circle cx="14" cy="7" r="1.4" /><circle cx="3.5" cy="11" r="1.2" /><circle cx="16.5" cy="11" r="1.2" /><path d="M10 10c-2.4 0-4 1.8-4 4 0 1.6 1.4 2.5 4 2.5s4-.9 4-2.5c0-2.2-1.6-4-4-4z" /></svg> dog-friendly</span>
      {:else if poi.dog_friendly === false}
        <span class="tag tag-muted">no dogs</span>
      {/if}
      {#if poi.food}
        <span class="tag">food</span>
      {/if}
    </div>

    {#if poi.description}
      <p class="desc">{poi.description}</p>
    {/if}

    {#if rating?.available}
      <div class="rating">
        <div class="rating-head">
          {#if rating.rating != null}
            <span class="stars" aria-hidden="true">{stars(rating.rating)}</span>
            <span class="rating-num">{rating.rating.toFixed(1)}</span>
          {/if}
          {#if rating.count != null}
            <span class="rating-count">({rating.count.toLocaleString()})</span>
          {/if}
        </div>
        {#if rating.highlight}
          <p class="quote quote-up">“{rating.highlight}”</p>
        {/if}
        {#if rating.lowlight}
          <p class="quote quote-down">“{rating.lowlight}”</p>
        {/if}
      </div>
    {/if}

    {#if accessNode && access}
      <div class="actions">
        {#if inTrip}
          <button class="btn btn-primary add-next" disabled={isLast || already} onclick={addPoiStop}>
            {#if isLast}You're already mooring here
            {:else if already}Already in your trip
            {:else}
              <span class="add-line">＋ Add after {app.lastStopLabel}</span>
              <span class="leg-meta">
                {#if addLeg && addLeg.edges.length}{fmtTime(addLeg.time_s)} · {fmtDist(addLeg.distance_m, app.units)} · {:else if addLeg}not reachable · {/if}moor at {access.mooring.name}{walkBit}
              </span>
            {/if}
          </button>
        {:else}
          <button class="btn btn-primary add-next" onclick={addPoiStop}>
            <span class="add-line">＋ Add to a trip</span>
            <span class="leg-meta">moor at {access.mooring.name}{walkBit}</span>
          </button>
          <button class="btn btn-ghost" onclick={() => app.routeTo(accessNode)}>Route here</button>
        {/if}
      </div>
    {/if}

    {#if poi.tripadvisor_url || poi.google_url}
      <div class="links">
        {#if poi.tripadvisor_url}
          <a class="btn btn-ghost" href={poi.tripadvisor_url} target="_blank" rel="noopener">
            View on TripAdvisor
          </a>
        {/if}
        {#if poi.google_url}
          <a class="btn btn-ghost" href={poi.google_url} target="_blank" rel="noopener">
            View on Google
          </a>
        {/if}
      </div>
    {/if}
  </aside>
{/if}

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    padding: 1rem;
    background: var(--surface-elevated);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-round);
    color: var(--text-primary);
  }
  .head { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.6rem; }
  .head-text { display: flex; flex-direction: column; gap: 0.3rem; }
  .kicker {
    font-family: var(--font-mono);
    font-size: 0.625rem;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--accent);
  }
  .title {
    margin: 0;
    font-family: var(--font-display);
    font-size: 1.05rem;
    line-height: 1.2;
    text-transform: uppercase;
  }
  .close {
    flex: none;
    width: 40px;
    height: 40px;
    display: grid;
    place-items: center;
    font-family: var(--font-mono);
    font-size: 1.4rem;
    line-height: 1;
    background: transparent;
    border: 1px solid var(--card-border);
    border-radius: var(--radius-round);
    color: var(--text-secondary);
    cursor: pointer;
  }
  .close:hover { color: var(--text-primary); border-color: var(--text-muted); }

  .tags { display: flex; flex-wrap: wrap; gap: 0.35rem; }
  .tag {
    font-family: var(--font-mono);
    font-size: 0.58rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-secondary);
    border: 1px solid var(--card-border);
    padding: 0.16rem 0.42rem;
    border-radius: var(--radius-sharp);
    white-space: nowrap;
  }
  .tag-dog { display: inline-flex; align-items: center; gap: 0.25rem; color: var(--success); border-color: color-mix(in srgb, var(--success) 55%, transparent); }
  .tag-muted { color: var(--text-muted); }

  .desc {
    margin: 0;
    font-family: var(--font-body);
    font-size: 0.88rem;
    line-height: 1.5;
    color: var(--text-secondary);
  }

  .rating {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.65rem 0.7rem;
    border: 1px solid var(--card-border);
    border-radius: var(--radius-round);
    background: var(--card-bg);
  }
  .rating-head { display: flex; align-items: baseline; gap: 0.4rem; }
  .stars { color: var(--accent); font-size: 0.95rem; letter-spacing: 0.05em; }
  .rating-num { font-family: var(--font-mono); font-size: 1rem; font-weight: 700; color: var(--text-primary); }
  .rating-count { font-family: var(--font-mono); font-size: 0.72rem; color: var(--text-muted); }
  .quote {
    margin: 0;
    font-family: var(--font-body);
    font-size: 0.8rem;
    line-height: 1.45;
    font-style: italic;
  }
  .quote-up { color: var(--success); }
  .quote-down { color: var(--text-muted); }

  .links { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .btn {
    display: inline-flex;
    align-items: center;
    font-family: var(--font-mono);
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 0.55rem 0.85rem;
    border-radius: var(--radius-round);
    cursor: pointer;
    min-height: 40px;
    text-decoration: none;
  }
  .btn-ghost { background: transparent; border: 1px solid var(--card-border); color: var(--text-secondary); }
  .btn-ghost:hover { color: var(--text-primary); border-color: var(--text-muted); }

  .actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .actions .btn { cursor: pointer; }
  .btn-primary { background: var(--accent); color: #fff; border: none; }
  .btn-primary:hover { background: var(--accent-hover); }
  .btn:disabled { opacity: 0.55; cursor: default; }
  .add-next { flex: 1 1 100%; flex-direction: column; align-items: flex-start; gap: 0.12rem; padding-top: 0.5rem; padding-bottom: 0.5rem; text-transform: none; letter-spacing: 0; }
  .add-line { font-family: var(--font-mono); font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.05em; }
  .leg-meta { font-family: var(--font-mono); font-size: 0.62rem; opacity: 0.92; font-variant-numeric: tabular-nums; line-height: 1.3; }
</style>
