<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { decodePolyline } from '$lib/health/polyline';
  import type { FeaturedActivity } from '$lib/health/featured-activities-service';

  let { activities }: { activities: FeaturedActivity[] } = $props();

  function fmtDistanceKm(m: number): string {
    return (m / 1000).toFixed(1);
  }
  function fmtDuration(s: number): string {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0) return `${h}h ${m.toString().padStart(2, '0')}m`;
    return `${m}m`;
  }
  function fmtDurationCompact(s: number): string {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0) return `${h}h${m.toString().padStart(2, '0')}`;
    return `${m}m`;
  }
  function fmtDate(unix: number): string {
    return new Date(unix * 1000).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }
  function fmtTimeOfDay(localIso: string): string {
    const m = /T(\d{2}:\d{2})/.exec(localIso);
    return m ? m[1] : '—';
  }
  function fmtSpeedKmh(ms: number): string {
    return (ms * 3.6).toFixed(1);
  }
  function fmtPace(speedMs: number): string {
    if (speedMs <= 0) return '—';
    const sec = 1000 / speedMs;
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }
  function sportLabel(sportType: string, type: string): string {
    return (sportType || type).replace(/([a-z])([A-Z])/g, '$1 $2').toUpperCase();
  }
  function isCycling(type: string): boolean {
    const t = (type || '').toLowerCase();
    return t.includes('ride') || t.includes('cycle');
  }
  function vamMetersPerHour(elevM: number, movingS: number): number | null {
    if (!elevM || !movingS) return null;
    return Math.round((elevM * 3600) / movingS);
  }

  // ---------- Static SVG preview (SSR-friendly fallback) ----------
  type SvgRoute = { points: string; aspectRatio: number } | null;
  function buildSvgRoute(polyline: string | null): SvgRoute {
    if (!polyline) return null;
    const coords = decodePolyline(polyline);
    if (coords.length < 2) return null;
    const lats = coords.map((p) => p[0]);
    const lngs = coords.map((p) => p[1]);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const padding = 0.001;
    const w = maxLng - minLng + padding * 2;
    const h = maxLat - minLat + padding * 2;
    const meanLat = (minLat + maxLat) / 2;
    const lngScale = Math.cos((meanLat * Math.PI) / 180);
    const wScaled = w * lngScale;
    const points = coords
      .map(([lat, lng]) => {
        const x = (((lng - minLng + padding) * lngScale) / wScaled) * 100;
        const y = ((maxLat - lat + padding) / h) * 100;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');
    return { points, aspectRatio: wScaled / h };
  }

  // ---------- Leaflet (lazy, client-only) ----------
  let mapEls: Record<number, HTMLDivElement | null> = $state({});
  const mapInstances: Record<number, any> = {};
  let leafletReady = false;
  let leafletLoading: Promise<void> | null = null;
  let observer: IntersectionObserver | null = null;

  function loadLeaflet(): Promise<void> {
    if (leafletReady) return Promise.resolve();
    if (leafletLoading) return leafletLoading;

    leafletLoading = new Promise<void>((resolve, reject) => {
      // CSS
      if (!document.querySelector('link[data-leaflet]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = '/vendor/leaflet.min.css';
        link.setAttribute('data-leaflet', '1');
        document.head.appendChild(link);
      }
      // JS
      if ((window as any).L) {
        leafletReady = true;
        resolve();
        return;
      }
      const existing = document.querySelector('script[data-leaflet]') as HTMLScriptElement | null;
      if (existing) {
        existing.addEventListener('load', () => {
          leafletReady = true;
          resolve();
        });
        existing.addEventListener('error', () => reject(new Error('leaflet load failed')));
        return;
      }
      const script = document.createElement('script');
      script.src = '/vendor/leaflet.min.js';
      script.async = true;
      script.setAttribute('data-leaflet', '1');
      script.onload = () => {
        leafletReady = true;
        resolve();
      };
      script.onerror = () => reject(new Error('leaflet load failed'));
      document.head.appendChild(script);
    });
    return leafletLoading;
  }

  async function initMap(activity: FeaturedActivity) {
    const el = mapEls[activity.id];
    if (!el || mapInstances[activity.id] || !activity.polyline) return;
    try {
      await loadLeaflet();
    } catch {
      return;
    }
    const L = (window as any).L;
    if (!L) return;

    const coords = decodePolyline(activity.polyline);
    if (coords.length < 2) return;

    const tileUrl = isCycling(activity.sportType || activity.type)
      ? 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png'
      : 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png';
    const attribution = isCycling(activity.sportType || activity.type)
      ? '&copy; OpenStreetMap, &copy; CARTO'
      : '&copy; OpenStreetMap · &copy; OpenTopoMap (CC-BY-SA)';

    const map = L.map(el, {
      zoomControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      touchZoom: false,
      boxZoom: false,
      keyboard: false,
      attributionControl: true,
    });

    L.tileLayer(tileUrl, {
      attribution,
      maxZoom: 17,
      subdomains: 'abc',
    }).addTo(map);

    const accent = getComputedStyle(document.documentElement)
      .getPropertyValue('--accent')
      .trim() || '#c4570a';

    // Subtle dark casing under the bright accent line for contrast over busy tiles.
    L.polyline(coords, {
      color: '#000',
      weight: 5,
      opacity: 0.35,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(map);
    const route = L.polyline(coords, {
      color: accent,
      weight: 3,
      opacity: 1,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(map);

    // Start/end markers
    const startCoord = coords[0];
    const endCoord = coords[coords.length - 1];
    L.circleMarker(startCoord, {
      radius: 5,
      color: '#fff',
      weight: 2,
      fillColor: accent,
      fillOpacity: 1,
    }).addTo(map);
    if (Math.hypot(startCoord[0] - endCoord[0], startCoord[1] - endCoord[1]) > 0.0005) {
      L.circleMarker(endCoord, {
        radius: 5,
        color: accent,
        weight: 2,
        fillColor: '#fff',
        fillOpacity: 1,
      }).addTo(map);
    }

    map.fitBounds(route.getBounds(), { padding: [16, 16] });
    el.classList.add('has-map');
    mapInstances[activity.id] = map;
  }

  onMount(() => {
    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) {
      // Init eagerly if no IO available.
      for (const a of activities) initMap(a);
      return;
    }
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const id = Number((entry.target as HTMLElement).dataset.activityId);
          const a = activities.find((x) => x.id === id);
          if (a) initMap(a);
          observer?.unobserve(entry.target);
        }
      },
      { rootMargin: '200px 0px' },
    );
    queueMicrotask(() => {
      for (const a of activities) {
        const el = mapEls[a.id];
        if (el) observer!.observe(el);
      }
    });
  });

  onDestroy(() => {
    observer?.disconnect();
    for (const id of Object.keys(mapInstances)) {
      try { mapInstances[Number(id)].remove(); } catch {}
    }
  });
</script>

{#if activities.length}
  <div class="epic-grid">
    {#each activities as a (a.id)}
      {@const route = buildSvgRoute(a.polyline)}
      {@const cycling = isCycling(a.sportType || a.type)}
      {@const stopped = Math.max(0, a.elapsedTimeS - a.movingTimeS)}
      {@const vam = vamMetersPerHour(a.elevationM, a.movingTimeS)}
      <article class="epic-card">
        <div
          class="epic-trace"
          bind:this={mapEls[a.id]}
          data-activity-id={a.id}
          aria-label="GPS trace for {a.name}"
        >
          {#if route}
            <svg
              class="epic-svg-fallback"
              viewBox="0 0 100 100"
              preserveAspectRatio="xMidYMid meet"
              aria-hidden="true"
            >
              <polyline
                points={route.points}
                fill="none"
                stroke="var(--accent)"
                stroke-width="1.4"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          {:else}
            <div class="epic-trace-empty">NO GPS TRACE</div>
          {/if}
        </div>

        <div class="epic-body">
          <p class="epic-meta">
            <span class="epic-sport">{sportLabel(a.sportType, a.type)}</span>
            <span class="epic-dot">·</span>
            <span class="epic-date">{fmtDate(a.startDate)}</span>
            <span class="epic-dot">·</span>
            <span>STARTED {fmtTimeOfDay(a.startDateLocal)}</span>
          </p>
          <h3 class="epic-title">{a.name}</h3>
          {#if a.caption}
            <p class="epic-caption">{a.caption}</p>
          {/if}

          <dl class="epic-stats">
            <div class="epic-stat">
              <dt>DISTANCE</dt>
              <dd>{fmtDistanceKm(a.distanceM)} <span>km</span></dd>
            </div>
            <div class="epic-stat">
              <dt>ELEVATION</dt>
              <dd>{Math.round(a.elevationM)} <span>m</span></dd>
            </div>
            <div class="epic-stat">
              <dt>MOVING</dt>
              <dd>{fmtDuration(a.movingTimeS)}</dd>
            </div>
            <div class="epic-stat">
              <dt>ELAPSED</dt>
              <dd>{fmtDuration(a.elapsedTimeS)}</dd>
            </div>
            {#if stopped > 60}
              <div class="epic-stat">
                <dt>STOPPED</dt>
                <dd>{fmtDurationCompact(stopped)}</dd>
              </div>
            {/if}
            {#if cycling}
              <div class="epic-stat">
                <dt>AVG SPEED</dt>
                <dd>{fmtSpeedKmh(a.averageSpeedMs)} <span>km/h</span></dd>
              </div>
            {:else}
              <div class="epic-stat">
                <dt>AVG PACE</dt>
                <dd>{fmtPace(a.averageSpeedMs)} <span>/km</span></dd>
              </div>
            {/if}
            {#if vam != null}
              <div class="epic-stat" title="Vertical ascent meters per hour">
                <dt>VAM</dt>
                <dd>{vam} <span>m/h</span></dd>
              </div>
            {/if}
            {#if a.averageHeartrate}
              <div class="epic-stat">
                <dt>AVG HR</dt>
                <dd>{Math.round(a.averageHeartrate)} <span>bpm</span></dd>
              </div>
            {/if}
            {#if a.maxHeartrate}
              <div class="epic-stat">
                <dt>MAX HR</dt>
                <dd>{Math.round(a.maxHeartrate)} <span>bpm</span></dd>
              </div>
            {/if}
            {#if a.calories}
              <div class="epic-stat">
                <dt>CALORIES</dt>
                <dd>{Math.round(a.calories)} <span>kcal</span></dd>
              </div>
            {/if}
            {#if a.sufferScore != null}
              <div class="epic-stat" title="Strava Relative Effort, intensity-weighted by HR zones">
                <dt>EFFORT</dt>
                <dd>{a.sufferScore}</dd>
              </div>
            {/if}
          </dl>

          <p class="epic-foot">
            <a class="epic-link" href={`https://www.strava.com/activities/${a.id}`} target="_blank" rel="noopener noreferrer">
              VIEW ON STRAVA →
            </a>
          </p>
        </div>
      </article>
    {/each}
  </div>
{/if}

<style>
  .epic-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
    gap: 32px;
  }

  .epic-card {
    border: 1px solid var(--divider);
    background: var(--card-bg, var(--bg));
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .epic-trace {
    position: relative;
    width: 100%;
    height: 320px;
    background: var(--bg-section, rgba(0, 0, 0, 0.04));
    border-bottom: 1px solid var(--divider);
    overflow: hidden;
    z-index: 0;
  }
  .epic-trace :global(.leaflet-container) {
    width: 100%;
    height: 100%;
    background: var(--bg-section, rgba(0, 0, 0, 0.04));
    font-family: var(--font-mono);
  }
  .epic-trace :global(.leaflet-control-attribution) {
    background: rgba(255, 255, 255, 0.8);
    color: #444;
    font-size: 9px;
    letter-spacing: 0.04em;
    padding: 1px 6px;
  }
  .epic-trace :global(.leaflet-control-attribution a) {
    color: #444;
    text-decoration: none;
  }
  .epic-svg-fallback {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    padding: 16px;
    box-sizing: border-box;
    pointer-events: none;
  }
  .epic-trace.has-map .epic-svg-fallback {
    display: none;
  }
  .epic-trace-empty {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.18em;
    color: var(--text-ghost);
  }

  .epic-body {
    padding: 20px 22px 22px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .epic-meta {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--text-ghost);
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }
  .epic-sport {
    color: var(--accent);
  }
  .epic-dot {
    color: var(--text-whisper, var(--text-ghost));
  }

  .epic-title {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 24px;
    text-transform: uppercase;
    letter-spacing: -0.015em;
    line-height: 1.1;
    color: var(--text-primary);
  }

  .epic-caption {
    margin: 0;
    font-size: 13px;
    line-height: 1.5;
    color: var(--text-secondary);
  }

  .epic-stats {
    margin: 8px 0 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
    gap: 14px 22px;
    border-top: 1px solid var(--divider);
    padding-top: 16px;
  }
  .epic-stat {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .epic-stat dt {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.18em;
    color: var(--text-ghost);
    text-transform: uppercase;
  }
  .epic-stat dd {
    margin: 0;
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 22px;
    line-height: 1.1;
    color: var(--text-primary);
  }
  .epic-stat dd span {
    font-family: var(--font-mono);
    font-weight: 400;
    font-size: 11px;
    color: var(--text-ghost);
    margin-left: 2px;
  }

  .epic-foot {
    margin: 14px 0 0;
    padding-top: 12px;
    border-top: 1px solid var(--divider);
  }
  .epic-link {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.2em;
    color: var(--accent);
    text-decoration: none;
  }
  .epic-link:hover {
    text-decoration: underline;
  }

  @media (max-width: 720px) {
    .epic-grid {
      grid-template-columns: 1fr;
      gap: 22px;
    }
    .epic-trace {
      height: 240px;
    }
    .epic-title {
      font-size: 20px;
    }
    .epic-stat dd {
      font-size: 18px;
    }
  }
</style>
