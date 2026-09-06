<script lang="ts">
  import { loadMapbox, type MapLayer } from '$lib/maps/loader';
  import { onMount } from 'svelte';
  import { app } from '../lib/appState.svelte';
  import { bridgeVerdict, edgeVerdict } from '$lib/broads-pilot/passability';
  import { styleRoute, bandColor, speedDash, PASSED_COLOR } from '../lib/route-style';
  import type { Verdict, LatLng } from '$lib/broads-pilot/types';

  // Home view: the Richardsons hire base at Stalham — the default start and the
  // point the locked map pins to. Matches the `staithe-stalham` origin node.
  const HOME: [number, number] = [52.7772, 1.5072];
  const HOME_ZOOM = 13;

  let mapEl: HTMLDivElement;
  // Mapbox handles kept as plain refs (NOT $state) to avoid effect-update loops.
  let M: any;
  let map: any;
  let seamark: MapLayer;
  let mapError = $state<string | null>(null);
  const groups: Record<string, any> = {};
  let initialized = $state(false);
  function featureClick(ev: any, sel: any) {
    ev?.originalEvent?.stopPropagation?.();
    app.select(sel);
  }

  const TIER_COLOR: Record<string, string> = {
    ba_free: '#2e7d32', ba_staffed: '#558b2f', yacht_station: '#00695c',
    pub: '#b8860b', private: '#8d6e63', marina: '#6d4c41', hire_yard: '#c4570a',
  };
  const VERDICT_COLOR: Record<Verdict, string> = { pass: '#2e7d32', marginal: '#e69500', blocked: '#c62828' };
  const POI_COLOR: Record<string, string> = { pub: '#b8860b', walk: '#2e7d32', attraction: '#7b4fb0', shop: '#8d6e63', fuel: '#555' };
  const BASE = ['broads', 'network', 'zones', 'moorings', 'pois', 'restrictions', 'origin'];

  // Speed-limit overlay: higher limit = greener (more open water), slower = redder.
  function limitColor(mph: number): string {
    return mph >= 6 ? '#2e7d32' : mph >= 5 ? '#7cb342' : mph >= 4 ? '#e69500' : mph >= 3 ? '#d2602a' : '#c62828';
  }

  onMount(() => {
    let cancelled = false;
    let cleanup = () => {};
    (async () => {
      try {
        M = await loadMapbox();
        if (cancelled || !mapEl) return;
        map = M.map(mapEl, { zoomControl: true }).setView(HOME, HOME_ZOOM);
        // keep the +/- control clear of the docked sheet: bottom-left on desktop,
        // top-left on mobile (where the sheet is a bottom sheet).
        const mq = window.matchMedia('(min-width: 760px)');
        const setZoomPos = () => map.zoomControl?.setPosition(mq.matches ? 'bottomleft' : 'topleft');
        setZoomPos();
        mq.addEventListener?.('change', setZoomPos);
        seamark = M.raster('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', { opacity: 0.9, attribution: '© OpenSeaMap contributors' });
        // 'route' = static casing + markers; 'routeLive' = the coloured/dashed centre
        // lines (redrawn on each GPS fix while cruising, so markers don't flicker).
        for (const k of [...BASE, 'route', 'routeLive', 'user']) groups[k] = M.layerGroup().addTo(map);
        map.on('click', (e: any) => {
          // Origin is set explicitly via the Set-start picker. A plain map tap only
          // sets it when "pick a point" is armed — no surprise pin drops.
          if (app.pickingStart) { app.setOrigin(e.latlng.lat, e.latlng.lng, 'Custom point'); app.pickingStart = false; }
        });
        initialized = true;
        applyLock();
        cleanup = () => mq.removeEventListener?.('change', setZoomPos);
      } catch (err) { mapError = err instanceof Error ? err.message : 'Map unavailable'; }
    })();
    return () => { cancelled = true; initialized = false; cleanup(); map?.remove(); };
  });

  // Lock = pin the camera on the start and freeze pan/gesture-zoom (the +/-
  // buttons still work, zooming about the centred home). Unlock re-enables all.
  function applyLock() {
    if (!map) return;
    const handlers = ['dragging', 'scrollWheelZoom', 'doubleClickZoom', 'boxZoom', 'keyboard', 'touchZoom', 'tap'];
    if (app.mapLocked) {
      const o = app.origin;
      if (o) map.setView([o.lat, o.lng], Math.max(map.getZoom() ?? HOME_ZOOM, HOME_ZOOM), { animate: true });
      for (const h of handlers) map[h]?.disable?.();
    } else {
      for (const h of handlers) map[h]?.enable?.();
    }
  }

  function applyTheme() {
    if (!map) return;
    seamark?.remove();
    map.setTheme(app.mapTheme);
    if (app.mapTheme === 'nautical') seamark.addTo(map);
  }

  // Batch matching line styles so the waterway graph uses a handful of WebGL
  // sources instead of one source for each of its hundreds of edges.
  const lineBatches = new WeakMap<MapLayer, Map<string, { layer: MapLayer; lines: LatLng[][] }>>();
  function drawLine(group: MapLayer, points: LatLng[], options: Record<string, unknown>) {
    let batches = lineBatches.get(group);
    if (!batches) { batches = new Map(); lineBatches.set(group, batches); }
    const key = JSON.stringify(options);
    let batch = batches.get(key);
    if (!batch?.layer.map) {
      const lines = [points];
      batch = { layer: M.multiPolyline(lines, options).addTo(group), lines };
      batches.set(key, batch);
    } else {
      batch.lines.push(points);
      batch.layer.setLatLngs(batch.lines);
    }
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

    // Shared water palette so the broads + the navigable channels read as one
    // bold blue water system on the warm/nautical themes.
    const waterFill = app.mapTheme === 'nautical' ? '#1f8fd0' : '#2fa6cc';
    const waterStroke = app.mapTheme === 'nautical' ? '#0a3d62' : '#0d5563';

    // --- the broads themselves: bold open-water highlight (warm + nautical;
    // drawn first so the network + markers sit on top). The schematic theme has
    // its own treatment, so skip it there. ---
    if (!schematic) {
      for (const b of data.broads)
        for (const ring of b.rings)
          M.polygon(ring, { color: waterStroke, weight: 2.5, opacity: 0.95, fillColor: waterFill, fillOpacity: 0.55, lineJoin: 'round', interactive: false })
            .addTo(groups.broads);
    }

    // --- the waterway network ---
    if (schematic) {
      // only the riverways accessible to the selected boat are emphasised;
      // edges the boat can't pass are faint + dashed.
      for (const e of data.graph.edges) {
        const v = boat ? edgeVerdict(e, data.restrictions, boat) : 'pass';
        if (v === 'blocked')
          drawLine(groups.network, e.geometry, { color: '#9a4b00', weight: 1.5, opacity: 0.2, dashArray: '2 7' });
        else
          drawLine(groups.network, e.geometry, { color: '#c4570a', weight: v === 'marginal' ? 2.5 : 3.6, opacity: 0.92 });
      }
    } else if (app.showRangeRings && app.reachableActive) {
      const reach = app.reachableActive;
      for (const e of data.graph.edges) {
        const t = Math.min(reach.get(e.from)?.time_s ?? Infinity, reach.get(e.to)?.time_s ?? Infinity);
        if (t === Infinity) drawLine(groups.network, e.geometry, { color: '#6d4c41', weight: 1, opacity: 0.15 });
        else drawLine(groups.network, e.geometry, { color: timeBand(t), weight: 3.4, opacity: 0.85 });
      }
    } else if (app.layers.speed) {
      // colour the channel by its posted speed limit; tap a stretch for the number.
      for (const e of data.graph.edges)
        M.polyline(e.geometry, { color: limitColor(e.limit_mph), weight: 3.6, opacity: 0.9 })
          .bindTooltip(`${e.limit_mph} mph`, { sticky: true }).addTo(groups.network);
    } else {
      // default (warm/nautical): the navigable channels as bold blue water
      // ribbons, matching the broads. Only reaches the SELECTED BOAT can pass are
      // highlighted (a casing + blue fill); impassable reaches stay faint so you
      // can still see the channel exists but read at a glance it's not for you.
      for (const e of data.graph.edges) {
        const v = boat ? edgeVerdict(e, data.restrictions, boat) : 'pass';
        if (v === 'blocked') {
          drawLine(groups.network, e.geometry, { color: '#6d4c41', weight: 1.6, opacity: 0.28 });
        } else {
          drawLine(groups.network, e.geometry, { color: waterStroke, weight: 5.5, opacity: 0.5, lineCap: 'round', lineJoin: 'round' });
          drawLine(groups.network, e.geometry, { color: waterFill, weight: 3.4, opacity: 0.92, lineCap: 'round', lineJoin: 'round' });
        }
      }
    }

    // --- conservation / tidal zones (part of the Restrictions layer) ---
    if (shown(app.layers.restrictions)) {
      const o = op(app.layers.restrictions);
      for (const z of data.restrictions.zones) {
        const col = z.type === 'conservation' ? '#c62828' : z.type === 'tidal' ? '#e69500' : '#8d6e63';
        M.polygon(z.geometry, { color: col, weight: 1.5, opacity: 0.75 * o, fillColor: col, fillOpacity: 0.18 * o, dashArray: '5 4' })
          .bindTooltip(z.notes.split(' — ')[0], { sticky: true }).addTo(groups.zones);
      }
    }

    // --- moorings ---
    if (shown(app.layers.moorings)) {
      const o = op(app.layers.moorings);
      for (const m of data.moorings)
        M.circleMarker([m.lat, m.lng], { radius: 6, fillColor: TIER_COLOR[m.tier] ?? '#6d4c41', color: '#1a1008', weight: 1, fillOpacity: 0.95 * o, opacity: 0.9 * o })
          .bindTooltip(m.name, { direction: 'top' })
          .on('click', (ev: any) => featureClick(ev, { kind: 'mooring', id: m.id }))
          .addTo(groups.moorings);
    }

    // --- POIs (pubs / walks / attractions), per-kind toggle + dog filter.
    // Fuel is a practical service → rendered in the Services block below. ---
    for (const p of data.pois) {
      if (p.kind === 'fuel') continue;
      const on = p.kind === 'pub' ? app.layers.pubs : p.kind === 'walk' ? app.layers.walks : app.layers.attractions;
      if (!shown(on)) continue;
      if (app.dogOnly && (p.kind === 'pub' || p.kind === 'walk') && p.dog_friendly === false) continue;
      const o = op(on);
      M.circleMarker([p.lat, p.lng], { radius: 4, fillColor: POI_COLOR[p.kind] ?? '#555', color: POI_COLOR[p.kind] ?? '#555', weight: 0, fillOpacity: 0.92 * o, opacity: 0.92 * o })
        .bindTooltip(p.name, { direction: 'top' })
        .on('click', (ev: any) => featureClick(ev, { kind: 'poi', id: p.id }))
        .addTo(groups.pois);
    }

    // --- practical SERVICES: fuel pumps + moorings with pump-out / water /
    // shore power, badged so you can see at a glance where to top up ---
    if (app.layers.services) {
      for (const p of data.pois) {
        if (p.kind !== 'fuel') continue;
        M.marker([p.lat, p.lng], { icon: M.divIcon({ className: 'bp-svc', html: '<span class="bp-svc-pin"><svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="4" width="7" height="13" rx="1"/><line x1="4.5" y1="8.5" x2="11.5" y2="8.5"/><path d="M11.5 7h2a1.5 1.5 0 0 1 1.5 1.5V13a1.3 1.3 0 0 0 2.6 0V8l-1.6-2"/></svg></span>', iconSize: [22, 22], iconAnchor: [11, 11] }) })
          .bindTooltip(`${p.name} — fuel`, { direction: 'top' })
          .on('click', (ev: any) => featureClick(ev, { kind: 'poi', id: p.id }))
          .addTo(groups.pois);
      }
      for (const m of data.moorings) {
        const svc: string[] = [];
        if (m.facilities.pump_out) svc.push('P');
        if (m.facilities.water) svc.push('W');
        if (m.facilities.shore_power) svc.push('E');
        if (!svc.length) continue;
        const tip = [m.facilities.pump_out && 'pump-out', m.facilities.water && 'water', m.facilities.shore_power && 'shore power'].filter(Boolean).join(' · ');
        M.marker([m.lat, m.lng], { icon: M.divIcon({ className: 'bp-svc', html: `<span class="bp-svc-badge">${svc.join('')}</span>`, iconSize: [0, 0], iconAnchor: [-7, 18] }) })
          .bindTooltip(`${m.name} — ${tip}`, { direction: 'top' })
          .on('click', (ev: any) => featureClick(ev, { kind: 'mooring', id: m.id }))
          .addTo(groups.pois);
      }
    }

    // --- bridges (verdict-coloured) + the lock ---
    if (shown(app.layers.restrictions) && boat) {
      const o = op(app.layers.restrictions);
      for (const b of data.restrictions.bridges) {
        const v = bridgeVerdict(b, boat);
        const mk = M.marker([b.lat, b.lng], { icon: M.divIcon({ className: 'bp-bridge', html: `<span class="bp-bridge-pin" style="--c:${VERDICT_COLOR[v]}">▲</span>`, iconSize: [18, 18] }) })
          .bindTooltip(`${b.name} — ${v}`, { direction: 'top' })
          .on('click', (ev: any) => featureClick(ev, { kind: 'bridge', id: b.id }))
          .addTo(groups.restrictions);
        mk.setOpacity(o);
      }
      const lk = data.restrictions.lock;
      const lm = M.marker([lk.lat, lk.lng], { icon: M.divIcon({ className: 'bp-lock', html: '<span class="bp-lock-pin">⚿</span>', iconSize: [18, 18] }) })
        .bindTooltip(lk.name, { direction: 'top' })
        .on('click', (ev: any) => featureClick(ev, { kind: 'lock', id: lk.id }))
        .addTo(groups.restrictions);
      lm.setOpacity(o);
    }

    // --- origin (START) — deliberately prominent: pulsing bullseye + a
    // permanent label, so it never gets lost in the network/markers ---
    if (app.origin)
      M.marker([app.origin.lat, app.origin.lng], {
        icon: M.divIcon({ className: 'bp-start', html: '<div class="bp-start-ring"></div><div class="bp-start-core"></div>', iconSize: [34, 34], iconAnchor: [17, 17] }),
        zIndexOffset: 2000, interactive: false,
      })
        .bindTooltip(`Start · ${app.origin.label}`, { permanent: true, direction: 'top', offset: [0, -12], className: 'bp-start-tip' })
        .addTo(groups.origin);
  }

  // The legs currently on the map: a multi-stop itinerary takes precedence over
  // a single ad-hoc destination route.
  function currentLegs(): { edges: any[] }[] {
    if (app.itinerary.length && app.itineraryLegs.length) return app.itineraryLegs;
    return app.route?.edges.length ? [app.route] : [];
  }

  // dark casing — static (doesn't depend on time/position), into groups.route.
  function drawCasing(legs: { edges: any[] }[]) {
    for (const leg of legs) for (const e of leg.edges)
      drawLine(groups.route, e.geometry, { color: '#1a1008', weight: 7, opacity: 0.5, lineCap: 'round' });
  }

  // coloured + dashed centre line into groups.routeLive: COLOUR = cumulative
  // travel-time band (isochrone), DASH = posted speed limit. While cruising the
  // clock zeroes at the live position and already-cruised edges render grey.
  function drawCenterlines(legs: { edges: any[] }[], from: LatLng | null) {
    for (const s of styleRoute(legs, { from })) {
      const color = s.passed ? PASSED_COLOR : bandColor(s.midT);
      drawLine(groups.routeLive, s.edge.geometry, {
        color, weight: 4, opacity: s.passed ? 0.5 : 0.98, lineCap: 'round', lineJoin: 'round',
        dashArray: speedDash(s.edge.limit_mph),
      });
    }
  }

  function warnMarker(lat: number, lng: number, cls: 'red' | 'amber', label: string) {
    const big = cls === 'red';
    M.marker([lat, lng], {
      icon: M.divIcon({ className: 'bp-warn', html: `<div class="bp-warn-pin ${cls}">!</div>`, iconSize: big ? [26, 26] : [24, 24], iconAnchor: big ? [13, 13] : [12, 12] }),
      zIndexOffset: big ? 2200 : 2100, interactive: false,
    }).bindTooltip(label, { permanent: true, direction: 'top', offset: [0, big ? -14 : -13], className: `bp-warn-tip ${cls}` }).addTo(groups.route);
  }

  // Static route layer: casing + stop/destination/hazard markers. Deliberately
  // does NOT read userPosition, so a GPS fix doesn't tear these down (only the
  // centre lines, in their own effect, react to position).
  function renderRoute() {
    if (!initialized) return;
    groups.route.clearLayers();

    // A multi-stop itinerary (e.g. from the AI planner) takes precedence.
    if (app.itinerary.length && app.itineraryLegs.length) {
      drawCasing(app.itineraryLegs);
      app.itinerary.forEach((nid, i) => {
        const n = app.data?.graph.nodes.find((x) => x.id === nid);
        if (!n) return;
        M.marker([n.lat, n.lng], {
          icon: M.divIcon({ className: 'bp-stop', html: `<div class="bp-stop-pin">${i + 1}</div>`, iconSize: [24, 24], iconAnchor: [12, 12] }),
          zIndexOffset: 1800, interactive: false,
        }).bindTooltip(`${i + 1}. ${app.nodeLabel(nid)}`, { permanent: true, direction: 'top', offset: [0, -12], className: 'bp-dest-tip' }).addTo(groups.route);
      });
      // Hazard markers across every leg (the line colour no longer encodes
      // passability) — deduped so a shared bridge isn't stacked.
      const seen = new Set<string>();
      for (const leg of app.itineraryLegs) {
        if (leg.blockedAt && !seen.has('b:' + leg.blockedAt.id)) { seen.add('b:' + leg.blockedAt.id); warnMarker(leg.blockedAt.lat, leg.blockedAt.lng, 'red', `Blocked: ${leg.blockedAt.name}`); }
        for (const { bridge, verdict } of leg.bridges) {
          if (verdict !== 'marginal' || seen.has('m:' + bridge.id)) continue;
          seen.add('m:' + bridge.id);
          warnMarker(bridge.lat, bridge.lng, 'amber', `Tight: ${bridge.name}`);
        }
      }
      return;
    }

    // Otherwise a single ad-hoc destination route.
    const r = app.route;
    if (r?.blockedAt) warnMarker(r.blockedAt.lat, r.blockedAt.lng, 'red', `Blocked: ${r.blockedAt.name}`);
    if (!r?.edges.length) return;
    drawCasing([r]);
    // Tight (marginal) bridges: an amber "!" marker. (The line colour now encodes
    // travel time, so the hazard lives on the marker, not a segment recolour.)
    for (const { bridge, verdict } of r.bridges)
      if (verdict === 'marginal') warnMarker(bridge.lat, bridge.lng, 'amber', `Tight: ${bridge.name}`);
    const dnId = app.destinationNode;
    const dn = dnId ? app.data?.graph.nodes.find((n) => n.id === dnId) : null;
    if (dn)
      M.marker([dn.lat, dn.lng], {
        icon: M.divIcon({ className: 'bp-dest', html: '<div class="bp-dest-pin">⚑</div>', iconSize: [30, 30], iconAnchor: [6, 26] }),
        zIndexOffset: 1900, interactive: false,
      })
        .bindTooltip(`Destination · ${app.nodeLabel(dnId!)}`, { permanent: true, direction: 'top', offset: [6, -22], className: 'bp-dest-tip' })
        .addTo(groups.route);
  }

  // The coloured/dashed centre lines: own group + effect so they re-render on a
  // GPS fix (live isochrone) without churning the static casing/markers/tooltips.
  function renderCenterlines() {
    if (!initialized) return;
    groups.routeLive.clearLayers();
    const from: LatLng | null = app.cruiseActive && app.userPosition ? [app.userPosition.lat, app.userPosition.lng] : null;
    drawCenterlines(currentLegs(), from);
  }

  // effects: applyTheme only on theme change (no tile flicker on layer toggles);
  // renderBase tracks its own reads (incl. theme); renderRoute tracks the route.
  $effect(() => { app.mapTheme; if (initialized) applyTheme(); });
  $effect(() => { if (initialized) renderBase(); });
  // static route layer (casing + markers): tracks route/itinerary, NOT position.
  $effect(() => { if (initialized) renderRoute(); });
  // live centre lines: tracks the route AND the live position, so a GPS fix
  // recolours only this layer (no marker/tooltip flicker).
  $effect(() => { app.cruiseActive; app.userPosition; if (initialized) renderCenterlines(); });
  // re-pin / free the camera when the lock (or the start it pins to) changes.
  $effect(() => { app.mapLocked; app.origin; if (initialized) applyLock(); });

  // live "you are here" marker + optional follow (own group, off the base render
  // path so a GPS fix doesn't redraw the whole network).
  $effect(() => {
    const u = app.userPosition;
    if (!initialized) return;
    groups.user.clearLayers();
    if (!u) return;
    if (u.accuracy && u.accuracy < 300)
      M.circle([u.lat, u.lng], { radius: u.accuracy, color: '#c4570a', weight: 1, opacity: 0.35, fillColor: '#c4570a', fillOpacity: 0.06 }).addTo(groups.user);
    const rot = u.heading == null ? 0 : u.heading;
    M.marker([u.lat, u.lng], {
      icon: M.divIcon({ className: 'bp-you', html: `<div class="bp-you-puck" style="transform:rotate(${rot}deg)"><span class="bp-you-arrow"></span></div>`, iconSize: [22, 22], iconAnchor: [11, 11] }),
      zIndexOffset: 3000, interactive: false,
    }).addTo(groups.user);
    if (app.followUser && app.cruiseActive) map.panTo([u.lat, u.lng], { animate: true, duration: 0.7 });
  });

  // Programmatic camera moves (search pick, AI itinerary, "my location") free
  // the lock first, so the move isn't immediately yanked back to home.
  export function flyTo(lat: number, lng: number, zoom = 13) { if (app.mapLocked) app.unlockMap(); map?.flyTo([lat, lng], zoom); }
  export function fitTo(points: [number, number][]) { if (app.mapLocked) app.unlockMap(); if (map && points.length) map.fitBounds(points as any, { padding: [55, 55], maxZoom: 13 }); }
</script>

<div class="bp-map" bind:this={mapEl}></div>
{#if mapError}<p class="sr-map-status" role="alert">{mapError}</p>{/if}

<style>
  .bp-map { position: absolute; inset: 0; height: 100%; width: 100%; background: var(--bg); }
  :global(.bp-bridge-pin) { color: var(--c); font-size: var(--fs-body-sm); line-height: 1; text-shadow: 0 0 2px #fff, 0 0 2px #fff; }
  :global(.bp-lock-pin) { color: #4527a0; font-size: var(--fs-body-sm); text-shadow: 0 0 2px #fff, 0 0 2px #fff; }
  /* practical services: fuel glyph + mooring service badge */
  :global(.bp-svc-pin) { font-size: var(--fs-body-sm); line-height: 1; filter: drop-shadow(0 0 2px #fff) drop-shadow(0 0 2px #fff); }
  :global(.bp-svc-badge) { display: inline-block; white-space: nowrap; background: #00695c; color: #fff; font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 700; letter-spacing: 0.04em; padding: 1px 4px; border-radius: 4px; border: 1px solid #fff; box-shadow: 0 1px 3px rgba(26, 16, 8, 0.5); }
  /* START marker: a high-contrast bullseye with a pulsing ring + permanent label. */
  :global(.bp-start-core) {
    position: absolute; left: 50%; top: 50%; width: 18px; height: 18px; margin: -9px 0 0 -9px;
    background: #fff; border: 3px solid #1a1008; border-radius: var(--radius-pill); box-shadow: 0 1px 5px rgba(26, 16, 8, 0.55);
  }
  :global(.bp-start-core)::after { content: ''; position: absolute; inset: 3px; background: var(--accent); border-radius: var(--radius-pill); }
  :global(.bp-start-ring) {
    position: absolute; left: 50%; top: 50%; width: 18px; height: 18px; margin: -9px 0 0 -9px;
    border: 2.5px solid var(--accent); border-radius: var(--radius-pill); animation: bp-pulse 1.8s ease-out infinite;
  }
  @keyframes bp-pulse { 0% { transform: scale(0.7); opacity: 0.9; } 100% { transform: scale(3); opacity: 0; } }
  :global(.bp-start-tip), :global(.bp-dest-tip) {
    border: none; font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600;
    text-transform: uppercase; letter-spacing: 0.04em; padding: 2px 6px; box-shadow: 0 2px 6px rgba(26, 16, 8, 0.3);
  }
  :global(.bp-start-tip) { background: #1a1008; color: #fff; }
  :global(.bp-start-tip)::before { border-top-color: #1a1008 !important; }
  :global(.bp-dest-tip) { background: var(--accent); color: #fff; }
  :global(.bp-dest-tip)::before { border-top-color: var(--accent) !important; }
  :global(.bp-dest-pin) { font-size: 22px; color: var(--accent); line-height: 1; text-shadow: 0 0 3px #fff, 0 0 3px #fff, 0 1px 2px rgba(0, 0, 0, 0.4); }
  :global(.bp-stop-pin) { width: 22px; height: 22px; border-radius: var(--radius-pill); background: var(--accent); color: #fff; border: 2px solid #fff; font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 700; display: grid; place-items: center; box-shadow: 0 1px 4px rgba(26, 16, 8, 0.5); }
  /* contextual on-route bridge warnings */
  :global(.bp-warn-pin) { width: 100%; height: 100%; border-radius: var(--radius-pill); color: #fff; font-family: var(--font-display); font-weight: 700; font-size: var(--fs-label); display: grid; place-items: center; border: 2px solid #fff; box-shadow: 0 1px 5px rgba(26, 16, 8, 0.6); }
  :global(.bp-warn-pin.red) { background: #c62828; }
  :global(.bp-warn-pin.amber) { background: #e69500; }
  :global(.bp-warn-tip) { border: none; font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; padding: 2px 6px; color: #fff; }
  :global(.bp-warn-tip.red) { background: #c62828; }
  :global(.bp-warn-tip.red)::before { border-top-color: #c62828 !important; }
  :global(.bp-warn-tip.amber) { background: #e69500; }
  :global(.bp-warn-tip.amber)::before { border-top-color: #e69500 !important; }
  /* live position puck with a heading arrow */
  :global(.bp-you-puck) { width: 18px; height: 18px; border-radius: var(--radius-pill); background: #c4570a; border: 2px solid #fff; box-shadow: 0 1px 5px rgba(26, 16, 8, 0.6); position: relative; }
  :global(.bp-you-arrow) { position: absolute; top: -8px; left: 50%; margin-left: -5px; width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; border-bottom: 8px solid #c4570a; }
  @media (prefers-reduced-motion: reduce) { :global(.bp-start-ring) { animation: none; opacity: 0.55; } }
  :global(.mapboxgl-map) { font-family: var(--font-mono, monospace); background: #ece3d2; }
  :global(.mapboxgl-popup-content) { font-family: var(--font-mono, monospace); font-size: var(--fs-label-xs); }
  /* On mobile the +/- control sits top-left, where the search bar lives — push
     it clear of the bar so the two don't overlap. */
  @media (max-width: 759px) {
    :global(.mapboxgl-ctrl-top-left) { margin-top: 3.4rem; }
  }
</style>
