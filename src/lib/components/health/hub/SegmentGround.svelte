<script lang="ts">
  // 02 — THE GROUND. Where it runs, and how it climbs.
  //
  // Two panels. The map is the trace as stored; the profile is the same trace
  // read for altitude, with the gradient-band strip beneath it.
  //
  // THE PROFILE'S VIEWBOX IS PADDED — `-6 -2 614 168`. The start marker is an
  // open circle drawn at x=0 and the finish is a square whose right edge sits
  // at x=603; in an unpadded box the viewport clips both in half, and no
  // amount of CSS `overflow` recovers a marker the SVG viewport has cut.
  //
  // The band strip is bound to the real breakdown (spec decision 3): the
  // designer's PROPOSED badge was a note to engineering, and the note itself
  // said the elevation is already in the stored coordinates. It is, so the
  // strip is data rather than a proposal.
  import SectionHead from './SectionHead.svelte';
  import TrackMap from '$lib/components/trails/TrackMap.svelte';
  import { groundNote, profileGeometry, PROFILE } from '$lib/health/segment-detail';
  import type { SegmentDetail } from '$lib/trails/segments-service';
  import type { GradientBands } from '$lib/trails/segments/gradient-bands';

  interface Props {
    segment: SegmentDetail;
    bands: GradientBands | null;
  }

  let { segment, bands }: Props = $props();

  const hasTrack = $derived(segment.coordinates.length > 1);
  const profile = $derived(profileGeometry(segment.coordinates));
  const note = $derived(groundNote(segment, profile, bands));

  /**
   * A BAND WITH NO DISTANCE IN IT IS DROPPED, and the tracks carry a
   * `min-content` floor.
   *
   * The design lays the strip out in bare `fr` columns off the shares, which
   * reads beautifully on its 32/41/21/6 split and falls apart on a real one:
   * a segment that is 89% shallow gives the last three tracks 8fr, 2fr and
   * 0fr, and their labels — which are two lines of mono, not a sliver —
   * overprint each other. The floor keeps every label legible and keeps it
   * over its own bar; the bar is then very slightly wider than its share at
   * the thin end, which is the cheaper of the two lies.
   */
  const shown = $derived(
    // The band's ORIGINAL index rides along: it picks the swatch, and looking
    // it back up off `bands` after the filter costs the null-narrowing.
    (bands?.usable ? bands.bands : [])
      .map((band, index) => ({ band, index }))
      .filter(({ band }) => band.sharePct > 0),
  );
  const strip = $derived(
    shown.length
      ? shown.map(({ band }) => `minmax(min-content, ${band.sharePct}fr)`).join(' ')
      : null,
  );
</script>

<section class="sg">
  <div class="sg-inner">
    <SectionHead
      kicker="02 / The ground"
      title={['Where it runs,', 'and how it climbs']}
      strap="Geometry is stored to four decimal places — about 11 m, inside the 20 m match tolerance, so a rebuild recognises the same stretch and keeps its name."
    />

    <div class="sg-cols" class:one={!hasTrack || !profile}>
      {#if hasTrack}
        <div class="sg-map">
          <div class="sg-map-head">
            <p class="sg-map-label">Trace · OpenStreetMap</p>
            <p class="sg-map-meta">Bounds from stored trace</p>
          </div>
          <div class="sg-map-frame">
            <TrackMap
              coordinates={segment.coordinates}
              bounds={segment.bounds}
              height="100%"
              legend={false}
            />
          </div>
          <div class="sg-legend">
            <span class="sg-key"><i class="k-line"></i>Segment</span>
            <span class="sg-key"><i class="k-start"></i>Start</span>
            <span class="sg-key"><i class="k-finish"></i>Finish</span>
          </div>
        </div>
      {/if}

      {#if profile}
        <div class="sg-panel">
          <div class="sg-panel-head">
            <p class="sg-panel-label">Elevation profile</p>
            <p class="sg-panel-meta">+{profile.gainM} m gain · −{profile.lossM} m loss</p>
          </div>

          <svg class="sg-svg" viewBox="-6 -2 614 168" role="img" aria-label="Elevation against distance">
            <line
              x1="0"
              y1={PROFILE.top}
              x2={PROFILE.w}
              y2={PROFILE.top}
              class="sg-grid"
              stroke-dasharray="4 4"
            />
            <line
              x1="0"
              y1={PROFILE.bottom}
              x2={PROFILE.w}
              y2={PROFILE.bottom}
              class="sg-grid"
              stroke-dasharray="4 4"
            />

            <path d={profile.area} class="sg-fill" />
            <polyline points={profile.line} class="sg-line" />

            {#if profile.steepestX != null}
              <rect x={profile.steepestX} y="20" width={profile.steepestW} height="110" class="sg-quarter" />
              <text x={profile.steepestX + 5} y="32" class="sg-tick">STEEPEST QUARTER</text>
            {/if}

            <circle cx="0" cy={profile.startY} r="4" class="sg-start" />
            <rect x={PROFILE.w - 5} y={profile.endY - 4} width="8" height="8" class="sg-finish" />

            <text x="0" y="148" class="sg-tick">{profile.startLabel}</text>
            <text x={PROFILE.w / 2} y="148" text-anchor="middle" class="sg-tick">{profile.midLabel}</text>
            <text x={PROFILE.w} y="148" text-anchor="end" class="sg-tick">{profile.endLabel}</text>
          </svg>

          {#if strip}
            <p class="sg-bands-label">Distance by gradient band</p>
            <div class="sg-bars" style="grid-template-columns: {strip}">
              {#each shown as entry (entry.band.label)}
                <div class="sg-bar b{entry.index}"></div>
              {/each}
            </div>
            <div class="sg-bar-labels" style="grid-template-columns: {strip}">
              {#each shown as entry (entry.band.label)}
                <p>{entry.band.label}<br />{entry.band.sharePct}%</p>
              {/each}
            </div>
          {/if}

          <p class="sg-note">{note}</p>
        </div>
      {/if}
    </div>
  </div>
</section>

<style>
  .sg {
    padding: clamp(40px, 5vw, 68px) clamp(20px, 3vw, 44px);
    border-bottom: 2px solid var(--line);
  }
  .sg-inner {
    max-width: 1400px;
    margin: 0 auto;
  }

  .sg-cols {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
    gap: clamp(18px, 2.2vw, 28px);
    align-items: stretch;
  }
  .sg-cols.one {
    grid-template-columns: minmax(0, 1fr);
  }
  @media (max-width: 860px) {
    .sg-cols {
      grid-template-columns: minmax(0, 1fr);
    }
  }

  /* 2px for emphasis: the map is the one panel on the page that is a picture. */
  .sg-map {
    border: 2px solid var(--card-border);
    border-radius: 0;
    background: var(--card-bg);
    padding: 12px;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .sg-map-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    padding: 4px 6px 12px;
  }
  .sg-map-label,
  .sg-map-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--text-secondary);
    margin: 0;
  }
  .sg-map-meta {
    font-weight: 400;
    letter-spacing: 0.1em;
    color: var(--text-ghost);
  }
  .sg-map-frame {
    position: relative;
    width: 100%;
    aspect-ratio: 4 / 3;
  }

  .sg-legend {
    display: flex;
    align-items: center;
    gap: 18px;
    flex-wrap: wrap;
    padding: 12px 6px 4px;
  }
  .sg-key {
    display: flex;
    align-items: center;
    gap: 7px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-secondary);
  }
  .sg-key i {
    display: block;
    flex-shrink: 0;
  }
  .k-line {
    width: 14px;
    height: 3px;
    background: var(--accent);
  }
  .k-start {
    width: 8px;
    height: 8px;
    border-radius: 100px;
    border: 2px solid var(--text-primary);
  }
  .k-finish {
    width: 8px;
    height: 8px;
    background: var(--text-primary);
  }

  .sg-panel {
    border: 1px solid var(--card-border);
    border-radius: 0;
    padding: clamp(18px, 2.2vw, 26px);
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .sg-panel-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 20px;
  }
  .sg-panel-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    margin: 0;
  }
  .sg-panel-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-ghost);
    margin: 0;
  }

  .sg-svg {
    width: 100%;
    height: auto;
    display: block;
  }
  .sg-grid {
    stroke: var(--line-hair);
    stroke-width: 1;
  }
  .sg-fill {
    fill: var(--accent-tint-14);
  }
  .sg-line {
    fill: none;
    stroke: var(--accent);
    stroke-width: 2.2;
  }
  .sg-quarter {
    fill: color-mix(in srgb, var(--text-primary) 6%, transparent);
  }
  .sg-start {
    fill: none;
    stroke: var(--text-primary);
    stroke-width: 2;
  }
  .sg-finish {
    fill: var(--text-primary);
  }
  /* svg-user-units: viewBox -6 -2 614 168 rendered ~700px wide, so a 9-unit
     label lands near 10px on screen — the px floor is about the reader's eye,
     and inside a viewBox a "px" is a user unit, not a screen pixel. */
  .sg-tick {
    font-family: var(--font-mono);
    font-size: 9px; /* svg-user-units */
    letter-spacing: 0.6px;
    fill: var(--text-ghost);
  }

  .sg-bands-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--accent);
    margin: 26px 0 12px;
  }
  .sg-bars {
    display: grid;
    gap: 2px;
    margin-bottom: 6px;
  }
  .sg-bar {
    height: 14px;
    border-radius: 0;
  }
  .b0 {
    background: color-mix(in srgb, var(--text-primary) 16%, transparent);
  }
  .b1 {
    background: var(--accent-tint-35);
  }
  .b2 {
    background: var(--accent);
  }
  .b3 {
    background: var(--text-primary);
  }
  .sg-bar-labels {
    display: grid;
    gap: 2px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  /* `white-space: nowrap` is what makes the `min-content` track floor mean the
     whole label: an en dash is a line-break opportunity, so without it the
     minimum contribution of `4–8%` is two characters and the labels overprint
     each other anyway. The `<br>` still breaks — a forced break always does. */
  .sg-bar-labels p {
    margin: 0;
    min-width: 0;
    white-space: nowrap;
    padding-right: 10px;
  }
  .sg-bar-labels p:last-child {
    padding-right: 0;
  }

  .sg-note {
    font-size: var(--fs-body-sm);
    line-height: 1.5;
    color: var(--text-secondary);
    text-wrap: pretty;
    margin: 20px 0 0;
    padding-top: 18px;
    border-top: 1px solid var(--line);
  }
</style>
