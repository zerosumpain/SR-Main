<script lang="ts">
  // A — STATE OF PLAY. The dark opening band: readiness on the left as a donut
  // and four weighted factor bars, six metric tiles on the right, and one
  // accent panel underneath saying what the whole thing adds up to.
  //
  // The donut is drawn by hand rather than through a chart component because
  // the geometry IS the design: r=50, stroke-width 10, a `stroke-dasharray` cut
  // from the 314.2 circumference, rotated −90° so the arc starts at twelve
  // o'clock. Everything else on the page that draws an arc would draw a
  // different one.
  //
  // Every tile survives an empty payload. `HealthDay` carries no nulls — 0 is
  // its missing sentinel — so a zero reads as "nothing synced" and prints an em
  // dash, never as a resting heart rate of nought.
  import type { HealthDay } from '$lib/health/series-30d-service';
  import type { ReadinessResponse } from '$lib/health/types';
  import type { TrailsDashboard } from '$lib/trails/physio-service';
  import type { MetricResult } from '$lib/health/analytics/types';
  import type { ACWRResult } from '$lib/health/analytics/acwr';
  import type { VO2Result } from '$lib/health/analytics/vo2max-percentile';
  import { ACWR_BANDS } from '$lib/health/analytics/acwr';
  import { usable, todayLede } from '$lib/health/ledes';
  import type { WeeklyVolumeRead } from './types';
  import { fixed, whole, signed, ordinal, duration } from './format';
  import { sparkPoints, sample, bars } from './chart';

  interface Props {
    today: HealthDay | null;
    series: HealthDay[];
    rhrBaseline: number;
    todayDeltas: { recDelta: number; hrvDeltaPct: number; rhrDelta: number; sleepDelta: number } | null;
    syncedAgoSeconds: number;
    readiness: ReadinessResponse | null;
    dashboard: TrailsDashboard | null;
    vo2max: MetricResult<VO2Result> | null;
    acwr: MetricResult<ACWRResult> | null;
    volume: WeeklyVolumeRead | null;
  }

  let {
    today,
    series,
    rhrBaseline,
    todayDeltas,
    syncedAgoSeconds,
    readiness,
    dashboard,
    vo2max,
    acwr,
    volume,
  }: Props = $props();

  // ——— the donut ————————————————————————————————————————————————
  /** Circumference of r=50, to one decimal — the number the dasharray cuts. */
  const CIRCUMFERENCE = 314.2;
  const score = $derived(readiness ? Math.round(readiness.score) : null);
  const arc = $derived(((score ?? 0) / 100) * CIRCUMFERENCE);

  // ——— the four weighted factors ————————————————————————————————
  //
  // `value` is 0–100 and `weight` is the share of the composite it carries, so
  // the points a factor is actually contributing are value × weight × 100 out
  // of weight × 100. The bar fills to `value`, which is why a factor can look
  // three-quarters full while costing five points of the score.
  interface FactorRow {
    label: string;
    value: number;
    weight: number;
    got: number;
    outOf: number;
    /** Under half marks — the factor the note below the bars names. */
    weak: boolean;
    arrow: string;
  }

  const factors = $derived.by((): FactorRow[] => {
    if (!readiness) return [];
    const f = readiness.factors;
    const row = (label: string, v: { value: number; weight: number }, arrow = ''): FactorRow => ({
      label,
      value: Math.max(0, Math.min(100, v.value)),
      weight: v.weight,
      got: Math.round(v.value * v.weight),
      outOf: Math.round(v.weight * 100),
      weak: v.value < 50,
      arrow,
    });
    const dir = f.hrvTrend.direction;
    return [
      row('Recovery', f.recovery),
      row('HRV trend', f.hrvTrend, dir === 'up' ? '↑' : dir === 'down' ? '↓' : ''),
      row('Sleep quality', f.sleepQuality),
      row('Load balance', f.loadBalance),
    ];
  });

  /** The sentence under the bars: which factor is costing the score, and how
   *  much of it. Assembled from the same numbers the bars draw. */
  const factorNote = $derived.by((): string => {
    const weak = factors.filter((f) => f.weak);
    if (!factors.length) return '';
    if (!weak.length) {
      return 'All four factors are at or above half marks. Nothing in the composite is holding the score down.';
    }
    if (weak.length === 1) {
      const f = weak[0];
      return `${f.label} is the only factor under half marks. It carries ${f.outOf} points of the 100 and is costing ${f.outOf - f.got} of them.`;
    }
    const names = weak.map((f) => f.label.toLowerCase());
    const cost = weak.reduce((n, f) => n + (f.outOf - f.got), 0);
    const list = `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    return `${weak.length} factors are under half marks — ${list} — costing ${cost} points between them.`;
  });

  // ——— the six tiles ————————————————————————————————————————————
  //
  // Nine sampled points is the shape the design draws: enough to show a
  // direction over thirty days, few enough that the 26px strip stays a
  // sparkline rather than a chart.
  const SPARK_POINTS = 9;
  const present = (values: number[]) => values.filter((v) => Number.isFinite(v) && v > 0);
  const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

  interface Tile {
    label: string;
    value: string;
    unit: string;
    /** Sampled series for the 26px strip. Under two points, no line is drawn. */
    spark: number[];
    /** Week bars instead of a line — the volume tile, and only that one. */
    weekBars: number[] | null;
    good: boolean;
    foot: string;
  }

  const recSeries = $derived(present(series.map((d) => d.rec)));
  const hrvSeries = $derived(present(series.map((d) => d.hrv)));
  const rhrSeries = $derived(present(series.map((d) => d.rhr)));
  const sleptSeries = $derived(present(series.map((d) => d.slept)));

  /** The last seven completed-or-current weeks, kilometres, oldest first. */
  const weekKms = $derived((dashboard?.weeks ?? []).slice(-7).map((w) => w.totalDistanceM / 1000));

  const tiles = $derived.by((): Tile[] => {
    const out: Tile[] = [];
    const rec = today?.rec ?? 0;
    const recWeek = mean(recSeries.slice(-7));
    out.push({
      label: 'Recovery',
      value: rec > 0 ? whole(rec) : '—',
      unit: '%',
      spark: sample(recSeries, SPARK_POINTS),
      weekBars: null,
      good: (todayDeltas?.recDelta ?? 0) >= 0,
      foot:
        rec > 0 && todayDeltas
          ? `${todayDeltas.recDelta >= 0 ? '↑' : '↓'}${Math.abs(Math.round(todayDeltas.recDelta))} vs 7d${recWeek ? ` · wk ${Math.round(recWeek)}%` : ''}`
          : 'no recovery score yet',
    });

    const hrv = today?.hrv ?? 0;
    const hrv7 = dashboard?.hrv?.latest7 ?? mean(hrvSeries.slice(-7));
    const trough = hrvSeries.length ? Math.min(...hrvSeries) : null;
    out.push({
      label: 'HRV RMSSD',
      value: hrv > 0 ? whole(hrv) : '—',
      unit: 'ms',
      spark: sample(hrvSeries, SPARK_POINTS),
      weekBars: null,
      good: hrv > 0 && hrv7 != null && hrv >= hrv7,
      foot:
        hrv7 != null
          ? `7d mean ${Math.round(hrv7)}${trough != null ? ` · trough ${Math.round(trough)}` : ''}`
          : 'awaiting a week of readings',
    });

    const rhr = today?.rhr ?? 0;
    const rhrDelta = todayDeltas?.rhrDelta ?? 0;
    const peak = rhrSeries.length ? Math.max(...rhrSeries) : null;
    out.push({
      label: 'Resting HR',
      value: rhr > 0 ? whole(rhr) : '—',
      unit: 'bpm',
      spark: sample(rhrSeries, SPARK_POINTS),
      weekBars: null,
      good: rhr > 0 && rhrDelta <= 0,
      foot:
        rhr > 0 && rhrBaseline > 0
          ? `${rhrDelta === 0 ? 'on baseline' : `${signed(rhrDelta)} on ${Math.round(rhrBaseline)}`}${peak != null ? ` · peak ${Math.round(peak)}` : ''}`
          : 'no resting reading',
    });

    const slept = today?.slept ?? 0;
    const sleptMean = mean(sleptSeries);
    const best = sleptSeries.length ? Math.max(...sleptSeries) : null;
    out.push({
      label: 'Sleep',
      value: slept > 0 ? fixed(slept, 1) : '—',
      unit: 'h',
      spark: sample(sleptSeries, SPARK_POINTS),
      weekBars: null,
      good: slept > 0 && sleptMean != null && slept >= sleptMean,
      foot:
        sleptMean != null
          ? `30d mean ${sleptMean.toFixed(1)}${best != null && slept >= best ? ' · best tonight' : ''}`
          : 'no sleep recorded',
    });

    const lastWeek = dashboard?.weeks?.[dashboard.weeks.length - 1] ?? null;
    const sessions = lastWeek
      ? (dashboard?.workouts ?? []).filter((w) => w.day >= lastWeek.weekStart).length
      : 0;
    const lowestOfRun = weekKms.length > 1 && weekKms[weekKms.length - 1] === Math.min(...weekKms);
    out.push({
      label: 'Week volume',
      value: volume ? fixed(volume.weekKm, 1) : lastWeek ? fixed(lastWeek.totalDistanceM / 1000, 1) : '—',
      unit: 'km',
      spark: [],
      weekBars: weekKms,
      good: !!volume && volume.weekKm >= volume.medianKm,
      foot: lastWeek
        ? `${sessions} session${sessions === 1 ? '' : 's'} · ${duration(lastWeek.totalS)}${lowestOfRun ? ` · ${weekKms.length}wk low` : ''}`
        : 'no completed week',
    });

    const vo2 = usable(vo2max) ? vo2max.value : null;
    out.push({
      label: 'VO₂max',
      value: vo2 ? fixed(vo2.current, 1) : '—',
      unit: '',
      spark: sample((dashboard?.vo2.series ?? []).map((p) => p.value), SPARK_POINTS),
      weekBars: null,
      good: !!vo2 && vo2.trendSlopePerMonth >= 0,
      foot: vo2
        ? `${signed(vo2.trendSlopePerMonth, 2)}/mo · ${ordinal(vo2.percentile)} pct`
        : 'needs 90 days of estimates',
    });

    return out;
  });

  // ——— the accent panel ————————————————————————————————————————
  //
  // Left: the derived one-line read, the same sentence `ledes.ts` writes for
  // the chapter opener — pure, tested, and not a second opinion.
  const oneLineRead = $derived(
    today
      ? todayLede({
          recovery: today.rec,
          hrv: today.hrv,
          rhr: today.rhr,
          slept: today.slept,
          rhrBaseline,
          deltas: todayDeltas,
          readinessLabel: readiness?.label ?? null,
          syncedAgoSeconds,
        })
      : '',
  );

  // Right: the two gates `planner.ts` actually applies to a readiness score,
  // and the ACWR band `coach.ts` reads as licence to add distance. Both are
  // stated as thresholds so the reader can check the arithmetic.
  const WALK_SUBSTITUTION_GATE = 40;
  const STEADY_CLIMB_GATE = 55;

  const plannerRead = $derived.by((): string => {
    if (!readiness) return 'Readiness has not scored yet, so the planner is running on load alone.';
    const s = Math.round(readiness.score);
    const gate =
      s < WALK_SUBSTITUTION_GATE
        ? `Readiness ${s} is under the walk-substitution gate (<${WALK_SUBSTITUTION_GATE}): a run becomes a walk today.`
        : s < STEADY_CLIMB_GATE
          ? `Readiness ${s} clears the walk-substitution gate (<${WALK_SUBSTITUTION_GATE}) but not the steady-climb gate (<${STEADY_CLIMB_GATE}), so the climbing stays steady.`
          : `Readiness ${s} clears the walk-substitution gate (<${WALK_SUBSTITUTION_GATE}) and the steady-climb gate (<${STEADY_CLIMB_GATE}). A run is authorised.`;
    if (!usable(acwr)) return `${gate} No acute-to-chronic ratio yet, so the distance is the recent median.`;
    const { ratio, zone } = acwr.value;
    if (ratio < ACWR_BANDS.undertraining) {
      return `${gate} ACWR ${ratio.toFixed(2)} sits in the undertraining band, so the target gains 10% on the recent median.`;
    }
    if (zone === 'caution' || zone === 'danger') {
      return `${gate} ACWR ${ratio.toFixed(2)} is in the ${zone} band, which overrides the above and cuts the distance.`;
    }
    return `${gate} ACWR ${ratio.toFixed(2)} is inside the optimal band, so the recent median stands unadjusted.`;
  });
</script>

<section class="a">
  <div class="a-inner">
    <div class="a-head">
      <p class="a-kicker">A / State of play</p>
      <p class="a-meta">Readiness · four weighted factors · Whoop + Apple</p>
    </div>

    <div class="a-grid">
      <div class="a-readiness">
        <div class="a-dial">
          <svg viewBox="0 0 120 120" class="a-donut" role="img" aria-label={score != null ? `Readiness ${score} of 100` : 'Readiness not scored'}>
            <circle cx="60" cy="60" r="50" fill="none" stroke="rgba(237,228,212,0.14)" stroke-width="10" />
            {#if score != null}
              <circle
                cx="60"
                cy="60"
                r="50"
                fill="none"
                stroke="var(--accent-on-dark)"
                stroke-width="10"
                stroke-linecap="butt"
                stroke-dasharray="{arc.toFixed(1)} {CIRCUMFERENCE}"
                transform="rotate(-90 60 60)"
              />
            {/if}
            <text x="60" y="58" text-anchor="middle" class="a-donut-score">{score ?? '—'}</text>
            <text x="60" y="76" text-anchor="middle" class="a-donut-unit" letter-spacing="1.5">OF 100</text>
          </svg>
          <div class="a-dial-text">
            <p class="a-dial-label">Readiness</p>
            <p class="a-dial-verdict">{readiness?.label ?? 'Not scored'}</p>
            {#if readiness?.recommendation}
              <p class="a-dial-rec">{readiness.recommendation}</p>
            {/if}
          </div>
        </div>

        {#if factors.length}
          <div class="a-factors">
            {#each factors as f (f.label)}
              <div>
                <div class="a-factor-head">
                  <p class="a-factor-name" class:weak={f.weak}>
                    {f.label} <span class="a-factor-weight">w.{String(Math.round(f.weight * 100)).padStart(2, '0')}</span>
                  </p>
                  <p class="a-factor-score" class:weak={f.weak}>{f.got}/{f.outOf} {f.arrow}</p>
                </div>
                <div class="a-factor-track">
                  <div class="a-factor-fill" class:weak={f.weak} style="width: {f.value}%"></div>
                </div>
              </div>
            {/each}
            <p class="a-factor-note">{factorNote}</p>
          </div>
        {/if}
      </div>

      <div>
        <div class="a-tiles">
          {#each tiles as t (t.label)}
            <div class="a-tile">
              <p class="a-tile-label">{t.label}</p>
              <p class="a-tile-value">{t.value}{#if t.unit}<span class="a-tile-unit">{t.unit}</span>{/if}</p>
              {#if t.weekBars}
                <svg viewBox="0 0 100 26" preserveAspectRatio="none" class="a-spark" aria-hidden="true">
                  {#each bars(t.weekBars, 100, 26, 4) as b, i (i)}
                    <rect
                      x={b.x}
                      y={b.y}
                      width={b.w}
                      height={b.h}
                      fill={i === t.weekBars.length - 1
                        ? t.good
                          ? 'var(--good-on-dark)'
                          : 'var(--accent-on-dark)'
                        : 'rgba(237,228,212,0.3)'}
                    />
                  {/each}
                </svg>
              {:else}
                <svg viewBox="0 0 100 26" preserveAspectRatio="none" class="a-spark" aria-hidden="true">
                  <polyline
                    points={sparkPoints(t.spark, 100, 22)}
                    fill="none"
                    stroke={t.good ? 'var(--good-on-dark)' : 'var(--accent-on-dark)'}
                    stroke-width="1.6"
                    transform="translate(0 2)"
                  />
                </svg>
              {/if}
              <p class="a-tile-foot" class:good={t.good}>{t.foot}</p>
            </div>
          {/each}
        </div>

        <div class="a-panel">
          <div>
            <p class="a-panel-label">The one-line read</p>
            <p class="a-panel-text">{oneLineRead || 'Nothing has synced into the window yet.'}</p>
          </div>
          <div>
            <p class="a-panel-label">What the planner would commission</p>
            <p class="a-panel-text">{plannerRead}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>

<style>
  .a {
    background: var(--text-primary);
    color: var(--bg);
    padding: clamp(32px, 4vw, 56px) clamp(20px, 3vw, 44px);
  }
  .a-inner {
    max-width: 1400px;
    margin: 0 auto;
  }

  .a-head {
    display: flex;
    align-items: baseline;
    gap: 16px;
    flex-wrap: wrap;
    margin-bottom: 28px;
  }
  .a-kicker,
  .a-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    margin: 0;
  }
  .a-kicker {
    font-weight: 500;
    letter-spacing: 0.18em;
    color: var(--accent-on-dark);
  }
  .a-meta {
    letter-spacing: 0.14em;
    color: rgba(237, 228, 212, 0.45);
  }

  .a-grid {
    display: grid;
    grid-template-columns: minmax(0, 320px) minmax(0, 1fr);
    gap: clamp(24px, 3vw, 44px);
    align-items: start;
  }

  /* ——— readiness card ——————————————————————————————————————— */
  .a-readiness {
    border: 1px solid rgba(237, 228, 212, 0.16);
    background: rgba(237, 228, 212, 0.05);
    padding: 24px;
  }
  .a-dial {
    display: flex;
    align-items: center;
    gap: 20px;
    margin-bottom: 22px;
  }
  .a-donut {
    width: 108px;
    height: 108px;
    flex-shrink: 0;
  }
  .a-donut-score {
    font-family: var(--font-display);
    font-size: 34px; /* svg-user-units: viewBox 0 0 120 120, drawn 108px wide */
    fill: var(--bg);
  }
  .a-donut-unit {
    font-family: var(--font-mono);
    font-size: 9px; /* svg-user-units: viewBox 0 0 120 120, drawn 108px wide */
    fill: rgba(237, 228, 212, 0.55);
  }
  .a-dial-text {
    min-width: 0;
  }
  .a-dial-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: rgba(237, 228, 212, 0.55);
    margin: 0 0 8px;
  }
  .a-dial-verdict {
    font-family: var(--font-display);
    font-size: 21px;
    line-height: 1;
    letter-spacing: -0.02em;
    text-transform: uppercase;
    margin: 0 0 10px;
  }
  .a-dial-rec {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--accent-on-dark);
    margin: 0;
  }

  .a-factors {
    display: flex;
    flex-direction: column;
    gap: 11px;
    padding-top: 20px;
    border-top: 1px solid rgba(237, 228, 212, 0.16);
  }
  .a-factor-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 5px;
  }
  .a-factor-name,
  .a-factor-score {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    margin: 0;
  }
  .a-factor-name {
    font-weight: 500;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  .a-factor-weight {
    color: rgba(237, 228, 212, 0.45);
  }
  .a-factor-score {
    color: rgba(237, 228, 212, 0.7);
  }
  .a-factor-name.weak,
  .a-factor-score.weak {
    color: var(--accent-on-dark);
  }
  .a-factor-name.weak .a-factor-weight {
    color: inherit;
    opacity: 0.6;
  }
  .a-factor-track {
    height: 6px;
    background: rgba(237, 228, 212, 0.14);
  }
  .a-factor-fill {
    height: 6px;
    background: var(--good-on-dark);
  }
  .a-factor-fill.weak {
    background: var(--accent-on-dark);
  }
  .a-factor-note {
    font-size: var(--fs-label);
    line-height: 1.5;
    color: rgba(237, 228, 212, 0.7);
    margin: 8px 0 0;
    text-wrap: pretty;
  }

  /* ——— tiles ————————————————————————————————————————————————— */
  .a-tiles {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(184px, 1fr));
    gap: 14px;
  }
  .a-tile {
    background: var(--text-primary);
    border: 1px solid rgba(237, 228, 212, 0.16);
    padding: 18px;
    min-width: 0;
  }
  .a-tile-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: rgba(237, 228, 212, 0.55);
    margin: 0 0 10px;
  }
  .a-tile-value {
    font-family: var(--font-display);
    font-size: 32px;
    line-height: 0.9;
    letter-spacing: -0.02em;
    margin: 0;
  }
  .a-tile-unit {
    font-size: var(--fs-label);
    color: rgba(237, 228, 212, 0.45);
  }
  .a-spark {
    width: 100%;
    height: 26px;
    margin: 10px 0 8px;
    display: block;
  }
  .a-tile-foot {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--accent-on-dark);
    margin: 0;
  }
  .a-tile-foot.good {
    color: var(--good-on-dark);
  }

  /* ——— the accent panel ——————————————————————————————————————— */
  .a-panel {
    margin-top: 20px;
    border: 1px solid rgba(232, 134, 58, 0.4);
    background: rgba(232, 134, 58, 0.09);
    padding: 20px 22px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 24px;
  }
  .a-panel-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--accent-on-dark);
    margin: 0 0 10px;
  }
  .a-panel-text {
    font-size: var(--fs-body-sm);
    line-height: 1.5;
    color: var(--bg);
    margin: 0;
    text-wrap: pretty;
  }

  @media (max-width: 860px) {
    .a-grid,
    .a-panel {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
