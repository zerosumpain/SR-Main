<script lang="ts">
  // The owner's /health/activities/[id] — nine sections read top to bottom.
  //
  //   01  Header       what it was, when, and twelve figures
  //   02  Excellent    every highlight this outing earned, best first
  //   03  Route        the trace, coloured by pace
  //   04  Traces       elevation, heart rate, cadence
  //   05  Zones        where the effort actually sat
  //   06  Effort       recovery, decoupling, and the same-sport medians
  //   07  Splits       per kilometre, trailing split reported
  //   08  Segments     the known ground it crossed, and where it placed
  //   09  Provenance   whose numbers these are
  //
  // EVERY SECTION IS CONDITIONAL and each collapses whole. A walk with no
  // heart-rate window has no zones, no recovery curve and no decoupling, so
  // sections 05 and 06 do not render — not as empty frames with em dashes in
  // them, which is the failure mode a fixed nine-section layout invites. The
  // sections that always exist are the header and provenance.
  //
  // Nothing is re-derived that the loader already decided: ranks, EF, the
  // effective type, the highlight corpus, the splits and every physiological
  // figure arrive computed. What happens here is layout.
  import HealthShell from './HealthShell.svelte';
  import ActivityHero from './ActivityHero.svelte';
  import ActivityZones from './ActivityZones.svelte';
  import ActivityEffort from './ActivityEffort.svelte';
  import ActivitySplits from './ActivitySplits.svelte';
  import ActivitySegments from './ActivitySegments.svelte';
  import TraceChart from './TraceChart.svelte';
  import TrackMap from '$lib/components/trails/TrackMap.svelte';
  import ActivityCorrections from '$lib/components/health/ActivityCorrections.svelte';
  import MethodologyDrawer from '$lib/components/health/v2/MethodologyDrawer.svelte';
  import { activityLabel, formatPace, isPaceSport } from '$lib/trails/format';
  import {
    distanceAxis,
    meanOf,
    paceRange,
    provenanceNote,
    resample,
    timeAxis,
  } from '$lib/health/activity-detail';
  import type { ActivityDetail } from '$lib/trails/activities-service';
  import type { ActivityPhysio } from '$lib/trails/physio-service';
  import type { ActivitySegmentRow } from '$lib/trails/segments-service';
  import type { Highlight } from '$lib/trails/highlights';

  interface Props {
    activity: ActivityDetail;
    physio: ActivityPhysio | null;
    segments: ActivitySegmentRow[];
    highlights: Highlight[];
  }

  let { activity, physio, segments, highlights }: Props = $props();

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

  // ——— 02 excellent ————————————————————————————————————————————

  const SCOPE_TONE: Record<string, string> = {
    segment: 'seg',
    activity: 'act',
    environment: 'env',
    rhythm: 'rhy',
  };

  // ——— 03 route ————————————————————————————————————————————————

  const hasTrack = $derived(!!activity.coordinates && activity.coordinates.length > 1);
  const ramp = $derived(paceRange(activity.coordinates));
  const rampLabel = $derived.by(() => {
    if (!ramp) return null;
    return pace
      ? `${formatPace(ramp.slowSPerKm).replace(' /km', '')} → ${formatPace(ramp.fastSPerKm)}`
      : `${(3600 / ramp.slowSPerKm).toFixed(1)} → ${(3600 / ramp.fastSPerKm).toFixed(1)} km/h`;
  });

  // ——— 04 traces ————————————————————————————————————————————————
  //
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

  // ——— 09 provenance ————————————————————————————————————————————

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

  <ActivityHero {activity} {physio} />

  {#if highlights.length}
    <section class="ad-band tint ruled">
      <div class="ad-inner">
        <div class="ad-head">
          <p class="ad-kicker">What was excellent</p>
          <p class="ad-meta">Best first · {highlights.length} of {highlights.length}</p>
        </div>

        <div class="ex-cards">
          {#each highlights as highlight, i (`${highlight.kind}:${highlight.segmentId ?? ''}:${i}`)}
            <div class="ex-card {SCOPE_TONE[highlight.scope] ?? 'act'}" class:lead={i === 0}>
              <p class="ex-scope">{highlight.scope}</p>
              <p class="ex-label">
                {#if highlight.segmentId}
                  <a href="/health/segments/{highlight.segmentId}">{highlight.label}</a>
                {:else}{highlight.label}{/if}
              </p>
              {#if highlight.detail}<p class="ex-detail">{highlight.detail}</p>{/if}
            </div>
          {/each}
        </div>

        <p class="ad-rule">
          Ranks are measured over every outing on record, not the page you came from. Segment
          placings ignore any recording taken out of segment analysis, and efficiency compares only
          within the pace sports — a ride's sits near 4 against a run's 1.
        </p>
      </div>
    </section>
  {/if}

  {#if hasTrack}
    <section class="ad-band ruled">
      <div class="ad-inner">
        <div class="ad-head">
          <p class="ad-kicker">Route</p>
          <p class="ad-meta">
            {activity.coordinates!.length.toLocaleString('en-GB')} points · decimated at 3 m · coloured
            by pace
          </p>
        </div>

        <div class="rt-card">
          <TrackMap
            coordinates={activity.coordinates!}
            bounds={activity.bounds}
            colourBy="pace"
            height="440px"
            legend={false}
          />
          <div class="rt-legend">
            <p class="rt-legend-label">{pace ? 'Pace' : 'Speed'}</p>
            <div class="rt-ramp" aria-hidden="true">
              <i class="s1"></i><i class="s2"></i><i class="s3"></i><i class="s4"></i>
            </div>
            {#if rampLabel}<p class="rt-legend-range">{rampLabel}</p>{/if}
          </div>
        </div>
      </div>
    </section>
  {/if}

  {#if hasTraces}
    <section class="ad-band tint ruled">
      <div class="ad-inner">
        <p class="ad-kicker solo">Traces</p>

        <div class="tr-stack">
          {#if elevation.length > 1}
            <div class="tr-card">
              <div class="tr-head">
                <p class="tr-label">Elevation</p>
                <p class="tr-meta">Against distance</p>
              </div>
              <TraceChart
                points={elevation}
                label="Elevation against distance"
                fill
                yFormat={(v) => `${Math.round(v)} m`}
                xLabels={distanceAxis(elevation)}
              />
            </div>
          {/if}

          {#if heartRate.length > 1}
            <div class="tr-card">
              <div class="tr-head">
                <p class="tr-label">Heart rate</p>
                <p class="tr-meta">Against time · 1 Hz series</p>
              </div>
              <TraceChart
                points={heartRate}
                label="Heart rate against time"
                xLabels={timeAxis(heartRate)}
                average={avgHr}
                averageLabel={avgHr == null ? null : `Avg ${Math.round(avgHr)}`}
              />
            </div>
          {/if}

          {#if cadence.length > 1}
            <div class="tr-card">
              <div class="tr-head">
                <p class="tr-label">Cadence</p>
                <p class="tr-meta">
                  {avgCadence == null ? 'Against time' : `Avg ${Math.round(avgCadence)} spm`}
                </p>
              </div>
              <TraceChart
                points={cadence}
                label="Cadence against time"
                gridlines={2}
                colour="var(--text-muted)"
                xLabels={timeAxis(cadence).filter((_, i) => i !== 1)}
              />
            </div>
          {/if}
        </div>
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

  /* ——— 02 excellent ——— */

  .ex-cards {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }
  .ex-card {
    border: 1px solid color-mix(in srgb, var(--text-primary) 25%, transparent);
    border-radius: 0;
    padding: 14px 18px;
    max-width: 380px;
    min-width: 0;
  }
  /* Scope decides how loud, not a colour key nobody reads: a segment placing
     is the achievement, environment and rhythm are context. */
  .ex-card.seg {
    border-color: var(--accent-tint-50);
  }
  .ex-card.rhy {
    border-color: var(--good-line);
  }
  /* Best first, and the best one says so with 2px and a tint. */
  .ex-card.lead {
    border: 2px solid var(--accent);
    background: var(--accent-tint-08);
  }

  .ex-scope {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0 0 8px;
  }
  .ex-card.seg .ex-scope,
  .ex-card.lead .ex-scope {
    color: var(--accent);
  }
  .ex-card.rhy .ex-scope {
    color: var(--good);
  }

  .ex-label {
    font-size: var(--fs-body-sm);
    line-height: 1.4;
    font-weight: 500;
    margin: 0;
    overflow-wrap: anywhere;
  }
  .ex-label a {
    color: var(--accent);
    text-decoration: none;
    transition: color 0.2s ease-out;
  }
  .ex-label a:hover {
    color: var(--accent-hover);
  }
  .ex-detail {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.5;
    color: var(--text-muted);
    margin: 6px 0 0;
    overflow-wrap: anywhere;
  }

  /* ——— 03 route ——— */

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
  .rt-legend-range {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0;
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

  /* ——— 04 traces ——— */

  .tr-stack {
    display: flex;
    flex-direction: column;
    gap: 18px;
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

  /* ——— 09 provenance ——— */

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
