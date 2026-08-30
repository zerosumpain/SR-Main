<script lang="ts">
  // 08 — SEGMENTS ON THIS ONE. Every known piece of ground this outing crossed,
  // with where the effort placed.
  //
  // PLACINGS ARE OUT OF THE RANKED EFFORTS, NEVER `effortCount`. An HR-derived
  // metric goes null whenever the heart-rate window covers less than half the
  // effort (`MIN_HR_COVERAGE`), so a segment with 63 efforts may have 61 ranked
  // on time and 44 on efficiency. Printing `effortCount` as the denominator is
  // how a 3rd of 4 becomes a 3rd of 19, and it is the bug this component exists
  // to not have.
  //
  // The name is an IDENTIFIER, so it takes the brand/mono voice with the dots in
  // accent — the same treatment the segment page gives its hero.
  import TrackThumb from '$lib/components/trails/TrackThumb.svelte';
  import { formatDuration } from '$lib/trails/format';
  import { ordinal } from './format';
  import type { ActivitySegmentRow } from '$lib/trails/segments-service';

  interface Props {
    segments: ActivitySegmentRow[];
  }

  let { segments }: Props = $props();

  /** A top-three placing is the one thing on the row worth colouring. */
  function loud(row: ActivitySegmentRow): boolean {
    return row.rankByTime != null && row.rankByTime <= 3;
  }

  function placings(row: ActivitySegmentRow): string {
    const time =
      row.rankByTime != null
        ? `${ordinal(row.rankByTime)} of ${row.rankedByTimeOf} on time`
        : 'unranked on time';
    const ef =
      row.rankByEfficiency != null
        ? `${ordinal(row.rankByEfficiency)} of ${row.rankedByEfficiencyOf} on efficiency`
        : 'unranked on efficiency';
    return `${time} · ${ef}`;
  }
</script>

{#if segments.length}
  <section class="ag">
    <div class="ag-inner">
      <div class="ag-head">
        <p class="ag-kicker">Segments on this one</p>
        <a class="ag-all" href="/health/segments">All segments →</a>
      </div>

      <div class="ag-rows">
        {#each segments as row (`${row.segmentId}:${row.effort.id}`)}
          <a class="ag-row" href="/health/segments/{row.segmentId}">
            <TrackThumb polyline={row.polyline} size={40} />

            <span class="ag-main">
              <span class="ag-name"
                >{#each row.name.split('.') as part, i (i)}{#if i > 0}<span class="ag-dot">.</span
                    >{/if}{part}{/each}{#if row.effort.lapIndex > 1}<span class="ag-lap"
                    >lap {row.effort.lapIndex}</span
                  >{/if}</span
              >
              <span class="ag-desc">{row.descriptor}</span>
            </span>

            <span class="ag-nums">
              <span class="ag-time">{formatDuration(row.effort.durationS)}</span>
              <span class="ag-rank" class:loud={loud(row)}>{placings(row)}</span>
            </span>
          </a>
        {/each}
      </div>

      <p class="ag-rule">
        Placings are out of the ranked efforts, never the effort count. An HR-derived metric goes
        null whenever the heart-rate window covers less than half the effort — which is how a 3rd of
        4 gets printed as a 3rd of 19.
      </p>
    </div>
  </section>
{/if}

<style>
  .ag {
    padding: clamp(30px, 3.6vw, 48px) clamp(20px, 3vw, 44px);
    background: var(--bg-section);
    border-bottom: 2px solid var(--line);
  }
  .ag-inner {
    max-width: 1300px;
    margin: 0 auto;
  }

  .ag-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
    margin-bottom: 20px;
  }
  .ag-kicker {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    margin: 0;
  }
  .ag-all {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--accent);
    text-decoration: none;
    transition: color 0.2s ease-out;
  }
  .ag-all:hover {
    color: var(--accent-hover);
  }

  .ag-rows {
    display: flex;
    flex-direction: column;
  }

  .ag-row {
    display: grid;
    grid-template-columns: 44px minmax(0, 1fr) auto;
    align-items: center;
    gap: 16px;
    padding: 15px 4px;
    border-bottom: 1px solid var(--line);
    color: var(--text-primary);
    text-decoration: none;
    /* Hover is colour only — no lift, no fade, no scale. */
    transition: background 0.2s ease-out;
  }
  .ag-row:hover {
    background: color-mix(in srgb, var(--text-primary) 5%, transparent);
  }

  .ag-main {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .ag-name {
    font-family: var(--font-brand);
    font-size: var(--fs-body-sm);
    letter-spacing: -0.01em;
    overflow-wrap: anywhere;
  }
  .ag-dot {
    color: var(--accent);
  }
  .ag-lap {
    margin-left: 8px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--accent);
  }
  .ag-desc,
  .ag-rank {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }

  .ag-nums {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
    text-align: right;
  }
  .ag-time {
    font-family: var(--font-mono);
    font-size: var(--fs-body);
    font-weight: 500;
  }
  .ag-rank.loud {
    color: var(--accent);
  }

  .ag-rule {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.65;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--text-muted);
    max-width: 92ch;
    margin: 18px 0 0;
  }

  /* Below the fold of a phone the placings need their own line, or the middle
     column collapses to nothing and the name wraps one character wide. */
  @media (max-width: 560px) {
    .ag-row {
      grid-template-columns: 44px minmax(0, 1fr);
    }
    .ag-nums {
      grid-column: 2;
      align-items: flex-start;
      text-align: left;
    }
  }
</style>
