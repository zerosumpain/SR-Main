<script lang="ts">
  // Drawer body for a selected POI (pub / walk / attraction). Name + kind/dog/food
  // tags, the description prose, a live Google rating with highlight/lowlight
  // snippets (fail-soft → hidden), and TripAdvisor / Google deep-links. Opaque
  // panel so it can float over the map.
  import { app } from '../lib/appState.svelte';
  import { getRating, type Rating } from '../lib/ratings';
  import type { Poi, PoiKind } from '../lib/types';

  const KIND_LABEL: Record<PoiKind, string> = {
    pub: 'Pub',
    walk: 'Walk',
    attraction: 'Attraction',
    shop: 'Shop',
    fuel: 'Fuel',
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
        <span class="tag tag-dog">🐾 dog-friendly</span>
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
    border-radius: 0.6rem;
    color: var(--text-primary);
    box-shadow: 0 8px 28px rgba(0, 0, 0, 0.22);
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
    border-radius: 0.4rem;
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
    border-radius: 0.3rem;
    white-space: nowrap;
  }
  .tag-dog { color: var(--success); border-color: color-mix(in srgb, var(--success) 55%, transparent); }
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
    border-radius: 0.45rem;
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
    border-radius: 0.4rem;
    cursor: pointer;
    min-height: 40px;
    text-decoration: none;
  }
  .btn-ghost { background: transparent; border: 1px solid var(--card-border); color: var(--text-secondary); }
  .btn-ghost:hover { color: var(--text-primary); border-color: var(--text-muted); }
</style>
