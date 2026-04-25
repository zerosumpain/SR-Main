<script lang="ts">
  import { decodePolyline } from '$lib/health/polyline';

  let { activity }: { activity: any } = $props();

  // Decode polyline and render as simple SVG
  let routePoints = $derived.by(() => {
    if (!activity?.polyline) return null;
    const coords = decodePolyline(activity.polyline);
    if (coords.length < 2) return null;
    return coords;
  });

  // Compute SVG viewBox from coordinates
  let svgData = $derived.by(() => {
    if (!routePoints) return null;
    const lats = routePoints.map(p => p[0]);
    const lngs = routePoints.map(p => p[1]);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const padding = 0.001;

    const width = (maxLng - minLng) + padding * 2;
    const height = (maxLat - minLat) + padding * 2;

    // Convert to SVG coordinates (flip Y axis since lat increases upward)
    const points = routePoints.map(([lat, lng]) => {
      const x = ((lng - minLng + padding) / width) * 100;
      const y = ((maxLat - lat + padding) / height) * 100;
      return `${x},${y}`;
    }).join(' ');

    return { points, viewBox: '0 0 100 100', aspectRatio: width / height };
  });

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

  function formatPace(speedTimesHundred: number | null): string {
    if (!speedTimesHundred) return '—';
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
      weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
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

    <!-- Route Map -->
    {#if svgData}
      <div class="overflow-hidden border p-4" style="border-color: var(--card-border); background: var(--card-bg);">
        <svg
          viewBox={svgData.viewBox}
          class="w-full"
          style="height: {Math.min(220, 220 / Math.max(0.5, svgData.aspectRatio))}px;"
          preserveAspectRatio="xMidYMid meet"
        >
          <polyline
            points={svgData.points}
            fill="none"
            stroke="var(--accent)"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </div>
    {/if}

    <!-- Key metrics -->
    <div class="grid grid-cols-2 gap-3">
      {#each [
        { label: 'Distance', value: formatDistance(activity.distance), desc: 'Total distance covered' },
        { label: 'Duration', value: formatDuration(activity.movingTime), desc: 'Moving time (excludes pauses)' },
        { label: 'Pace', value: formatPace(activity.averageSpeed), desc: 'Average pace per kilometre' },
        { label: 'Elevation', value: activity.totalElevationGain ? `${Math.round(activity.totalElevationGain)}m` : '—', desc: 'Total elevation gained' },
      ] as metric}
        <div class="p-3" style="background: var(--card-bg);">
          <p class="sr-label-tight" style="color: var(--text-ghost);">{metric.label}</p>
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
            <div class="p-3" style="background: var(--card-bg);">
              <p class="sr-label-tight" style="color: var(--text-ghost);">Average</p>
              <p class="text-lg font-light mt-0.5" style="color: var(--text-primary);">{Math.round(activity.averageHeartrate)} <span class="text-xs" style="color: var(--text-ghost);">bpm</span></p>
            </div>
          {/if}
          {#if activity.maxHeartrate}
            <div class="p-3" style="background: var(--card-bg);">
              <p class="sr-label-tight" style="color: var(--text-ghost);">Max</p>
              <p class="text-lg font-light mt-0.5" style="color: var(--text-primary);">{Math.round(activity.maxHeartrate)} <span class="text-xs" style="color: var(--text-ghost);">bpm</span></p>
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
      {#if activity.elapsedTime && activity.movingTime && activity.elapsedTime !== activity.movingTime}
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
