<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '../lib/appState.svelte';
  import { bridgeVerdict, edgeVerdict } from '../lib/passability';
  import type { Verdict } from '../lib/types';

  let mapEl: HTMLDivElement;
  // Leaflet handles kept as plain refs (NOT $state) to avoid effect-update loops.
  let L: any;
  let map: any;
  let warmTiles: any, nauticalBase: any, seamark: any, schematicTiles: any;
  const groups: Record<string, any> = {};
  let initialized = false;

  const TIER_COLOR: Record<string, string> = {
    ba_free: '#2e7d32', ba_staffed: '#558b2f', yacht_station: '#00695c',
    pub: '#b8860b', private: '#8d6e63', marina: '#6d4c41', hire_yard: '#c4570a',
  };
  const VERDICT_COLOR: Record<Verdict, string> = { pass: '#2e7d32', marginal: '#e69500', blocked: '#c62828' };
  const POI_COLOR: Record<string, string> = { pub: '#b8860b', walk: '#2e7d32', attraction: '#7b4fb0', shop: '#8d6e63', fuel: '#555' };
  const BASE = ['network', 'zones', 'moorings', 'pois', 'restrictions', 'origin'];

  onMount(() => {
    L = (window as any).L;
    if (!L || !mapEl) return;
    map = L.map(mapEl, { zoomControl: true, attributionControl: true, preferCanvas: true }).setView([52.68, 1.46], 11);
    // keep the +/- control clear of the docked sheet: bottom-left on desktop,
    // top-left on mobile (where the sheet is a bottom sheet).
    const mq = window.matchMedia('(min-width: 760px)');
    const setZoomPos = () => map.zoomControl?.setPosition(mq.matches ? 'bottomleft' : 'topleft');
    setZoomPos();
    mq.addEventListener?.('change', setZoomPos);
    const OSM = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
    const ATTR = '&copy; OpenStreetMap contributors';
    warmTiles = L.tileLayer(OSM, { maxZoom: 18, className: 'bp-warm-tiles', attribution: ATTR });
    nauticalBase = L.tileLayer(OSM, { maxZoom: 18, attribution: ATTR });
    seamark = L.tileLayer('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', { maxZoom: 18, opacity: 0.9 });
    schematicTiles = L.tileLayer(OSM, { maxZoom: 18, opacity: 0.12, className: 'bp-schematic-tiles', attribution: ATTR });
    for (const k of [...BASE, 'route', 'user']) groups[k] = L.layerGroup().addTo(map);
    map.on('click', (e: any) => app.setOrigin(e.latlng.lat, e.latlng.lng, 'Dropped pin'));
    initialized = true;
    applyTheme();
  });

  function applyTheme() {
    if (!map) return;
    [warmTiles, nauticalBase, seamark, schematicTiles].forEach((t) => map.hasLayer(t) && map.removeLayer(t));
    if (app.mapTheme === 'warm') warmTiles.addTo(map);
    else if (app.mapTheme === 'nautical') { nauticalBase.addTo(map); seamark.addTo(map); }
    else schematicTiles.addTo(map);
  }

  function timeBand(t: number) {
    const h = t / 3600;
    return h <= 1 ? '#1b7a3d' : h <= 2 ? '#7cb342' : h <= 4 ? '#e69500' : '#c4570a';
  }

  // Draw the base layers (everything except the route polyline).
  function renderBase() {
    if (!initialized || !app.data) return;
    for (const k of BASE) groups[k].clearLayers();
    const data = app.data;
    const boat = app.boat;
    const schematic = app.mapTheme === 'schematic';
    // In schematic mode EVERY layer renders; the toggle sets opacity (1 vs faint)
    // so you can bring pubs/walks/etc. into focus over a barely-there background.
    const shown = (on: boolean) => schematic || on;
    const op = (on: boolean) => (schematic ? (on ? 1 : 0.1) : 1);

    // --- the waterway network ---
    if (schematic) {
      // only the riverways accessible to the selected boat are emphasised;
      // edges the boat can't pass are faint + dashed.
      for (const e of data.graph.edges) {
        const v = boat ? edgeVerdict(e, data.restrictions, boat) : 'pass';
        if (v === 'blocked')
          L.polyline(e.geometry, { color: '#9a4b00', weight: 1.5, opacity: 0.2, dashArray: '2 7' }).addTo(groups.network);
        else
          L.polyline(e.geometry, { color: '#c4570a', weight: v === 'marginal' ? 2.5 : 3.6, opacity: 0.92 }).addTo(groups.network);
      }
    } else if (app.showRangeRings && app.reachable) {
      const reach = app.reachable;
      for (const e of data.graph.edges) {
        const t = Math.min(reach.get(e.from)?.time_s ?? Infinity, reach.get(e.to)?.time_s ?? Infinity);
        if (t === Infinity) L.polyline(e.geometry, { color: '#6d4c41', weight: 1, opacity: 0.15 }).addTo(groups.network);
        else L.polyline(e.geometry, { color: timeBand(t), weight: 3.4, opacity: 0.85 }).addTo(groups.network);
      }
    } else {
      for (const e of data.graph.edges)
        L.polyline(e.geometry, { color: '#6d4c41', weight: 1.6, opacity: 0.3 }).addTo(groups.network);
    }

    // --- conservation / tidal zones (part of the Restrictions layer) ---
    if (shown(app.layers.restrictions)) {
      const o = op(app.layers.restrictions);
      for (const z of data.restrictions.zones) {
        const col = z.type === 'conservation' ? '#c62828' : z.type === 'tidal' ? '#e69500' : '#8d6e63';
        L.polygon(z.geometry, { color: col, weight: 1.5, opacity: 0.75 * o, fillColor: col, fillOpacity: 0.18 * o, dashArray: '5 4' })
          .bindTooltip(z.notes.split(' — ')[0], { sticky: true }).addTo(groups.zones);
      }
    }

    // --- moorings ---
    if (shown(app.layers.moorings)) {
      const o = op(app.layers.moorings);
      for (const m of data.moorings)
        L.circleMarker([m.lat, m.lng], { radius: 6, fillColor: TIER_COLOR[m.tier] ?? '#6d4c41', color: '#1a1008', weight: 1, fillOpacity: 0.95 * o, opacity: 0.9 * o })
          .bindTooltip(m.name, { direction: 'top' })
          .on('click', (ev: any) => { ev.originalEvent?.stopPropagation?.(); app.select({ kind: 'mooring', id: m.id }); })
          .addTo(groups.moorings);
    }

    // --- POIs (pubs / walks / attractions), per-kind toggle + dog filter ---
    for (const p of data.pois) {
      const on = p.kind === 'pub' ? app.layers.pubs : p.kind === 'walk' ? app.layers.walks : app.layers.attractions;
      if (!shown(on)) continue;
      if (app.dogOnly && (p.kind === 'pub' || p.kind === 'walk') && p.dog_friendly === false) continue;
      const o = op(on);
      L.circleMarker([p.lat, p.lng], { radius: 4, fillColor: POI_COLOR[p.kind] ?? '#555', color: POI_COLOR[p.kind] ?? '#555', weight: 0, fillOpacity: 0.92 * o, opacity: 0.92 * o })
        .bindTooltip(p.name, { direction: 'top' })
        .on('click', (ev: any) => { ev.originalEvent?.stopPropagation?.(); app.select({ kind: 'poi', id: p.id }); })
        .addTo(groups.pois);
    }

    // --- bridges (verdict-coloured) + the lock ---
    if (shown(app.layers.restrictions) && boat) {
      const o = op(app.layers.restrictions);
      for (const b of data.restrictions.bridges) {
        const v = bridgeVerdict(b, boat);
        const mk = L.marker([b.lat, b.lng], { icon: L.divIcon({ className: 'bp-bridge', html: `<span class="bp-bridge-pin" style="--c:${VERDICT_COLOR[v]}">▲</span>`, iconSize: [18, 18] }) })
          .bindTooltip(`${b.name} — ${v}`, { direction: 'top' })
          .on('click', (ev: any) => { ev.originalEvent?.stopPropagation?.(); app.select({ kind: 'bridge', id: b.id }); })
          .addTo(groups.restrictions);
        mk.setOpacity(o);
      }
      const lk = data.restrictions.lock;
      const lm = L.marker([lk.lat, lk.lng], { icon: L.divIcon({ className: 'bp-lock', html: '<span class="bp-lock-pin">⚿</span>', iconSize: [18, 18] }) })
        .bindTooltip(lk.name, { direction: 'top' })
        .on('click', (ev: any) => { ev.originalEvent?.stopPropagation?.(); app.select({ kind: 'lock', id: lk.id }); })
        .addTo(groups.restrictions);
      lm.setOpacity(o);
    }

    // --- origin (START) — deliberately prominent: pulsing bullseye + a
    // permanent label, so it never gets lost in the network/markers ---
    if (app.origin)
      L.marker([app.origin.lat, app.origin.lng], {
        icon: L.divIcon({ className: 'bp-start', html: '<div class="bp-start-ring"></div><div class="bp-start-core"></div>', iconSize: [34, 34], iconAnchor: [17, 17] }),
        zIndexOffset: 2000, interactive: false,
      })
        .bindTooltip(`Start · ${app.origin.label}`, { permanent: true, direction: 'top', offset: [0, -12], className: 'bp-start-tip' })
        .addTo(groups.origin);
  }

  // Draw just the planned route (cheap; updates as the destination changes).
  function drawLegEdges(legs: { edges: { geometry: [number, number][] }[] }[]) {
    for (const leg of legs) for (const e of leg.edges)
      L.polyline(e.geometry, { color: '#1a1008', weight: 7, opacity: 0.5, lineCap: 'round' }).addTo(groups.route);
    for (const leg of legs) for (const e of leg.edges)
      L.polyline(e.geometry, { color: '#ffcf4a', weight: 3.4, opacity: 0.98, lineCap: 'round' }).addTo(groups.route);
  }

  function renderRoute() {
    if (!initialized) return;
    groups.route.clearLayers();

    // A multi-stop itinerary (e.g. from the AI planner) takes precedence.
    if (app.itinerary.length && app.itineraryLegs.length) {
      drawLegEdges(app.itineraryLegs);
      app.itinerary.forEach((nid, i) => {
        const n = app.data?.graph.nodes.find((x) => x.id === nid);
        if (!n) return;
        L.marker([n.lat, n.lng], {
          icon: L.divIcon({ className: 'bp-stop', html: `<div class="bp-stop-pin">${i + 1}</div>`, iconSize: [24, 24], iconAnchor: [12, 12] }),
          zIndexOffset: 1800, interactive: false,
        }).bindTooltip(`${i + 1}. ${app.nodeLabel(nid)}`, { permanent: true, direction: 'top', offset: [0, -12], className: 'bp-dest-tip' }).addTo(groups.route);
      });
      return;
    }

    // Otherwise a single ad-hoc destination route.
    const r = app.route;
    // Contextual hazard: a bridge that BLOCKS this route gets a red "!" marker.
    if (r?.blockedAt) {
      const b = r.blockedAt;
      L.marker([b.lat, b.lng], { icon: L.divIcon({ className: 'bp-warn', html: '<div class="bp-warn-pin red">!</div>', iconSize: [26, 26], iconAnchor: [13, 13] }), zIndexOffset: 2200, interactive: false })
        .bindTooltip(`Blocked: ${b.name}`, { permanent: true, direction: 'top', offset: [0, -14], className: 'bp-warn-tip red' }).addTo(groups.route);
    }
    if (!r?.edges.length) return;
    drawLegEdges([r]);
    // Tight (marginal) bridges: recolour their segment amber + amber "!" marker.
    for (const { bridge, verdict } of r.bridges) {
      if (verdict !== 'marginal') continue;
      for (const e of r.edges) if (e.restriction_ids?.includes(bridge.id)) L.polyline(e.geometry, { color: '#e69500', weight: 5.5, opacity: 0.98, lineCap: 'round' }).addTo(groups.route);
      L.marker([bridge.lat, bridge.lng], { icon: L.divIcon({ className: 'bp-warn', html: '<div class="bp-warn-pin amber">!</div>', iconSize: [24, 24], iconAnchor: [12, 12] }), zIndexOffset: 2100, interactive: false })
        .bindTooltip(`Tight: ${bridge.name}`, { permanent: true, direction: 'top', offset: [0, -13], className: 'bp-warn-tip amber' }).addTo(groups.route);
    }
    const dnId = app.destinationNode;
    const dn = dnId ? app.data?.graph.nodes.find((n) => n.id === dnId) : null;
    if (dn)
      L.marker([dn.lat, dn.lng], {
        icon: L.divIcon({ className: 'bp-dest', html: '<div class="bp-dest-pin">⚑</div>', iconSize: [30, 30], iconAnchor: [6, 26] }),
        zIndexOffset: 1900, interactive: false,
      })
        .bindTooltip(`Destination · ${app.nodeLabel(dnId!)}`, { permanent: true, direction: 'top', offset: [6, -22], className: 'bp-dest-tip' })
        .addTo(groups.route);
  }

  // effects: applyTheme only on theme change (no tile flicker on layer toggles);
  // renderBase tracks its own reads (incl. theme); renderRoute tracks the route.
  $effect(() => { app.mapTheme; if (initialized) applyTheme(); });
  $effect(() => { if (initialized) renderBase(); });
  $effect(() => { if (initialized) renderRoute(); });

  // live "you are here" marker + optional follow (own group, off the base render
  // path so a GPS fix doesn't redraw the whole network).
  $effect(() => {
    const u = app.userPosition;
    if (!initialized) return;
    groups.user.clearLayers();
    if (!u) return;
    if (u.accuracy && u.accuracy < 300)
      L.circle([u.lat, u.lng], { radius: u.accuracy, color: '#c4570a', weight: 1, opacity: 0.35, fillColor: '#c4570a', fillOpacity: 0.06 }).addTo(groups.user);
    const rot = u.heading == null ? 0 : u.heading;
    L.marker([u.lat, u.lng], {
      icon: L.divIcon({ className: 'bp-you', html: `<div class="bp-you-puck" style="transform:rotate(${rot}deg)"><span class="bp-you-arrow"></span></div>`, iconSize: [22, 22], iconAnchor: [11, 11] }),
      zIndexOffset: 3000, interactive: false,
    }).addTo(groups.user);
    if (app.followUser && app.cruiseActive) map.panTo([u.lat, u.lng], { animate: true, duration: 0.7 });
  });

  export function flyTo(lat: number, lng: number, zoom = 13) { map?.flyTo([lat, lng], zoom); }
  export function fitTo(points: [number, number][]) { if (map && points.length) map.fitBounds(points as any, { padding: [55, 55], maxZoom: 13 }); }
</script>

<div class="bp-map" bind:this={mapEl}></div>

<style>
  .bp-map { position: absolute; inset: 0; height: 100%; width: 100%; background: var(--bg); }
  /* Warm-brutalist "chart" — push standard OSM tiles toward parchment, kill blues. */
  :global(.bp-warm-tiles) { filter: sepia(0.5) saturate(0.72) hue-rotate(-12deg) brightness(1.06) contrast(0.92); }
  /* Schematic: desaturated + very faint so the network + layers read on top. */
  :global(.bp-schematic-tiles) { filter: grayscale(0.7) sepia(0.25) brightness(1.12) contrast(0.85); }
  :global(.bp-bridge-pin) { color: var(--c); font-size: 15px; line-height: 1; text-shadow: 0 0 2px #fff, 0 0 2px #fff; }
  :global(.bp-lock-pin) { color: #4527a0; font-size: 15px; text-shadow: 0 0 2px #fff, 0 0 2px #fff; }
  /* START marker: a high-contrast bullseye with a pulsing ring + permanent label. */
  :global(.bp-start-core) {
    position: absolute; left: 50%; top: 50%; width: 18px; height: 18px; margin: -9px 0 0 -9px;
    background: #fff; border: 3px solid #1a1008; border-radius: 50%; box-shadow: 0 1px 5px rgba(26, 16, 8, 0.55);
  }
  :global(.bp-start-core)::after { content: ''; position: absolute; inset: 3px; background: var(--accent); border-radius: 50%; }
  :global(.bp-start-ring) {
    position: absolute; left: 50%; top: 50%; width: 18px; height: 18px; margin: -9px 0 0 -9px;
    border: 2.5px solid var(--accent); border-radius: 50%; animation: bp-pulse 1.8s ease-out infinite;
  }
  @keyframes bp-pulse { 0% { transform: scale(0.7); opacity: 0.9; } 100% { transform: scale(3); opacity: 0; } }
  :global(.bp-start-tip), :global(.bp-dest-tip) {
    border: none; font-family: var(--font-mono); font-size: 10px; font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.04em; padding: 2px 6px; box-shadow: 0 2px 6px rgba(26, 16, 8, 0.3);
  }
  :global(.bp-start-tip) { background: #1a1008; color: #fff; }
  :global(.bp-start-tip)::before { border-top-color: #1a1008 !important; }
  :global(.bp-dest-tip) { background: var(--accent); color: #fff; }
  :global(.bp-dest-tip)::before { border-top-color: var(--accent) !important; }
  :global(.bp-dest-pin) { font-size: 22px; color: var(--accent); line-height: 1; text-shadow: 0 0 3px #fff, 0 0 3px #fff, 0 1px 2px rgba(0, 0, 0, 0.4); }
  :global(.bp-stop-pin) { width: 22px; height: 22px; border-radius: 50%; background: var(--accent); color: #fff; border: 2px solid #fff; font-family: var(--font-mono); font-size: 0.72rem; font-weight: 700; display: grid; place-items: center; box-shadow: 0 1px 4px rgba(26, 16, 8, 0.5); }
  /* contextual on-route bridge warnings */
  :global(.bp-warn-pin) { width: 100%; height: 100%; border-radius: 50%; color: #fff; font-family: var(--font-display); font-weight: 700; font-size: 13px; display: grid; place-items: center; border: 2px solid #fff; box-shadow: 0 1px 5px rgba(26, 16, 8, 0.6); }
  :global(.bp-warn-pin.red) { background: #c62828; }
  :global(.bp-warn-pin.amber) { background: #e69500; }
  :global(.bp-warn-tip) { border: none; font-family: var(--font-mono); font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; padding: 2px 6px; color: #fff; }
  :global(.bp-warn-tip.red) { background: #c62828; }
  :global(.bp-warn-tip.red)::before { border-top-color: #c62828 !important; }
  :global(.bp-warn-tip.amber) { background: #e69500; }
  :global(.bp-warn-tip.amber)::before { border-top-color: #e69500 !important; }
  /* live position puck with a heading arrow */
  :global(.bp-you-puck) { width: 18px; height: 18px; border-radius: 50%; background: #c4570a; border: 2px solid #fff; box-shadow: 0 1px 5px rgba(26, 16, 8, 0.6); position: relative; }
  :global(.bp-you-arrow) { position: absolute; top: -8px; left: 50%; margin-left: -5px; width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; border-bottom: 8px solid #c4570a; }
  @media (prefers-reduced-motion: reduce) { :global(.bp-start-ring) { animation: none; opacity: 0.55; } }
  :global(.leaflet-container) { font-family: var(--font-mono, monospace); background: #ece3d2; }
  :global(.leaflet-tooltip) { font-family: var(--font-mono, monospace); font-size: 11px; }
</style>
