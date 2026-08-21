<script lang="ts">
  // Fitness section: VO₂max cardio-fitness (banded percentile gauge + honest
  // trend/cohort note), a 7-day activity-volume strip, and all-time personal
  // records. Each card fails soft — if its source is null/insufficient (or, for
  // the getStats-derived cards, entirely zero/empty) it is simply omitted, never
  // rendered as a zero stub. Shared .h-detail-grid / .h-card / .h-card-* classes
  // come from the globally imported cards.css; only bespoke viz classes live in
  // this file's style block.
  import BandGauge from './BandGauge.svelte';
  import { ordinal } from '$lib/trails/highlights';
  import EvidenceChip from '$lib/components/health/EvidenceChip.svelte';

  type Sufficiency = 'ok' | 'partial' | 'insufficient';

  type Band = 'poor' | 'fair' | 'good' | 'excellent' | 'superior';

  type VO2Max = {
    value: {
      current: number;
      trendSlopePerMonth: number;
      percentile: number;
      band: Band;
    };
    sufficiency: Sufficiency;
    asOf: string;
    sampleSize: number;
  };

  type Stats = {
    weekly: {
      activities: number;
      totalDistance: number; // metres
      totalDuration: number; // seconds
      totalElevation: number; // metres
      avgRecovery: number;
      avgSleep: number;
    };
    personalRecords: {
      label: string;
      value: number;
      unit: string;
      date: string;
      /** Pre-formatted, where value + unit cannot say it — a pace is 5:25, not 5.41. */
      display?: string;
    }[];
  };

  let {
    vo2max,
    stats,
    onevidence,
  }: {
    vo2max: VO2Max | null;
    stats: Stats | null;
    onevidence?: (id: string) => void;
  } = $props();

  // --- Card 1: VO₂max -----------------------------------------------------
  const showVo2 = $derived(!!vo2max && vo2max.sufficiency !== 'insufficient');

  // Band → tag tone/label. good/excellent/superior all read as "good" (accent),
  // fair = warn (amber), poor = bad (brown). Tag text is the uppercase band.
  function vo2Tag(band: Band): { label: string; tone: 'good' | 'warn' | 'bad' } {
    if (band === 'fair') return { label: 'FAIR', tone: 'warn' };
    if (band === 'poor') return { label: 'POOR', tone: 'bad' };
    return { label: band.toUpperCase(), tone: 'good' };
  }
  function vo2ValueTone(band: Band): '' | 'accent' | 'warn' | 'bad' {
    if (band === 'fair') return 'warn';
    if (band === 'poor') return 'bad';
    return 'accent';
  }

  const VO2_ZONES = [
    { to: 20, label: 'POOR', tone: 'bad' as const },
    { to: 40, label: 'FAIR', tone: 'warn' as const },
    { to: 60, label: 'GOOD', tone: 'good' as const },
    { to: 80, label: 'EXCELLENT', tone: 'good' as const },
    { to: 100, label: 'SUPERIOR', tone: 'good' as const },
  ];
  const VO2_ACTIVE: Record<Band, number> = {
    poor: 0,
    fair: 1,
    good: 2,
    excellent: 3,
    superior: 4,
  };

  const vo2tag = $derived(showVo2 ? vo2Tag(vo2max!.value.band) : null);
  const vo2valTone = $derived(showVo2 ? vo2ValueTone(vo2max!.value.band) : '');
  const vo2active = $derived(showVo2 ? VO2_ACTIVE[vo2max!.value.band] : -1);

  const vo2Trend = $derived.by(() => {
    if (!showVo2) return '';
    const s = vo2max!.value.trendSlopePerMonth;
    return s >= 0 ? '↑ +' + s.toFixed(2) + '/mo' : '↓ ' + s.toFixed(2) + '/mo';
  });

  // --- Card 2: This week --------------------------------------------------
  const w = $derived(stats?.weekly ?? null);

  // Build the mini-list rows, omitting the optional avg rows when 0.
  type StatRow = { label: string; value: string; unit: string };
  const weekRows = $derived.by((): StatRow[] => {
    if (!w) return [];
    const rows: StatRow[] = [
      { label: 'ACTIVITIES', value: String(w.activities), unit: '' },
      { label: 'DISTANCE', value: (w.totalDistance / 1000).toFixed(1), unit: 'KM' },
      { label: 'DURATION', value: fmtDuration(w.totalDuration), unit: '' },
      { label: 'ELEVATION', value: String(Math.round(w.totalElevation)), unit: 'M' },
    ];
    // avgRecovery + avgSleep are Whoop 0–100 performance scores (NOT hours).
    if (w.avgRecovery) rows.push({ label: 'AVG RECOVERY', value: String(Math.round(w.avgRecovery)), unit: '%' });
    if (w.avgSleep) rows.push({ label: 'AVG SLEEP SCORE', value: String(Math.round(w.avgSleep)), unit: '%' });
    return rows;
  });

  // Omit the whole card if every weekly figure is zero.
  const showWeek = $derived(
    !!w &&
      !(
        w.activities === 0 &&
        w.totalDistance === 0 &&
        w.totalDuration === 0 &&
        w.totalElevation === 0 &&
        w.avgRecovery === 0 &&
        w.avgSleep === 0
      ),
  );

  function fmtDuration(secs: number): string {
    const total = Math.max(0, Math.round(secs / 60)); // minutes
    const h = Math.floor(total / 60);
    const m = total % 60;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  const weekSummary = $derived.by(() => {
    if (!showWeek || !w) return '';
    const km = (w.totalDistance / 1000).toFixed(1);
    return `${w.activities} ${w.activities === 1 ? 'session' : 'sessions'}, ${km}km logged over ${fmtDuration(w.totalDuration)} of moving time.`;
  });

  // --- Card 3: Personal records -------------------------------------------
  const prs = $derived(stats?.personalRecords ?? []);
  const showPrs = $derived(prs.length > 0);

  function fmtPr(value: number): string {
    // Trim trailing zeros for clean display-font numerals.
    return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
  }
</script>

{#if showVo2 || showWeek || showPrs}
  <div class="h-detail-grid">
    {#if showVo2 && vo2max && vo2tag}
      <!-- VO₂max -->
      <div class="h-card span-6">
        <div class="h-card-head">
          <div class="h-card-head-l">
            <p class="h-card-name">VO₂MAX · CARDIO FITNESS</p>
            <EvidenceChip id="vo2max" onopen={onevidence} />
          </div>
          <span class="h-card-tag {vo2tag.tone}">{vo2tag.label}</span>
        </div>

        <p class="h-card-value {vo2valTone}">
          {vo2max.value.current.toFixed(1)}<span class="h-card-unit"> ml/kg/min</span>
        </p>

        <div class="fit-gauge">
          <BandGauge
            value={vo2max.value.percentile}
            min={0}
            max={100}
            zones={VO2_ZONES}
            active={vo2active}
            formatValue={(v) => ordinal(Math.round(v))}
          />
        </div>

        <p class="h-card-foot action">
          Trending <em>{vo2Trend}</em> — percentile vs ACSM 30–39 M norms (profile
          fixed at age 32 / male, so read the trend not the rank). Trend's what
          matters — keep the easy-aerobic base.
        </p>
      </div>
    {/if}

    {#if showWeek && w}
      <!-- This week -->
      <div class="h-card span-3 tinted">
        <div class="h-card-head">
          <div class="h-card-head-l">
            <p class="h-card-name">THIS WEEK · 7D</p>
          </div>
        </div>

        <dl class="fit-stats">
          {#each weekRows as r, i (i)}
            <dt class="fit-stat-label">{r.label}</dt>
            <dd class="fit-stat-val">
              {r.value}{#if r.unit}<span class="fit-stat-unit">{r.unit}</span>{/if}
            </dd>
          {/each}
        </dl>

        <p class="h-card-foot">{weekSummary}</p>
      </div>
    {/if}

    {#if showPrs}
      <!-- Personal records -->
      <div class="h-card span-3">
        <div class="h-card-head">
          <div class="h-card-head-l">
            <p class="h-card-name">RECORDS · ALL-TIME</p>
          </div>
        </div>

        <ul class="fit-prs">
          {#each prs as pr, i (i)}
            <li class="fit-pr">
              <span class="fit-pr-label">{pr.label}</span>
              <span class="fit-pr-val">
                {#if pr.display}{pr.display}{:else}{fmtPr(pr.value)}<span class="fit-pr-unit">
                    {pr.unit}</span
                  >{/if}
              </span>
              <span class="fit-pr-date">{pr.date}</span>
            </li>
          {/each}
        </ul>

        <p class="h-card-foot">Best efforts across all logged activity — not just this week.</p>
      </div>
    {/if}
  </div>
{/if}

<style>
  /* Gauge needs headroom above the track for its marker value label. */
  .fit-gauge {
    margin-top: 14px;
    margin-bottom: 2px;
  }

  /* This-week 2-col mini list ---------------------------------------------- */
  .fit-stats {
    display: grid;
    grid-template-columns: auto 1fr;
    align-items: baseline;
    column-gap: 12px;
    row-gap: 9px;
    margin: 4px 0 0;
  }
  .fit-stat-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0;
  }
  .fit-stat-val {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 20px;
    line-height: 0.95;
    letter-spacing: -0.01em;
    color: var(--text-primary);
    text-align: right;
    margin: 0;
    white-space: nowrap;
  }
  .fit-stat-unit {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 400;
    letter-spacing: 0.1em;
    color: var(--text-muted);
    margin-left: 3px;
  }

  /* Personal records list -------------------------------------------------- */
  .fit-prs {
    list-style: none;
    margin: 4px 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .fit-pr {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: baseline;
    column-gap: 10px;
    row-gap: 2px;
  }
  .fit-pr-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-muted);
    grid-column: 1;
    grid-row: 1;
  }
  .fit-pr-val {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 22px;
    line-height: 0.95;
    letter-spacing: -0.01em;
    color: var(--text-primary);
    text-align: right;
    white-space: nowrap;
    grid-column: 2;
    grid-row: 1 / span 2;
    align-self: center;
  }
  .fit-pr-unit {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 400;
    letter-spacing: 0.1em;
    color: var(--text-muted);
  }
  .fit-pr-date {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-ghost);
    grid-column: 1;
    grid-row: 2;
  }
</style>
