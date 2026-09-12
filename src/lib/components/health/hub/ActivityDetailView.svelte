<script lang="ts">
  // The owner's /health/activities/[id] — eight sections read top to bottom.
  //
  //   01  Header       what it was, when, and twelve figures — each one openable
  //                    against its ninety-day cohort
  //   02  Excellent    every highlight this outing earned, best placing first
  //   03  Ground       the trace and the three series under it, on ONE cursor
  //   04  Zones        where the effort actually sat
  //   05  Effort       recovery, decoupling, and the same-sport medians
  //   06  Splits       per kilometre, trailing split reported
  //   07  Segments     the known ground it crossed, and where it placed
  //   08  Provenance   whose numbers these are
  //
  // EVERY SECTION IS CONDITIONAL and each collapses whole. A walk with no
  // heart-rate window has no zones, no recovery curve and no decoupling, so
  // sections 04 and 05 do not render — not as empty frames with em dashes in
  // them, which is the failure mode a fixed layout invites. The sections that
  // always exist are the header and provenance.
  //
  // THE MAP AND THE TRACES ARE ONE SECTION, not two. They were separate bands
  // until hovering a trace started dropping a dot on the route: the map was a
  // screen and a half above the chart, so the answer to "where was I" was drawn
  // somewhere the reader could not see. One band puts the route and the first
  // trace on screen together, and the cursor is SHARED — hover the heart rate
  // and the elevation lights at the same instant, because both are resolved
  // through the GPS track rather than through each other's axis.
  //
  // Nothing is re-derived that the loader already decided: ranks, EF, the
  // effective type, the highlight corpus, the splits, the cohort and every
  // physiological figure arrive computed. What happens here is layout.
  import HealthShell from './HealthShell.svelte';
  import ActivityHero from './ActivityHero.svelte';
  import ActivityZones from './ActivityZones.svelte';
  import ActivityEffort from './ActivityEffort.svelte';
  import ActivitySplits from './ActivitySplits.svelte';
  import ActivitySegments from './ActivitySegments.svelte';
  import TraceChart from './TraceChart.svelte';
  import PeerPeek from './PeerPeek.svelte';
  import PeerDrill from './PeerDrill.svelte';
  import TrackMap from '$lib/components/trails/TrackMap.svelte';
  import ActivityCorrections from '$lib/components/health/ActivityCorrections.svelte';
  import MethodologyDrawer from '$lib/components/health/v2/MethodologyDrawer.svelte';
  import { activityLabel, formatDuration, formatPace, isPaceSport } from '$lib/trails/format';
  import {
    distanceAxis,
    excellenceCards,
    interpolate,
    meanOf,
    paceRange,
    provenanceNote,
    resample,
    timeAxis,
    trackCursorAt,
    trackIndex,
  } from '$lib/health/activity-detail';
  import type { PeerSet } from '$lib/health/activity-peers';
  import type { ActivityDetail } from '$lib/trails/activities-service';
  import type { ActivityPhysio } from '$lib/trails/physio-service';
  import type { ActivitySegmentRow } from '$lib/trails/segments-service';
  import type { Highlight } from '$lib/trails/highlights';

  interface Props {
    activity: ActivityDetail;
    physio: ActivityPhysio | null;
    segments: ActivitySegmentRow[];
    highlights: Highlight[];
    /** The ninety-day cohort behind the header. Null renders the old header. */
    peers?: PeerSet | null;
  }

  let { activity, physio, segments, highlights, peers = null }: Props = $props();

  const pace = $derived(isPaceSport(activity.activityType));

  /**
   * The abbreviated id the header and footer print. The real id is
   * `apple:<UUID>`, which is 42 characters of nothing a reader wants in a
   * wordmark; four hex digits is enough to tell two outings apart on screen.
   */
  const shortId = $derived(
    (activity.id.includes(':') ? activity.id.split(':').pop()! : activity.id)
      .replace(/-/g, '')
      .slice(0, 4)
      .toLowerCase(),
  );

  // ——— 01 the cohort drill ————————————————————————————————————————

  let drillKey = $state<string | null>(null);

  // ——— 02 excellent ————————————————————————————————————————————

  const cards = $derived(excellenceCards(highlights));

  // ——— 03 ground ————————————————————————————————————————————————

  const hasTrack = $derived(!!activity.coordinates && activity.coordinates.length > 1);
  const ramp = $derived(paceRange(activity.coordinates));
  const rampLabel = $derived.by(() => {
    if (!ramp) return null;
    return pace
      ? `${formatPace(ramp.slowSPerKm).replace(' /km', '')} → ${formatPace(ramp.fastSPerKm)}`
      : `${(3600 / ramp.slowSPerKm).toFixed(1)} → ${(3600 / ramp.fastSPerKm).toFixed(1)} km/h`;
  });

  // A 1 Hz heart-rate series over forty minutes is ~2,400 points. Drawn whole
  // it is a solid band of ink; taking every nth sample keeps the spikes and
  // loses the shape. `resample` bucket-averages, which keeps the shape.
  const elevation = $derived(
    resample(
      activity.elevation.map((p) => [p.distanceM, p.elevationM] as [number, number]),
      120,
    ),
  );
  const heartRate = $derived(
    resample((activity.series.find((s) => s.metric === 'heart_rate')?.samples ?? []) as Array<[number, number]>, 90),
  );
  const cadence = $derived(
    resample((activity.series.find((s) => s.metric === 'cadence')?.samples ?? []) as Array<[number, number]>, 90),
  );
  const avgHr = $derived(meanOf(heartRate));
  const avgCadence = $derived(meanOf(cadence));
  const hasTraces = $derived(elevation.length > 1 || heartRate.length > 1 || cadence.length > 1);
  const hasGround = $derived(hasTrack || hasTraces);

  /**
   * The shared cursor.
   *
   * Two positions, not one, because the traces do not share an axis: elevation
   * is drawn against DISTANCE and the heart-rate and cadence series against
   * TIME, and the two are not proportional — a minute spent at a gate advances
   * one and not the other. Both are resolved from the GPS track, which carries
   * both for every sample it holds.
   *
   * Without a track there is nothing to convert through, so only the hovered
   * chart's own axis is set and the map keeps no dot. That is honest; guessing
   * a time from a distance at the average pace would put the dot in a place the
   * outing never was.
   */
  const track = $derived(trackIndex(activity.coordinates));

  let cursorDistanceM = $state<number | null>(null);
  let cursorTimeS = $state<number | null>(null);
  let cursorAt = $state<[number, number] | null>(null);

  function moveCursor(axis: 'distance' | 'time', x: number | null) {
    if (x == null) {
      cursorDistanceM = null;
      cursorTimeS = null;
      cursorAt = null;
      return;
    }
    const at = trackCursorAt(track, axis, x);
    if (at) {
      cursorDistanceM = at.distanceM;
      cursorTimeS = at.timeS;
      cursorAt = [at.lng, at.lat];
      return;
    }
    cursorDistanceM = axis === 'distance' ? x : null;
    cursorTimeS = axis === 'time' ? x : null;
    cursorAt = null;
  }

  /** The elevation trace's own reading where the cursor crosses it. */
  const cursorElevation = $derived(
    cursorDistanceM == null ? null : interpolate(elevation, cursorDistanceM),
  );
  const cursorHr = $derived(cursorTimeS == null ? null : interpolate(heartRate, cursorTimeS));
  const cursorCadence = $derived(
    cursorTimeS == null ? null : interpolate(cadence, cursorTimeS),
  );
  const cursorKm = $derived(
    cursorDistanceM == null ? null : `${(cursorDistanceM / 1000).toFixed(2)} km`,
  );
  const cursorClock = $derived(cursorTimeS == null ? null : formatDuration(cursorTimeS));

  // ——— 08 provenance ————————————————————————————————————————————

  const provenance = $derived.by(() => {
    const cells: Array<{ key: string; label: string; value: string; sub?: string }> = [
      { key: 'source', label: 'Source', value: activity.source },
      {
        key: 'reported',
        label: 'Reported as',
        value: activity.rawType ?? activityLabel(activity.sourceType),
        // The correction is only visible as a change if what it changed FROM
        // is still on the page.
        sub: activity.typeOverride
          ? `now ${activityLabel(activity.activityType).toLowerCase()}`
          : undefined,
      },
      { key: 'tz', label: 'Local offset', value: activity.timezone ?? '—' },
      { key: 'gps', label: 'GPS trace', value: activity.hasTrack ? 'yes' : 'no' },
    ];
    if (physio?.temperatureC != null) {
      cells.push({ key: 'temp', label: 'Temperature', value: `${physio.temperatureC.toFixed(0)}°C` });
    }
    if (physio?.humidityPct != null) {
      cells.push({ key: 'hum', label: 'Humidity', value: `${physio.humidityPct.toFixed(0)}%` });
    }
    if (physio?.minHr != null) {
      cells.push({ key: 'minhr', label: 'Min HR', value: `${Math.round(physio.minHr)} bpm` });
    }
    if (physio?.trimpBasis) {
      cells.push({
        key: 'basis',
        label: 'Load basis',
        value: physio.trimpBasis === 'series' ? 'HR series' : 'avg HR (no series)',
      });
    }
    return cells;
  });

  const provNote = $derived(provenanceNote(activity, physio, activityLabel));

  // ——— the methodology drawer ————————————————————————————————————

  let drawerOpen = $state(false);
  let drawerFocus = $state<string | null>(null);

  function openEvidence(id: string) {
    drawerFocus = id;
    drawerOpen = true;
  }

  /** Just the fields a correction reads and writes. */
  const correctable = $derived({
    id: activity.id,
    name: activity.name,
    activityType: activity.activityType,
    sourceType: activity.sourceType,
    typeOverride: activity.typeOverride,
    excludedFromSegments: activity.excludedFromSegments,
  });
</script>

<HealthShell
  path="/health/activities/{shortId}"
  maxWidth={1300}
  nav={[
    // No `← All activities` cell. HealthShell derives the way back from the nav
    // manifest and renders it top-left beside the home icon, where the rest of
    // the site puts it; a second arrow to the same href over on the right was
    // the duplicate this unification exists to remove.
    { href: '/health', label: 'Dashboard', muted: true },
    { href: '/health/segments', label: 'Segments', muted: true },
  ]}
  footer={[
    `strangeramblings.com/health/activities/${shortId}`,
    'Owner-gated · a GPS trace starts at the front door',
    'Advisory only · not medical advice',
  ]}
>
  {#snippet actions()}
    <!-- The same `···` the list row opens. It belongs here too: this is the
         page you are on when you notice the phone called a ride a walk. -->
    <ActivityCorrections activity={correctable} label="Correct" />
  {/snippet}

  <ActivityHero {activity} {physio} {peers} onopen={(key) => (drillKey = key)} />

  {#if cards.length}
    <section class="ad-band tint ruled">
      <div class="ad-inner">
        <div class="ad-head">
          <p class="ad-kicker">What was excellent</p>
          <p class="ad-meta">Best placing first · {cards.length}</p>
        </div>

        <div class="ex-cards">
          {#each cards as card (card.key)}
            {#if card.href}
              <a
                class="ex-card {card.medal ?? 'plain'}"
                href={card.href}
                title={card.segmentName ?? undefined}
                aria-label="{card.place} · {card.label}{card.segmentName
                  ? ` on ${card.segmentName}`
                  : ''}{card.also.length ? `, also ${card.also.join(', ')}` : ''}"
              >
                <p class="ex-place">{card.place}</p>
                <p class="ex-label">{card.label}</p>
                <p class="ex-note">{card.note}</p>
                {#if card.also.length}
                  <p class="ex-also">Also {card.also.join(' · ')}</p>
                {/if}
              </a>
            {:else}
              <div class="ex-card {card.medal ?? 'plain'}">
                <p class="ex-place">{card.place}</p>
                <p class="ex-label">{card.label}</p>
                <p class="ex-note">{card.note}</p>
                {#if card.also.length}
                  <p class="ex-also">Also {card.also.join(' · ')}</p>
                {/if}
              </div>
            {/if}
          {/each}
        </div>

        <p class="ad-rule">
          One card per achievement: a measure is ranked over all time, over the calendar month
          and over the trailing ten, and the best of those is the card's face with the rest on
          its "also" line. Gold, silver and bronze are that placing, and a card with a placing
          on known ground opens that segment. Ranks are measured over every outing on record,
          not the page you came from. Segment placings ignore any recording taken out of
          segment analysis, and efficiency compares only within the pace sports — a ride's sits
          near 4 against a run's 1.
        </p>
      </div>
    </section>
  {/if}

  {#if hasGround}
    <section class="ad-band ruled">
      <div class="ad-inner">
        <div class="ad-head">
          <p class="ad-kicker">Route &amp; traces</p>
          <p class="ad-meta">
            {#if hasTrack}
              {activity.coordinates!.length.toLocaleString('en-GB')} points · decimated at 3 m ·
              coloured by pace
            {:else}
              No GPS trace · series only
            {/if}
          </p>
        </div>

        {#if hasTrack}
          <div class="rt-card">
            <TrackMap
              coordinates={activity.coordinates!}
              bounds={activity.bounds}
              colourBy="pace"
              height="420px"
              legend={false}
              cursor={cursorAt}
            />
            <div class="rt-legend">
              <p class="rt-legend-label">{pace ? 'Pace' : 'Speed'}</p>
              <div class="rt-ramp" aria-hidden="true">
                <i class="s1"></i><i class="s2"></i><i class="s3"></i><i class="s4"></i>
              </div>
              {#if rampLabel}<p class="rt-legend-range">{rampLabel}</p>{/if}
              {#if hasTraces}
                <p class="rt-legend-cursor" class:on={!!cursorAt}>
                  {#if cursorAt}
                    On the route at {cursorKm} · {cursorClock}
                  {:else}
                    Hover a trace to place it on the route
                  {/if}
                </p>
              {/if}
            </div>
          </div>
        {/if}

        {#if hasTraces}
          <div class="tr-stack" class:under={hasTrack}>
            {#if elevation.length > 1}
              <div class="tr-card">
                <div class="tr-head">
                  <p class="tr-label">Elevation</p>
                  <p class="tr-meta" class:live={cursorElevation != null}>
                    {#if cursorElevation != null}
                      {cursorKm} · {Math.round(cursorElevation)} m
                    {:else}
                      Against distance
                    {/if}
                  </p>
                </div>
                <TraceChart
                  points={elevation}
                  label="Elevation against distance"
                  fill
                  yFormat={(v) => `${Math.round(v)} m`}
                  xLabels={distanceAxis(elevation)}
                  cursorX={cursorDistanceM}
                  oncursor={(x) => moveCursor('distance', x)}
                />
              </div>
            {/if}

            {#if heartRate.length > 1}
              <div class="tr-card">
                <div class="tr-head">
                  <p class="tr-label">Heart rate</p>
                  <p class="tr-meta" class:live={cursorHr != null}>
                    {#if cursorHr != null}
                      {cursorClock} · {Math.round(cursorHr)} bpm
                    {:else}
                      Against time · 1 Hz series
                    {/if}
                  </p>
                </div>
                <TraceChart
                  points={heartRate}
                  label="Heart rate against time"
                  xLabels={timeAxis(heartRate)}
                  average={avgHr}
                  averageLabel={avgHr == null ? null : `Avg ${Math.round(avgHr)}`}
                  cursorX={cursorTimeS}
                  oncursor={(x) => moveCursor('time', x)}
                />
              </div>
            {/if}

            {#if cadence.length > 1}
              <div class="tr-card">
                <div class="tr-head">
                  <p class="tr-label">Cadence</p>
                  <p class="tr-meta" class:live={cursorCadence != null}>
                    {#if cursorCadence != null}
                      {cursorClock} · {Math.round(cursorCadence)} spm
                    {:else if avgCadence == null}
                      Against time
                    {:else}
                      Avg {Math.round(avgCadence)} spm
                    {/if}
                  </p>
                </div>
                <TraceChart
                  points={cadence}
                  label="Cadence against time"
                  gridlines={2}
                  colour="var(--text-muted)"
                  xLabels={timeAxis(cadence).filter((_, i) => i !== 1)}
                  cursorX={cursorTimeS}
                  oncursor={(x) => moveCursor('time', x)}
                />
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </section>
  {/if}

  {#if physio?.zones}
    <ActivityZones {physio} onevidence={openEvidence} />
  {/if}

  {#if physio}
    <ActivityEffort {activity} {physio} onevidence={openEvidence} />
  {/if}

  <ActivitySplits splits={activity.splits} paceSport={pace} />

  <ActivitySegments {segments} />

  <section class="ad-band">
    <div class="ad-inner">
      <p class="ad-kicker solo">Provenance</p>

      <div class="pv-grid">
        {#each provenance as cell (cell.key)}
          <div class="pv-cell">
            <p class="pv-label">{cell.label}</p>
            <p class="pv-value">{cell.value}</p>
            {#if cell.sub}<p class="pv-sub">{cell.sub}</p>{/if}
          </div>
        {/each}
      </div>

      {#if provNote}<p class="pv-note">{provNote}</p>{/if}
    </div>
  </section>
</HealthShell>

<!-- Mounted ONCE for the whole page: the header has twelve figures, and a card
     per cell would be twelve idle popovers. -->
<PeerPeek {peers} paceSport={pace} onopen={(key) => (drillKey = key)} />
<PeerDrill
  metricKey={drillKey}
  {peers}
  paceSport={pace}
  onclose={() => (drillKey = null)}
  onopen={(key) => (drillKey = key)}
/>

<MethodologyDrawer open={drawerOpen} focusId={drawerFocus} onclose={() => (drawerOpen = false)} />

<style>
  .ad-band {
    padding: clamp(30px, 3.6vw, 48px) clamp(20px, 3vw, 44px);
  }
  .ad-band.tint {
    background: var(--bg-section);
  }
  .ad-band.ruled {
    border-bottom: 2px solid var(--line);
  }
  .ad-inner {
    max-width: 1300px;
    margin: 0 auto;
  }

  .ad-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
    margin-bottom: 20px;
  }
  .ad-kicker {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    margin: 0;
  }
  .ad-kicker.solo {
    margin-bottom: 22px;
  }
  .ad-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-ghost);
    margin: 0;
  }
  .ad-rule {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.65;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--text-muted);
    max-width: 92ch;
    margin: 20px 0 0;
  }

  /* ——— 02 excellent ———
   *
   * A UNIFORM GRID, not a wrapping row of self-sized boxes. The old cards were
   * `flex-wrap` with a 380px cap and each one took the width of the sentence
   * inside it, so a section with five highlights drew five different cards. The
   * long thing in each was the segment's name; that has moved to the card's
   * destination, which is what let the rest become a fixed track. */
  .ex-cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(186px, 1fr));
    gap: 10px;
  }
  .ex-card {
    display: flex;
    flex-direction: column;
    min-height: 116px;
    border: 1px solid var(--card-border);
    border-radius: 0;
    background: var(--bg);
    padding: 12px 14px;
    min-width: 0;
    text-decoration: none;
    color: inherit;
  }

  /* The podium. A fill and a border, never the only signal — the placing is
     printed on every card that wears one. */
  .ex-card.gold {
    background: var(--medal-gold-bg);
    border: 2px solid var(--medal-gold-line);
  }
  .ex-card.silver {
    background: var(--medal-silver-bg);
    border: 2px solid var(--medal-silver-line);
  }
  .ex-card.bronze {
    background: var(--medal-bronze-bg);
    border: 2px solid var(--medal-bronze-line);
  }

  .ex-place {
    font-family: var(--font-display);
    font-size: 21px;
    line-height: 0.95;
    letter-spacing: -0.02em;
    color: var(--text-ghost);
    margin: 0 0 8px;
  }
  .ex-card.gold .ex-place {
    color: var(--medal-gold);
  }
  .ex-card.silver .ex-place {
    color: var(--medal-silver);
  }
  .ex-card.bronze .ex-place {
    color: var(--medal-bronze);
  }

  .ex-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-primary);
    line-height: 1.35;
    margin: 0 0 6px;
    overflow-wrap: anywhere;
  }
  .ex-note {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.45;
    color: var(--text-muted);
    margin: 0;
    overflow-wrap: anywhere;
    /* Two lines, so one verbose highlight cannot set the height of the row. */
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
  }

  /* The other windows this achievement won. Ghosted, and given two lines
     because one truncated "Also 1st of last…" into saying nothing: it is
     corroboration for the fact above it, and corroboration that cannot be read
     is just noise at the bottom of a card. */
  .ex-also {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.4;
    letter-spacing: 0.06em;
    color: var(--text-ghost);
    margin: 6px 0 0;
    overflow-wrap: anywhere;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
  }

  /* Only the linked cards move; a plain card is a statement, not a control. */
  a.ex-card {
    transition:
      border-color 0.16s ease-out,
      transform 0.16s ease-out;
  }
  a.ex-card::after {
    content: '→';
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    margin-top: auto;
    padding-top: 8px;
  }
  a.ex-card:hover,
  a.ex-card:focus-visible {
    border-color: var(--accent);
  }
  a.ex-card:hover::after,
  a.ex-card:focus-visible::after {
    color: var(--accent);
  }

  /* ——— 03 ground ——— */

  .rt-card {
    border: 2px solid var(--card-border);
    border-radius: 0;
    background: var(--card-bg);
    padding: 12px;
  }
  .rt-legend {
    display: flex;
    align-items: center;
    gap: 20px;
    flex-wrap: wrap;
    padding: 14px 6px 4px;
  }
  .rt-legend-label,
  .rt-legend-range,
  .rt-legend-cursor {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0;
  }
  /* Holds its place whether or not a cursor is live, so the legend row cannot
     reflow under the pointer. */
  .rt-legend-cursor {
    margin-left: auto;
    color: var(--text-ghost);
  }
  .rt-legend-cursor.on {
    color: var(--accent);
  }
  .rt-ramp {
    display: flex;
    flex: 1;
    min-width: 200px;
    max-width: 320px;
    height: 10px;
  }
  .rt-ramp i {
    flex: 1;
    height: 10px;
  }
  .rt-ramp .s1 {
    background: color-mix(in srgb, var(--text-primary) 20%, transparent);
  }
  .rt-ramp .s2 {
    background: var(--accent-tint-35);
  }
  .rt-ramp .s3 {
    background: color-mix(in srgb, var(--accent) 60%, transparent);
  }
  .rt-ramp .s4 {
    background: var(--accent);
  }

  .tr-stack {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  .tr-stack.under {
    margin-top: 18px;
  }
  .tr-card {
    border: 1px solid var(--card-border);
    border-radius: 0;
    background: var(--bg);
    padding: 20px;
    min-width: 0;
  }
  .tr-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 14px;
  }
  .tr-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    margin: 0;
  }
  .tr-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-ghost);
    margin: 0;
  }
  /* The readout under the pointer. Lit, because it is a live value and the
     label beside it is not. */
  .tr-meta.live {
    color: var(--accent);
  }

  /* ——— 08 provenance ——— */

  .pv-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 20px;
  }
  .pv-cell {
    min-width: 0;
  }
  .pv-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-ghost);
    margin: 0 0 7px;
  }
  .pv-value {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    overflow-wrap: anywhere;
    margin: 0;
  }
  .pv-sub {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--accent);
    margin: 5px 0 0;
  }
  .pv-note {
    font-size: var(--fs-body-sm);
    line-height: 1.55;
    color: var(--text-muted);
    max-width: 84ch;
    text-wrap: pretty;
    margin: 26px 0 0;
  }
</style>
