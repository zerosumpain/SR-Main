<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '../lib/appState.svelte';
  import { bridgeVerdict } from '../lib/passability';
  import type { Verdict } from '../lib/types';

  let mapEl: HTMLDivElement;
  // Leaflet handles kept as plain refs (NOT $state) to avoid effect-update loops.
  let L: any;
  let map: any;
  let warmTiles: any, nauticalBase: any, seamark: any;
  const groups: Record<string, any> = {};
  let initialized = false;

  const TIER_COLOR: Record<string, string> = {
    ba_free: '#2e7d32', ba_staffed: '#558b2f', yacht_station: '#00695c',
    pub: '#b8860b', private: '#8d6e63', marina: '#6d4c41', hire_yard: '#c4570a',
  };
  const VERDICT_COLOR: Record<Verdict, string> = { pass: '#2e7d32', marginal: '#e69500', blocked: '#c62828' };
  const POI_COLOR: Record<string, string> = { pub: '#b8860b', walk: '#2e7d32', attraction: '#7b4fb0', shop: '#8d6e63', fuel: '#555' };

  function dot(color: string, r = 6, ring = false) {
    return { radius: r, fillColor: color, color: ring ? '#1a1008' : color, weight: ring ? 2 : 1, fillOpacity: 0.95 };
  }

  onMount(() => {
    L = (window as any).L;
    if (!L || !mapEl) return;
    map = L.map(mapEl, { zoomControl: true, attributionControl: true, preferCanvas: true }).setView([52.68, 1.46], 11);
    warmTiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18, className: 'bp-warm-tiles', attribution: '&copy; OpenStreetMap contributors',
    });
    nauticalBase = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap contributors' });
    seamark = L.tileLayer('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', { maxZoom: 18, opacity: 0.9 });
    for (const k of ['network', 'zones', 'route', 'moorings', 'pois', 'restrictions', 'origin']) groups[k] = L.layerGroup().addTo(map);
    map.on('click', (e: any) => app.setOrigin(e.latlng.lat, e.latlng.lng, 'Dropped pin'));
    initialized = true;
    applyTheme();
  });

  function applyTheme() {
    if (!map) return;
    [warmTiles, nauticalBase, seamark].forEach((t) => map.hasLayer(t) && map.removeLayer(t));
    if (app.mapTheme === 'warm') warmTiles.addTo(map);
    else { nauticalBase.addTo(map); seamark.addTo(map); }
    warmTiles.bringToBack?.();
  }

  function renderStatic() {
    if (!initialized || !app.data) return;
    groups.network.clearLayers();
    groups.zones.clearLayers();
    // faint navigable network (skipped when range-band shading is on)
    if (!app.showRangeRings)
      for (const e of app.data.graph.edges)
        L.polyline(e.geometry, { color: '#6d4c41', weight: 1.5, opacity: 0.28 }).addTo(groups.network);
    if (app.layers.restrictions)
      for (const z of app.data.restrictions.zones) {
        const col = z.type === 'conservation' ? '#c62828' : z.type === 'tidal' ? '#e69500' : '#8d6e63';
        L.polygon(z.geometry, { color: col, weight: 1, fillColor: col, fillOpacity: 0.12, dashArray: '4 4' })
          .bindTooltip(z.notes.split(' — ')[0], { sticky: true }).addTo(groups.zones);
      }
  }

  function timeBand(t: number) {
    const h = t / 3600;
    return h <= 1 ? '#1b7a3d' : h <= 2 ? '#7cb342' : h <= 4 ? '#e69500' : '#c4570a';
  }

  function renderDynamic() {
    if (!initialized || !app.data) return;
    for (const k of ['route', 'moorings', 'pois', 'restrictions', 'origin']) groups[k].clearLayers();

    // range bands (network isochrone) — recolour edges by reachable time
    if (app.showRangeRings && app.reachable) {
      groups.network.clearLayers();
      const reach = app.reachable;
      for (const e of app.data.graph.edges) {
        const ta = reach.get(e.from)?.time_s, tb = reach.get(e.to)?.time_s;
        const t = Math.min(ta ?? Infinity, tb ?? Infinity);
        if (t === Infinity) { L.polyline(e.geometry, { color: '#6d4c41', weight: 1, opacity: 0.15 }).addTo(groups.network); continue; }
        L.polyline(e.geometry, { color: timeBand(t), weight: 3, opacity: 0.8 }).addTo(groups.network);
      }
    } else if (groups.network.getLayers().length === 0) {
      renderStatic();
    }

    // route polyline
    if (app.route && app.route.edges.length) {
      for (const e of app.route.edges)
        L.polyline(e.geometry, { color: '#c4570a', weight: 5, opacity: 0.95 }).addTo(groups.route);
    }

    // moorings
    if (app.layers.moorings)
      for (const m of app.data.moorings)
        L.circleMarker([m.lat, m.lng], dot(TIER_COLOR[m.tier] ?? '#6d4c41', 6))
          .bindTooltip(m.name, { direction: 'top' })
          .on('click', (ev: any) => { ev.originalEvent?.stopPropagation?.(); app.select({ kind: 'mooring', id: m.id }); })
          .addTo(groups.moorings);

    // POIs (filtered by layer + dog-only)
    for (const p of app.data.pois) {
      const on = p.kind === 'pub' ? app.layers.pubs : p.kind === 'walk' ? app.layers.walks : app.layers.attractions;
      if (!on) continue;
      if (app.dogOnly && (p.kind === 'pub' || p.kind === 'walk') && p.dog_friendly === false) continue;
      L.circleMarker([p.lat, p.lng], dot(POI_COLOR[p.kind] ?? '#555', 4))
        .bindTooltip(p.name, { direction: 'top' })
        .on('click', (ev: any) => { ev.originalEvent?.stopPropagation?.(); app.select({ kind: 'poi', id: p.id }); })
        .addTo(groups.pois);
    }

    // restrictions: bridges (verdict-coloured) + lock
    if (app.layers.restrictions && app.boat) {
      for (const b of app.data.restrictions.bridges) {
        const v = bridgeVerdict(b, app.boat);
        L.marker([b.lat, b.lng], {
          icon: L.divIcon({ className: 'bp-bridge', html: `<span class="bp-bridge-pin" style="--c:${VERDICT_COLOR[v]}">▲</span>`, iconSize: [18, 18] }),
        }).bindTooltip(`${b.name} — ${v}`, { direction: 'top' })
          .on('click', (ev: any) => { ev.originalEvent?.stopPropagation?.(); app.select({ kind: 'bridge', id: b.id }); })
          .addTo(groups.restrictions);
      }
      const lk = app.data.restrictions.lock;
      L.marker([lk.lat, lk.lng], { icon: L.divIcon({ className: 'bp-lock', html: '<span class="bp-lock-pin">⚿</span>', iconSize: [18, 18] }) })
        .bindTooltip(lk.name, { direction: 'top' })
        .on('click', (ev: any) => { ev.originalEvent?.stopPropagation?.(); app.select({ kind: 'lock', id: lk.id }); })
        .addTo(groups.restrictions);
    }

    // origin
    if (app.origin)
      L.marker([app.origin.lat, app.origin.lng], { icon: L.divIcon({ className: 'bp-origin', html: '<span class="bp-origin-pin">◉</span>', iconSize: [22, 22] }), zIndexOffset: 1000 })
        .bindTooltip(app.origin.label, { direction: 'top' }).addTo(groups.origin);
  }

  // effects: theme, static data, dynamic (tracks all app.* reads inside)
  $effect(() => { app.mapTheme; if (initialized) applyTheme(); });
  $effect(() => { app.data; app.layers.restrictions; app.showRangeRings; if (initialized) renderStatic(); });
  $effect(() => {
    // touch reactive deps so the effect re-runs on any of them
    app.data; app.boat; app.route; app.origin; app.reachable; app.showRangeRings;
    app.layers.moorings; app.layers.pubs; app.layers.walks; app.layers.attractions; app.layers.restrictions; app.dogOnly;
    if (initialized) renderDynamic();
  });

  export function flyTo(lat: number, lng: number, zoom = 13) { map?.flyTo([lat, lng], zoom); }
</script>

<div class="bp-map" bind:this={mapEl}></div>

<style>
  .bp-map { position: absolute; inset: 0; height: 100%; width: 100%; background: var(--bg); }
  /* Warm-brutalist "chart" — push standard OSM tiles toward parchment, kill blues. */
  :global(.bp-warm-tiles) { filter: sepia(0.5) saturate(0.72) hue-rotate(-12deg) brightness(1.06) contrast(0.92); }
  :global(.bp-bridge-pin) { color: var(--c); font-size: 15px; line-height: 1; text-shadow: 0 0 2px #fff, 0 0 2px #fff; }
  :global(.bp-lock-pin) { color: #4527a0; font-size: 15px; text-shadow: 0 0 2px #fff, 0 0 2px #fff; }
  :global(.bp-origin-pin) { color: #c4570a; font-size: 20px; text-shadow: 0 0 3px #fff, 0 0 3px #fff; }
  :global(.leaflet-container) { font-family: var(--font-mono, monospace); background: #ece3d2; }
  :global(.leaflet-tooltip) { font-family: var(--font-mono, monospace); font-size: 11px; }
</style>
