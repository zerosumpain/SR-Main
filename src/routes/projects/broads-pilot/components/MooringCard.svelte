<script lang="ts">
  // Drawer body for a selected mooring. Name + tier, charge + verification year,
  // a facilities row (shore power highlighted — engines can't run overnight at a
  // mooring, so a 240 V hookup is the prize), walkable POIs from the precomputed
  // mooring→POI index (dog filter applied), and route/add-stop actions. Opaque
  // panel so it can float over the map.
  import { app } from '../lib/appState.svelte';
  import { fmtRate, fmtDist, fmtTime } from '../lib/format';
  import { getRating, type Rating } from '../lib/ratings';
  import type { Mooring, MooringTier, Poi, PoiKind } from '../lib/types';

  const TIER_LABEL: Record<MooringTier, string> = {
    ba_free: 'BA 24h Free',
    ba_staffed: 'BA Staffed',
    yacht_station: 'Yacht Station',
    pub: 'Pub',
    private: 'Private',
    marina: 'Marina',
    hire_yard: 'Hire Base',
  };

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
  const m = $derived<Mooring | null>(
    sel?.kind === 'mooring' ? app.data?.moorings.find((x) => x.id === sel.id) ?? null : null,
  );

  // Non-shore-power facilities, only the ones present, in signage order.
  const FACILITIES: { key: keyof Mooring['facilities']; label: string }[] = [
    { key: 'water', label: 'Water' },
    { key: 'pump_out', label: 'Pump-out' },
    { key: 'toilets', label: 'Toilets' },
    { key: 'showers', label: 'Showers' },
    { key: 'refuse', label: 'Refuse' },
  ];
  const presentFacilities = $derived(
    m ? FACILITIES.filter((f) => m.facilities[f.key]) : [],
  );

  // Walkable POIs: resolve ids → Poi, apply the dog-only filter (hide pubs/walks
  // explicitly flagged not dog-friendly), sort by distance, cap the list.
  interface NearbyRow { poi: Poi; dist_m: number }
  const nearby = $derived.by<NearbyRow[]>(() => {
    if (!m || !app.data) return [];
    const refs = app.data.mooringPois[m.id] ?? [];
    const rows: NearbyRow[] = [];
    for (const ref of refs) {
      const poi = app.data.pois.find((p) => p.id === ref.poi_id);
      if (!poi) continue;
      if (app.dogOnly && (poi.kind === 'pub' || poi.kind === 'walk') && poi.dog_friendly === false) continue;
      rows.push({ poi, dist_m: ref.dist_m });
    }
    rows.sort((a, b) => a.dist_m - b.dist_m);
    return rows.slice(0, 10);
  });

  // Live Google rating (pub moorings / marinas / yacht stations usually have one;
  // fails soft → hidden). Refetched whenever the selected mooring changes.
  let rating = $state<Rating | null>(null);
  $effect(() => {
    const cur = m;
    rating = null;
    if (!cur) return;
    let cancelled = false;
    getRating({ name: cur.name, lat: cur.lat, lng: cur.lng }).then((r) => { if (!cancelled) rating = r; });
    return () => { cancelled = true; };
  });
  function stars(r: number): string {
    const full = Math.floor(r);
    const half = r - full >= 0.5;
    return '★'.repeat(full) + (half ? '⯪' : '') + '☆'.repeat(5 - full - (half ? 1 : 0));
  }
</script>

{#if m}
  <aside class="card" role="dialog" aria-label="Mooring detail">
    <header class="head">
      <div class="head-text">
        <span class="kicker">{TIER_LABEL[m.tier] ?? 'Mooring'}</span>
        <h2 class="title">{m.name}</h2>
      </div>
      <button class="close" onclick={() => app.closeSelection()} aria-label="Close">×</button>
    </header>

    <div class="charge-row">
      <span class="charge">{fmtRate(m.rate, m.waived_with_meal)}</span>
      <span class="verified">verified {m.last_verified}</span>
    </div>

    {#if rating?.available && rating.rating != null}
      <div class="rating">
        <span class="stars" aria-hidden="true">{stars(rating.rating)}</span>
        <span class="rating-num">{rating.rating.toFixed(1)}</span>
        {#if rating.count != null}<span class="rating-count">({rating.count.toLocaleString()})</span>{/if}
        {#if rating.highlight}<span class="rating-quote">“{rating.highlight}”</span>{/if}
      </div>
    {/if}

    <div class="facilities">
      <span class="kicker kicker-muted">Facilities</span>
      <div class="fac-list">
        <span class="fac" class:fac-on={m.facilities.shore_power} class:fac-off={!m.facilities.shore_power}>
          ⚡ Shore power{m.facilities.shore_power ? '' : ' — none'}
        </span>
        {#each presentFacilities as f (f.key)}
          <span class="fac fac-plain">{f.label}</span>
        {/each}
      </div>
      {#if m.capacity_caveat}
        <p class="caveat">small / first-come — may be full</p>
      {/if}
    </div>

    {#if nearby.length}
      <div class="nearby">
        <span class="kicker kicker-muted">
          Nearby on foot{app.dogOnly ? ' · dog-friendly' : ''}
        </span>
        <ul class="near-list">
          {#each nearby as { poi, dist_m } (poi.id)}
            <li>
              <button class="near-row" onclick={() => app.select({ kind: 'poi', id: poi.id })}>
                <span class="near-name">{poi.name}</span>
                <span class="near-meta">
                  <span class="near-kind">{KIND_LABEL[poi.kind] ?? 'Place'}</span>
                  <span class="near-dist">{fmtDist(dist_m, app.units)}</span>
                </span>
              </button>
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    {#if m.node_id}
      {@const inTrip = app.itinerary.length > 0}
      {@const isLast = app.lastStopNodeId === m.node_id}
      {@const already = app.itinerary.includes(m.node_id)}
      {@const addLeg = inTrip && !isLast ? app.legFromLast(m.node_id) : null}
      <div class="actions">
        {#if inTrip}
          <!-- continue the trip from the last stop -->
          <button class="btn btn-primary add-next" disabled={isLast || already}
            onclick={() => { app.addStop(m.node_id!); app.closeSelection(); }}>
            {#if isLast}This is your last stop
            {:else if already}Already in your trip
            {:else}
              <span class="add-line">＋ Add after {app.lastStopLabel}</span>
              {#if addLeg && addLeg.edges.length}
                <span class="leg-meta">{fmtTime(addLeg.time_s)} · {fmtDist(addLeg.distance_m, app.units)}{addLeg.crossesBreydon ? ' · tidal' : ''}</span>
              {:else if addLeg}
                <span class="leg-meta blocked">not reachable for this boat</span>
              {/if}
            {/if}
          </button>
        {:else}
          <button class="btn btn-primary" onclick={() => app.routeTo(m.node_id!)}>Route here</button>
          <button class="btn btn-ghost" onclick={() => { app.addStop(m.node_id!); app.closeSelection(); }}>＋ Start a trip</button>
        {/if}
      </div>
    {/if}
  </aside>
{/if}

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
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
  .kicker-muted { color: var(--text-muted); }
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

  .charge-row { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.5rem 0.8rem; }
  .charge {
    font-family: var(--font-mono);
    font-size: 1.05rem;
    font-weight: 700;
    color: var(--text-primary);
  }
  .verified {
    font-family: var(--font-mono);
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-muted);
  }

  .rating { display: flex; align-items: baseline; flex-wrap: wrap; gap: 0.4rem; }
  .rating .stars { color: var(--accent); font-size: 0.92rem; letter-spacing: 0.04em; }
  .rating-num { font-family: var(--font-mono); font-size: 0.95rem; font-weight: 700; color: var(--text-primary); }
  .rating-count { font-family: var(--font-mono); font-size: 0.68rem; color: var(--text-muted); }
  .rating-quote { flex-basis: 100%; font-family: var(--font-body); font-size: 0.78rem; font-style: italic; color: var(--text-secondary); line-height: 1.4; }

  .facilities { display: flex; flex-direction: column; gap: 0.4rem; }
  .fac-list { display: flex; flex-wrap: wrap; gap: 0.35rem; }
  .fac {
    font-family: var(--font-mono);
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 0.22rem 0.5rem;
    border-radius: 0.3rem;
    white-space: nowrap;
  }
  .fac-plain { color: var(--text-secondary); border: 1px solid var(--card-border); }
  .fac-on { color: #fff; background: var(--success); border: 1px solid var(--success); font-weight: 700; }
  .fac-off { color: var(--text-muted); border: 1px dashed var(--card-border); }
  .caveat {
    margin: 0;
    font-family: var(--font-body);
    font-size: 0.78rem;
    color: var(--text-muted);
    font-style: italic;
  }

  .nearby { display: flex; flex-direction: column; gap: 0.4rem; }
  .near-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.3rem; }
  .near-row {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
    min-height: 40px;
    padding: 0.4rem 0.55rem;
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: 0.4rem;
    cursor: pointer;
    text-align: left;
  }
  .near-row:hover { border-color: var(--accent); }
  .near-name { font-family: var(--font-body); font-size: 0.86rem; color: var(--text-primary); }
  .near-meta { display: flex; align-items: center; gap: 0.5rem; flex: none; }
  .near-kind {
    font-family: var(--font-mono);
    font-size: 0.58rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .near-dist { font-family: var(--font-mono); font-size: 0.72rem; color: var(--text-secondary); }

  .actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .btn {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 0.55rem 0.9rem;
    border-radius: 0.4rem;
    cursor: pointer;
    min-height: 40px;
  }
  .btn-primary { background: var(--accent); color: #fff; border: none; }
  .btn-primary:hover { background: var(--accent-hover); }
  .btn:disabled { opacity: 0.55; cursor: default; }
  /* "Add after <last stop>" stacks the action over the leg it adds */
  .add-next { flex: 1 1 100%; display: flex; flex-direction: column; align-items: flex-start; gap: 0.12rem; padding-top: 0.5rem; padding-bottom: 0.5rem; text-transform: none; letter-spacing: 0; }
  .add-line { font-family: var(--font-mono); font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.05em; }
  .leg-meta { font-family: var(--font-mono); font-size: 0.62rem; opacity: 0.9; font-variant-numeric: tabular-nums; }
  .leg-meta.blocked { color: #ffd9d0; }
  .btn-ghost { background: transparent; border: 1px solid var(--card-border); color: var(--text-secondary); }
  .btn-ghost:hover { color: var(--text-primary); border-color: var(--text-muted); }
</style>
