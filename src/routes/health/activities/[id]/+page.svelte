<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';
  import TrackMap from '$lib/components/trails/TrackMap.svelte';
  import LineChart from '$lib/components/trails/LineChart.svelte';
  import SplitsTable from '$lib/components/trails/SplitsTable.svelte';
  import TrackThumb from '$lib/components/trails/TrackThumb.svelte';
  import ZoneBar from '$lib/components/trails/ZoneBar.svelte';
  import EvidenceChip from '$lib/components/health/EvidenceChip.svelte';
  import HighlightBadge from '$lib/components/health/HighlightBadge.svelte';
  import MethodologyDrawer from '$lib/components/health/v2/MethodologyDrawer.svelte';
  import ActivityCorrections from '$lib/components/health/ActivityCorrections.svelte';
  import {
    formatDistance,
    formatDuration,
    formatPace,
    formatSpeed,
    formatElevation,
    formatHeartrate,
    formatEnergy,
    formatLocalDate,
    activityLabel,
    isPaceSport,
  } from '$lib/trails/format';

  let { data } = $props();

  const a = $derived(data.activity);

  /** Just the fields a correction reads and writes. */
  const activity = $derived({
    id: a.id,
    name: a.name,
    activityType: a.activityType,
    sourceType: a.sourceType,
    typeOverride: a.typeOverride,
    excludedFromSegments: a.excludedFromSegments,
  });
  const phys = $derived(data.physio);
  const pace = $derived(isPaceSport(a.activityType));

  let drawerOpen = $state(false);
  let drawerFocus = $state<string | null>(null);
  function openEvidence(id: string) {
    drawerFocus = id;
    drawerOpen = true;
  }

  const elevationPoints = $derived(
    a.elevation.map((p) => [p.distanceM, p.elevationM] as [number, number]),
  );

  const segments = $derived(data.segments ?? []);

  // The full ordered set for this outing — the list page only has room for
  // highlights[0]. An empty array is TRUTHY, so the length is what gets asked.
  const highlights = $derived(data.highlights ?? []);

  /** "2nd of 11" reads better than "rank 2", and says what the 2 is out of. */
  function ordinal(n: number): string {
    const rem100 = n % 100;
    if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
    return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
  }

  const heartRate = $derived(a.series.find((s) => s.metric === 'heart_rate') ?? null);
  const cadence = $derived(a.series.find((s) => s.metric === 'cadence') ?? null);

  const stats = $derived.by(() => {
    const rows = [
      { label: 'Distance', value: formatDistance(a.distanceM) },
      { label: 'Moving', value: formatDuration(a.activeDurationS ?? a.durationS) },
      {
        label: pace ? 'Avg pace' : 'Avg speed',
        value: pace ? formatPace(a.avgPaceSPerKm) : formatSpeed(a.avgPaceSPerKm),
      },
      { label: 'Climb', value: formatElevation(a.elevationGainM) },
      { label: 'Descent', value: formatElevation(a.elevationLossM) },
      { label: 'Avg HR', value: formatHeartrate(a.avgHeartrate) },
      { label: 'Max HR', value: formatHeartrate(a.maxHeartrate) },
      { label: 'Energy', value: formatEnergy(a.activeEnergyKj) },
    ];
    if (phys?.trimp != null) rows.push({ label: 'Load (TRIMP)', value: String(Math.round(phys.trimp)) });
    if (phys?.ef != null) rows.push({ label: 'Efficiency', value: phys.ef.toFixed(2) });
    if (phys?.hrr60 != null) rows.push({ label: 'HRR 1 min', value: `−${phys.hrr60} bpm` });
    if (phys?.mets != null) rows.push({ label: 'Intensity', value: `${phys.mets.toFixed(1)} METs` });
    return rows;
  });

  // Plain-English effort read: decoupling verdict + this workout against the
  // athlete's own same-sport medians. Absent data drops clauses, never zeros.
  const effortLine = $derived.by(() => {
    if (!phys) return '';
    const parts: string[] = [];
    if (phys.decouplingPct != null) {
      const d = phys.decouplingPct;
      parts.push(
        d <= 5
          ? `Aerobic decoupling ${d.toFixed(1)}% — pace-per-beat held to the end`
          : `Aerobic decoupling ${d.toFixed(1)}% — the second half cost more beats per metre (over ~5% suggests the aerobic base ran out)`,
      );
    }
    if (phys.typical.n >= 3) {
      const t = phys.typical;
      const vs: string[] = [];
      if (pace && a.avgPaceSPerKm && t.paceSPerKm) {
        const pct = Math.round(((t.paceSPerKm - a.avgPaceSPerKm) / t.paceSPerKm) * 100);
        if (pct !== 0) vs.push(`pace ${Math.abs(pct)}% ${pct > 0 ? 'faster' : 'slower'} than your ${activityLabel(a.activityType).toLowerCase()} median`);
      }
      if (a.avgHeartrate && t.avgHr) {
        const diff = Math.round(a.avgHeartrate - t.avgHr);
        if (diff !== 0) vs.push(`HR ${diff > 0 ? '+' : ''}${diff} bpm vs typical`);
      }
      if (phys.ef != null && t.ef) {
        const pct = Math.round(((phys.ef - t.ef) / t.ef) * 100);
        if (pct !== 0) vs.push(`efficiency ${pct > 0 ? '+' : ''}${pct}%`);
      }
      if (vs.length) parts.push(`Against your last ${t.n} ${activityLabel(a.activityType).toLowerCase()}s: ${vs.join(', ')}`);
    }
    return parts.join('. ') + (parts.length ? '.' : '');
  });
</script>

<svelte:head>
  <title>{a.name} — Health</title>
  <meta name="robots" content="noindex" />
</svelte:head>

<PageHeader title="Strange Ramblings" />

<main class="wrap">
  <header class="page-hdr">
    <div>
      <div class="kicker">
        Health · {activityLabel(a.activityType)}
        {#if a.typeOverride}<span class="flag" title="Corrected from {activityLabel(a.sourceType)}"
            >corrected</span
          >{/if}
        {#if a.excludedFromSegments}<span class="flag" title="Left out of segment analysis"
            >excluded</span
          >{/if}
      </div>
      <h1>{a.name}</h1>
      <p class="sub">{formatLocalDate(a.startDateLocal, a.startDate)}</p>
    </div>
    <div class="hdr-actions">
      <a class="back-link" href="/health/activities">All activities</a>
      <!-- The same corrections the `···` on the list opens. They belong here
           too: this is the page you are on when you notice the phone called a
           ride a walk. -->
      <ActivityCorrections {activity} />
    </div>
  </header>

  <section class="nm-sec stat-grid">
    {#each stats as s (s.label)}
      <div class="stat">
        <span class="stat-value">{s.value}</span>
        <span class="sr-label-tight">{s.label}</span>
      </div>
    {/each}
  </section>

  {#if highlights.length > 0}
    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">What was excellent</span>
        <span class="nm-sec-meta">best first</span>
      </div>
      <ul class="highlight-list">
        {#each highlights as highlight, i (`${highlight.kind}:${highlight.segmentId ?? ''}:${i}`)}
          <li><HighlightBadge {highlight} /></li>
        {/each}
      </ul>
      <p class="highlight-note">
        Ranks are measured over every outing on record, not the page you came from. Segment
        placings ignore any recording taken out of segment analysis, and efficiency compares only
        within the pace sports — a ride's sits near 4 against a run's 1.
      </p>
    </section>
  {/if}

  {#if a.coordinates && a.coordinates.length > 1}
    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">Route</span>
        <span class="nm-sec-meta">{a.coordinates.length} points</span>
      </div>
      <TrackMap coordinates={a.coordinates} bounds={a.bounds} colourBy="pace" height="440px" />
    </section>
  {/if}

  {#if elevationPoints.length > 1 || heartRate || cadence}
    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">Traces</span>
      </div>

      {#if elevationPoints.length > 1}
        <LineChart
          points={elevationPoints}
          label="Elevation"
          unitSuffix=" m"
          xKind="distance"
          fill
          colour="var(--accent-ink)"
        />
      {/if}

      {#if heartRate}
        <LineChart
          points={heartRate.samples}
          label="Heart rate"
          unitSuffix=" bpm"
          xKind="time"
          colour="var(--accent)"
        />
      {/if}

      {#if cadence}
        <LineChart
          points={cadence.samples}
          label="Cadence"
          unitSuffix=" spm"
          xKind="time"
          colour="var(--text-secondary)"
        />
      {/if}
    </section>
  {/if}

  {#if phys?.zones}
    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">Heart-rate zones</span>
        <span class="nm-sec-meta">
          HRmax {phys.hrMax} <EvidenceChip id="hr-zones" onopen={openEvidence} />
        </span>
      </div>
      <ZoneBar zones={phys.zones} edges={phys.zoneEdges} />
    </section>
  {/if}

  {#if phys && (phys.hrrCurve || effortLine)}
    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">Effort &amp; recovery</span>
        <span class="nm-sec-meta">
          {#if phys.hrr60 != null}
            HRR60 −{phys.hrr60} bpm <EvidenceChip id="hrr60" onopen={openEvidence} />
          {:else if phys.decouplingPct != null}
            <EvidenceChip id="decoupling" onopen={openEvidence} />
          {/if}
        </span>
      </div>

      {#if phys.hrrCurve}
        <LineChart
          points={phys.hrrCurve}
          label="Heart rate after finishing"
          unitSuffix=" bpm"
          xKind="time"
          colour="var(--accent-ink)"
          height={140}
        />
      {/if}

      {#if effortLine}
        <p class="effort-line">{effortLine}</p>
      {/if}
    </section>
  {/if}

  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Splits</span>
      <span class="nm-sec-meta">per kilometre</span>
    </div>
    <SplitsTable splits={a.splits} paceSport={pace} />
  </section>

  {#if segments.length}
    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">Segments on this one</span>
        <a class="nm-sec-meta seg-all" href="/health/segments">All segments →</a>
      </div>
      <ul class="seg-list">
        {#each segments as row (`${row.segmentId}:${row.effort.id}`)}
          <li>
            <a class="seg-row" href="/health/segments/{row.segmentId}">
              <TrackThumb polyline={row.polyline} size={40} />
              <span class="seg-main">
                <span class="seg-name">
                  {row.name}{#if row.effort.lapIndex > 1}<span class="seg-lap"
                      >lap {row.effort.lapIndex}</span
                    >{/if}
                </span>
                <span class="seg-desc">{row.descriptor}</span>
              </span>
              <span class="seg-nums">
                <span class="seg-time">{formatDuration(row.effort.durationS)}</span>
                <span class="seg-rank">
                  <!-- Out of the RANKED efforts, never `effortCount`: an
                       HR-derived metric goes null whenever the heart-rate window
                       covers less than half the effort, which is how a 3rd of 4
                       gets printed as a 3rd of 19. -->
                  {#if row.rankByTime}{ordinal(row.rankByTime)} of {row.rankedByTimeOf} on time{:else}unranked on time{/if}
                  {#if row.rankByEfficiency}
                    · {ordinal(row.rankByEfficiency)} of {row.rankedByEfficiencyOf} on efficiency
                  {/if}
                </span>
              </span>
            </a>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  <section class="nm-sec provenance">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Provenance</span>
    </div>
    <dl class="prov-list">
      <div><dt>Source</dt><dd>{a.source}</dd></div>
      <div><dt>Reported as</dt><dd>{a.rawType ?? '—'}</dd></div>
      <div><dt>Local offset</dt><dd>{a.timezone ?? '—'}</dd></div>
      <div><dt>GPS trace</dt><dd>{a.hasTrack ? 'yes' : 'no'}</dd></div>
      {#if phys?.temperatureC != null}
        <div><dt>Temperature</dt><dd>{phys.temperatureC.toFixed(0)}°C</dd></div>
      {/if}
      {#if phys?.humidityPct != null}
        <div><dt>Humidity</dt><dd>{phys.humidityPct.toFixed(0)}%</dd></div>
      {/if}
      {#if phys?.minHr != null}
        <div><dt>Min HR</dt><dd>{Math.round(phys.minHr)} bpm</dd></div>
      {/if}
      {#if phys?.trimpBasis === 'average'}
        <div><dt>Load basis</dt><dd>avg HR (no series)</dd></div>
      {/if}
    </dl>
  </section>
</main>

<MethodologyDrawer
  open={drawerOpen}
  focusId={drawerFocus}
  onclose={() => (drawerOpen = false)}
/>

<style>
  .seg-all {
    color: var(--accent);
    text-decoration: none;
  }
  .highlight-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .highlight-list li {
    min-width: 0;
    max-width: 24rem;
  }
  .highlight-note {
    margin: 0.85rem 0 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.55;
    color: var(--text-muted);
    max-width: 74ch;
  }

  .seg-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .seg-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.85rem;
    padding: 0.55rem 0.15rem;
    border-bottom: 1px solid var(--line-hair);
    text-decoration: none;
    color: inherit;
  }
  .seg-row:hover {
    background: var(--surface-sunken);
  }
  .seg-main {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }
  .seg-name {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-primary);
    overflow-wrap: anywhere;
  }
  .seg-lap {
    margin-left: 0.4rem;
    font-size: var(--fs-label-xs);
    color: var(--accent);
  }
  .seg-desc,
  .seg-rank {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
  }
  .seg-nums {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    text-align: right;
  }
  .seg-time {
    font-family: var(--font-mono);
    font-size: var(--fs-body);
    color: var(--text-primary);
  }

  .wrap {
    max-width: 1100px;
    margin: 0 auto;
    padding: 2rem 1.5rem 4rem;
  }

  .page-hdr {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 1.5rem;
    margin-bottom: 1.75rem;
    padding-bottom: 1rem;
    border-bottom: 2px solid var(--text-primary);
  }
  .kicker {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: var(--accent);
    margin-bottom: 0.35rem;
  }
  .page-hdr h1 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 2.2rem;
    font-weight: 900;
    line-height: 1.05;
  }
  .sub {
    margin: 0.6rem 0 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-secondary);
  }
  .back-link {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--accent);
    text-decoration: none;
    flex-shrink: 0;
  }
  .back-link:hover {
    text-decoration: underline;
  }
  .hdr-actions {
    display: flex;
    align-items: center;
    gap: 0.9rem;
    flex-shrink: 0;
  }
  /* Same treatment as the list's row flags, so a corrected outing reads the
     same whichever page you meet it on. */
  .flag {
    display: inline-block;
    margin-left: 0.4rem;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--trend-down);
    border: 1px solid var(--trend-down);
    padding: 0 0.25rem;
  }

  /* Fixed column count rather than auto-fit: eight stats against an auto-fit
     track fits seven on a row and orphans the eighth. Four-up divides evenly. */
  .stat-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 1rem 1.25rem;
  }

  @media (max-width: 700px) {
    .stat-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  .stat {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    /* minmax(0, …) on the track is not enough on its own: a grid item's default
       min-width is auto, so a long value would push the column instead of
       wrapping inside it. */
    min-width: 0;
  }

  .stat-value {
    font-family: var(--font-mono);
    font-size: var(--fs-num-md);
    color: var(--text-primary);
    line-height: 1.1;
  }

  .prov-list {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
    gap: 0.75rem;
    margin: 0;
  }

  .prov-list div {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }

  .prov-list dt {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-ghost);
  }

  .prov-list dd {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-primary);
    overflow-wrap: anywhere;
  }

  .effort-line {
    margin: 0.4rem 0 0;
    font-size: var(--fs-body-sm);
    line-height: 1.55;
    color: var(--text-secondary);
    max-width: 72ch;
  }
</style>
