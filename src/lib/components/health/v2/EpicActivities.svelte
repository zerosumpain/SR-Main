<script lang="ts">
  import { decodePolyline } from '$lib/health/polyline';
  import type { FeaturedActivity } from '$lib/health/featured-activities-service';

  let { activities }: { activities: FeaturedActivity[] } = $props();

  function formatDistance(m: number): string {
    return (m / 1000).toFixed(1);
  }

  function formatDuration(s: number): string {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (h > 0) return `${h}h ${m.toString().padStart(2, '0')}m`;
    return `${m}m`;
  }

  function formatDate(unix: number): string {
    return new Date(unix * 1000).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  function sportLabel(sportType: string, type: string): string {
    return (sportType || type).replace(/([a-z])([A-Z])/g, '$1 $2').toUpperCase();
  }

  type SvgRoute = { points: string; viewBox: string; aspectRatio: number } | null;

  function buildRoute(polyline: string | null): SvgRoute {
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
    const width = maxLng - minLng + padding * 2;
    const height = maxLat - minLat + padding * 2;

    // Mercator-ish: scale longitude by cos(lat) so the trace doesn't squash at high latitudes.
    const meanLat = (minLat + maxLat) / 2;
    const lngScale = Math.cos((meanLat * Math.PI) / 180);
    const widthScaled = width * lngScale;

    const points = coords
      .map(([lat, lng]) => {
        const x = (((lng - minLng + padding) * lngScale) / widthScaled) * 100;
        const y = ((maxLat - lat + padding) / height) * 100;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');
    return { points, viewBox: '0 0 100 100', aspectRatio: widthScaled / height };
  }
</script>

{#if activities.length}
  <div class="epic-grid">
    {#each activities as a (a.id)}
      {@const route = buildRoute(a.polyline)}
      <article class="epic-card">
        <div class="epic-trace" style="aspect-ratio: {route ? Math.max(0.6, Math.min(2.2, route.aspectRatio)) : 1.6};">
          {#if route}
            <svg viewBox={route.viewBox} preserveAspectRatio="xMidYMid meet">
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
            <span class="epic-date">{formatDate(a.startDate)}</span>
          </p>
          <h3 class="epic-title">{a.name}</h3>
          {#if a.caption}
            <p class="epic-caption">{a.caption}</p>
          {/if}

          <dl class="epic-stats">
            <div class="epic-stat">
              <dt>DISTANCE</dt>
              <dd>{formatDistance(a.distanceM)} <span>km</span></dd>
            </div>
            <div class="epic-stat">
              <dt>ELEVATION</dt>
              <dd>{Math.round(a.elevationM)} <span>m</span></dd>
            </div>
            <div class="epic-stat">
              <dt>MOVING</dt>
              <dd>{formatDuration(a.movingTimeS)}</dd>
            </div>
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
            {#if a.sufferScore != null}
              <div class="epic-stat">
                <dt>EFFORT</dt>
                <dd>{a.sufferScore}</dd>
              </div>
            {/if}
          </dl>
        </div>
      </article>
    {/each}
  </div>
{/if}

<style>
  .epic-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
    gap: 28px;
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
    background:
      linear-gradient(to bottom, rgba(196, 87, 10, 0.04), transparent),
      var(--bg-section, rgba(0, 0, 0, 0.02));
    border-bottom: 1px solid var(--divider);
    padding: 16px;
    box-sizing: border-box;
  }
  .epic-trace svg {
    width: 100%;
    height: 100%;
    display: block;
  }
  .epic-trace-empty {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.18em;
    color: var(--text-ghost);
  }

  .epic-body {
    padding: 18px 20px 20px;
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
    font-size: 22px;
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
    margin: 6px 0 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
    gap: 12px 20px;
    border-top: 1px solid var(--divider);
    padding-top: 14px;
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

  @media (max-width: 720px) {
    .epic-grid {
      grid-template-columns: 1fr;
      gap: 20px;
    }
    .epic-title {
      font-size: 20px;
    }
    .epic-stat dd {
      font-size: 18px;
    }
  }
</style>
