<script lang="ts">
  // The last few outings, each with the single best true thing about it.
  import HighlightBadge from '$lib/components/health/HighlightBadge.svelte';
  import TrackThumb from '$lib/components/trails/TrackThumb.svelte';
  import { activityLabel, formatDistance, formatDuration, formatLocalDate } from '$lib/trails/format';
  import { formatTemperature } from '$lib/trails/activity-meta';
  import type { Highlight } from '$lib/trails/highlights';

  export interface OutingRow {
    id: string;
    name: string;
    activityType: string;
    startDate: number;
    startDateLocal: string;
    distanceM: number | null;
    durationS: number;
    elevationGainM: number | null;
    avgHeartrate: number | null;
    temperatureC: number | null;
    segmentCount: number;
    polyline: string | null;
    highlight: Highlight | null;
  }

  let { outings }: { outings: OutingRow[] } = $props();
</script>

<ul class="outings">
  {#each outings as o (o.id)}
    <li>
      <a class="outing" href="/health/activities/{encodeURIComponent(o.id)}" data-activity-row>
        <TrackThumb polyline={o.polyline} size={44} />
        <span class="main">
          <span class="name">{o.name}</span>
          <span class="meta">
            {activityLabel(o.activityType)} · {formatLocalDate(o.startDateLocal, o.startDate)}
            {#if o.temperatureC != null}&nbsp;· {formatTemperature(o.temperatureC)}{/if}
            {#if o.segmentCount > 0}&nbsp;· {o.segmentCount} segment{o.segmentCount === 1
                ? ''
                : 's'}{/if}
          </span>
        </span>
        <span class="stats">
          <span>{formatDistance(o.distanceM)}</span>
          <span>{formatDuration(o.durationS)}</span>
        </span>
        {#if o.highlight}
          <span class="badge"><HighlightBadge highlight={o.highlight} size="sm" /></span>
        {/if}
      </a>
    </li>
  {/each}
</ul>

<style>
  .outings {
    list-style: none;
    margin: 0;
    padding: 0;
    border-top: 1px solid var(--line);
  }
  /* Every track is a fixed width, so the two number columns line up down the
     list instead of raggedly right-aligning as a pair, and the badge has a
     column it cannot escape. */
  .outing {
    display: grid;
    grid-template-columns: 44px minmax(0, 1fr) auto minmax(0, 320px);
    align-items: center;
    gap: 16px;
    padding: 12px 8px;
    border-bottom: 1px solid var(--line-hair);
    text-decoration: none;
    color: inherit;
  }
  .outing:hover {
    background: var(--accent-tint-04);
  }
  .main {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .name {
    font-family: var(--font-body);
    font-size: var(--fs-body-sm);
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    color: var(--text-ghost);
  }
  .stats {
    display: grid;
    grid-template-columns: 5.5rem 4.5rem;
    gap: 14px;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    font-variant-numeric: tabular-nums;
    text-align: right;
    color: var(--text-secondary);
    white-space: nowrap;
  }
  /* NOT `justify-self: end`. That sizes the cell to its content rather than to
     its track, so a badge wider than the track hung off the left of it and sat
     on top of the duration — which is what "16.33 km 2:16:19" was doing under
     BIGGEST OF 2 THAT DAY. Stretched to the track and clipped, the badge
     ellipsises inside its own column instead. */
  .badge {
    min-width: 0;
    display: flex;
    justify-content: flex-end;
    overflow: hidden;
  }
  @media (max-width: 900px) {
    .outing {
      grid-template-columns: 44px minmax(0, 1fr);
      row-gap: 8px;
    }
    .stats,
    .badge {
      grid-column: 2;
      justify-self: start;
    }
    .stats {
      text-align: left;
    }
    .badge {
      justify-content: flex-start;
      max-width: 100%;
    }
  }
</style>
