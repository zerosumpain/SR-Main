<script lang="ts">
  import { Chart, Svg, GeoPath } from 'layerchart';
  import { geoMercator } from 'd3-geo';
  import { decodePolyline } from '$lib/health/polyline';

  let { activity }: { activity: any } = $props();

  // Decode polyline into GeoJSON
  let routeGeoJson = $derived.by(() => {
    if (!activity?.polyline) return null;
    const coords = decodePolyline(activity.polyline);
    if (coords.length < 2) return null;
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: coords.map(([lat, lng]) => [lng, lat]), // GeoJSON is [lng, lat]
      },
    };
  });

  // Wrap in FeatureCollection for fitGeojson
  let routeCollection = $derived(routeGeoJson ? {
    type: 'FeatureCollection' as const,
    features: [routeGeoJson],
  } : null);

  function formatDistance(m: number | null): string {
    if (!m) return '—';
    return (m / 1000).toFixed(2) + ' km';
  }

  function formatDuration(s: number | null): string {
    if (!s) return '—';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m ${sec}s`;
  }

  function formatPace(speedTimesHundred: number | null, dist: number | null): string {
    if (!speedTimesHundred || !dist) return '—';
    const speedMs = speedTimesHundred / 100;
    if (speedMs <= 0) return '—';
    const paceSecPerKm = 1000 / speedMs;
    const mins = Math.floor(paceSecPerKm / 60);
    const secs = Math.round(paceSecPerKm % 60);
    return `${mins}:${secs.toString().padStart(2, '0')} /km`;
  }

  function formatDate(unix: number | null): string {
    if (!unix) return '—';
    return new Date(unix * 1000).toLocaleDateString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
</script>

{#if activity}
  <div class="space-y-6">
    <!-- Header -->
    <div>
      <p class="text-xl font-light" style="color: var(--text-primary);">{activity.name || 'Activity'}</p>
      <p class="text-[10px] mt-1" style="color: var(--text-ghost); font-family: var(--font-mono);">
        {activity.type}{activity.sportType && activity.sportType !== activity.type ? ` · ${activity.sportType}` : ''} · {formatDate(activity.startDate)}
      </p>
    </div>

    <!-- Map -->
    {#if routeCollection}
      <div class="rounded-xl overflow-hidden border" style="border-color: var(--card-border); height: 220px;">
        <Chart
          geo={{
            projection: geoMercator(),
            fitGeojson: routeCollection,
          }}
          padding={{ top: 20, bottom: 20, left: 20, right: 20 }}
        >
          <Svg>
            <GeoPath
              geojson={routeGeoJson}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </Chart>
      </div>
    {/if}

    <!-- Key metrics -->
    <div class="grid grid-cols-2 gap-3">
      {#each [
        { label: 'Distance', value: formatDistance(activity.distance), desc: 'Total distance covered' },
        { label: 'Duration', value: formatDuration(activity.movingTime), desc: 'Moving time (excludes pauses)' },
        { label: 'Pace', value: formatPace(activity.averageSpeed, activity.distance), desc: 'Average pace per kilometre' },
        { label: 'Elevation', value: activity.totalElevationGain ? `${Math.round(activity.totalElevationGain)}m` : '—', desc: 'Total elevation gained' },
      ] as metric}
        <div class="p-3 rounded-lg" style="background: var(--card-bg);">
          <p class="text-[9px] uppercase tracking-[0.2em]" style="color: var(--text-ghost); font-family: var(--font-mono);">{metric.label}</p>
          <p class="text-lg font-light mt-0.5" style="color: var(--text-primary);">{metric.value}</p>
          <p class="text-[9px] mt-0.5" style="color: var(--text-whisper);">{metric.desc}</p>
        </div>
      {/each}
    </div>

    <!-- Heart rate -->
    {#if activity.averageHeartrate || activity.maxHeartrate}
      <div class="pt-2" style="border-top: 1px solid var(--card-border);">
        <p class="text-[10px] uppercase tracking-[0.2em] mb-3" style="color: var(--text-ghost); font-family: var(--font-mono);">Heart Rate</p>
        <div class="grid grid-cols-2 gap-3">
          {#if activity.averageHeartrate}
            <div class="p-3 rounded-lg" style="background: var(--card-bg);">
              <p class="text-[9px] uppercase tracking-[0.2em]" style="color: var(--text-ghost); font-family: var(--font-mono);">Average</p>
              <p class="text-lg font-light mt-0.5" style="color: var(--text-primary);">{Math.round(activity.averageHeartrate)} <span class="text-xs" style="color: var(--text-ghost);">bpm</span></p>
              <p class="text-[9px] mt-0.5" style="color: var(--text-whisper);">Mean HR during the activity</p>
            </div>
          {/if}
          {#if activity.maxHeartrate}
            <div class="p-3 rounded-lg" style="background: var(--card-bg);">
              <p class="text-[9px] uppercase tracking-[0.2em]" style="color: var(--text-ghost); font-family: var(--font-mono);">Max</p>
              <p class="text-lg font-light mt-0.5" style="color: var(--text-primary);">{Math.round(activity.maxHeartrate)} <span class="text-xs" style="color: var(--text-ghost);">bpm</span></p>
              <p class="text-[9px] mt-0.5" style="color: var(--text-whisper);">Peak heart rate reached</p>
            </div>
          {/if}
        </div>
      </div>
    {/if}

    <!-- Additional metrics -->
    <div class="pt-2 space-y-2" style="border-top: 1px solid var(--card-border);">
      {#if activity.calories}
        <div class="flex justify-between py-1.5">
          <span class="text-sm" style="color: var(--text-secondary);">Calories</span>
          <span class="text-sm" style="color: var(--text-primary); font-family: var(--font-mono);">{Math.round(activity.calories)} kcal</span>
        </div>
      {/if}
      {#if activity.sufferScore}
        <div class="flex justify-between py-1.5">
          <div>
            <span class="text-sm" style="color: var(--text-secondary);">Relative Effort</span>
            <p class="text-[9px]" style="color: var(--text-whisper);">Strava's intensity score based on HR zones</p>
          </div>
          <span class="text-sm" style="color: var(--text-primary); font-family: var(--font-mono);">{activity.sufferScore}</span>
        </div>
      {/if}
      {#if activity.elapsedTime && activity.movingTime}
        <div class="flex justify-between py-1.5">
          <div>
            <span class="text-sm" style="color: var(--text-secondary);">Elapsed Time</span>
            <p class="text-[9px]" style="color: var(--text-whisper);">Total time including pauses</p>
          </div>
          <span class="text-sm" style="color: var(--text-primary); font-family: var(--font-mono);">{formatDuration(activity.elapsedTime)}</span>
        </div>
      {/if}
    </div>
  </div>
{/if}
