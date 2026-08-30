<script lang="ts">
  // B — THE INSTRUMENT DECK. Eight analytics the site already computes and
  // mostly does not show, one panel each, on the same dark ground as A.
  //
  // TWO RULES RUN THROUGH EVERY PANEL.
  //
  //  1. THE ZERO STRUCT IS NOT A READING. Every analytic returns a
  //     `MetricResult<T>` whose `value` is never null — an `insufficient`
  //     result carries a fully-populated struct of noughts, so `ratio: 0` and
  //     `band: 'low'` come back looking exactly like a measurement. Each panel
  //     goes through `usable()` first and, when it fails, prints an em dash and
  //     swaps its badge from `DERIVED · 28d` to `NEEDS 28d`. A band read off
  //     nine days is a guess wearing a number.
  //  2. THE WINDOW IS ON THE BADGE. Every panel states the sample it needs
  //     before its band means anything, whether or not it has it.
  //
  // The gauges are `fr` columns rather than percentages so the 2px gaps come
  // out of the tracks instead of overflowing the row — the same reason the
  // card grid below carries its own borders rather than a 1px-gap container.
  import type { MetricResult } from '$lib/health/analytics/types';
  import { ACWR_BANDS, type ACWRResult } from '$lib/health/analytics/acwr';
  import type { MonotonyResult } from '$lib/health/analytics/monotony';
  import {
    POLARISED_EASY_PCT,
    POLARISED_HARD_PCT,
    type PolarisedResult,
  } from '$lib/health/analytics/polarised';
  import { SRI_TARGET } from '$lib/health/analytics/sri';
  import type { CircadianResult } from '$lib/health/analytics/circadian';
  import type { AutonomicResult } from '$lib/health/analytics/autonomic-balance';
  import {
    SLEEP_DEBT_FLAG_MIN,
    type RecoveryDebtResult,
  } from '$lib/health/analytics/recovery-debt';
  import type { TrendSeries } from '$lib/trails/physio-service';
  import { usable } from '$lib/health/ledes';
  import SectionHead from './SectionHead.svelte';
  import { fixed, whole, signed, clockFromMinutes, hoursAndMinutes } from './format';
  import { sparkPoints, barHeights, extent, yOf, sample } from './chart';

  interface Props {
    acwr: MetricResult<ACWRResult> | null;
    monotony: MetricResult<MonotonyResult> | null;
    polarised: MetricResult<PolarisedResult> | null;
    sleepRegularity: MetricResult<number> | null;
    circadian: MetricResult<CircadianResult> | null;
    autonomic: MetricResult<AutonomicResult> | null;
    recoveryDebt: MetricResult<RecoveryDebtResult> | null;
    /** Beats per kilometre — `TrailsDashboard.efficiency.bkm`. */
    efficiency: TrendSeries | null;
    /** Daily TRIMP, oldest first. The monotony panel draws the last seven. */
    loadDays: Array<{ date: string; load: number }>;
  }

  let {
    acwr,
    monotony,
    polarised,
    sleepRegularity,
    circadian,
    autonomic,
    recoveryDebt,
    efficiency,
    loadDays,
  }: Props = $props();

  type Tone = 'accent' | 'good' | 'plain';

  interface Panel {
    id: string;
    name: string;
    /** The sample the metric needs — `28d`, `7d`, `4 outings`. */
    window: string;
    readable: boolean;
    value: string;
    unit: string;
    /** The band, in the words the analytic uses. Rendered beside the figure. */
    verdict: string;
    valueTone: Tone;
    verdictTone: Tone;
    body: string;
    /** A note under the chart — what the dashed line is, what the axis means. */
    caption?: string;
  }

  const NEEDS = (window: string, what: string): string =>
    `Needs ${window} of ${what} before this band means anything. The analytic returns a zero struct until then, which is why the figure is an em dash rather than a number.`;

  // ——— 1 · ACWR ——————————————————————————————————————————————————
  const acwrPanel = $derived.by((): Panel => {
    const base = { id: 'acwr', name: 'ACWR · EWMA', window: '28d', unit: '' };
    if (!usable(acwr)) {
      return {
        ...base,
        readable: false,
        value: '—',
        verdict: 'no read',
        valueTone: 'plain',
        verdictTone: 'plain',
        body: NEEDS('fourteen days', 'daily load'),
      };
    }
    const { ratio, zone } = acwr.value;
    const optimal = zone === 'optimal';
    const tail =
      zone === 'detraining'
        ? 'Under the detraining line: the chronic base itself is going backwards, and no single session fixes that.'
        : zone === 'undertraining'
          ? `Below ${ACWR_BANDS.undertraining.toFixed(1)} is undertraining, and the planner reads it as licence to add 10%. Two more weeks this thin and it drops into detraining.`
          : zone === 'optimal'
            ? `Inside ${ACWR_BANDS.undertraining.toFixed(1)}–${ACWR_BANDS.optimal.toFixed(1)}, which is where fitness builds without breaking. Nothing to do but keep it there.`
            : zone === 'caution'
              ? `Past ${ACWR_BANDS.optimal.toFixed(1)}. Recent work has outrun the base it sits on; the next week is the one that decides.`
              : `Past ${ACWR_BANDS.caution.toFixed(1)} — the band injuries come from. The coach locks the session to recovery here regardless of readiness.`;
    return {
      ...base,
      readable: true,
      value: ratio.toFixed(2),
      verdict: zone,
      valueTone: optimal ? 'good' : 'accent',
      verdictTone: optimal ? 'good' : 'accent',
      body: `Acute 7-day EWMA against chronic 28-day. ${tail}`,
      caption: `${ACWR_BANDS.detraining.toFixed(1)} detrain · ${ACWR_BANDS.undertraining.toFixed(1)} under · ${ACWR_BANDS.optimal.toFixed(1)} optimal · ${ACWR_BANDS.caution.toFixed(1)} caution`,
    };
  });

  /** The five bands, in the proportions the design draws them. The names sit
   *  in the panel's caption rather than under each track: at the 12px floor
   *  this site holds sitewide, `CAUTION` does not fit a 36px column. */
  const ACWR_BAND_LABELS = ['detrain', 'under', 'optimal', 'caution', 'danger'];
  const ACWR_BAND_FR = [22, 20, 34, 12, 12];
  const acwrActive = $derived.by((): number => {
    if (!usable(acwr)) return -1;
    return ACWR_BAND_LABELS.indexOf(acwr.value.zone === 'detraining' ? 'detrain' : acwr.value.zone === 'undertraining' ? 'under' : acwr.value.zone);
  });

  // ——— 2 · monotony ——————————————————————————————————————————————
  const monotonyPanel = $derived.by((): Panel => {
    const base = { id: 'monotony', name: 'Monotony · strain', window: '7d', unit: '' };
    if (!usable(monotony)) {
      return {
        ...base,
        readable: false,
        value: '—',
        verdict: 'no read',
        valueTone: 'plain',
        verdictTone: 'plain',
        body: NEEDS('seven days', 'daily load'),
      };
    }
    const { monotony: m, band, strain } = monotony.value;
    const tail =
      band === 'high'
        ? 'Seven near-identical days. Sameness, not volume, is what this measures, and it is the reading that most often precedes a stale block.'
        : band === 'moderate'
          ? 'The healthy middle — the week has genuine hard/easy shape rather than seven identical days. Nothing to fix; worth protecting when volume goes up.'
          : 'Low, which on a thin week usually means one session and six rest days rather than deliberate variation.';
    return {
      ...base,
      readable: true,
      value: fixed(m, 1),
      verdict: band,
      valueTone: 'plain',
      verdictTone: band === 'high' ? 'accent' : 'good',
      body: `Mean ÷ SD of daily load, strain ${Math.round(strain)}. ${tail}`,
    };
  });

  const monotonyBars = $derived(barHeights(loadDays.slice(-7).map((d) => d.load)));

  // ——— 3 · intensity mix ————————————————————————————————————————
  const polarisedPanel = $derived.by((): Panel => {
    const base = { id: 'polarised', name: 'Intensity mix · 28d', window: '28d', unit: '% easy' };
    if (!usable(polarised)) {
      return {
        ...base,
        readable: false,
        value: '—',
        unit: '',
        verdict: 'no read',
        valueTone: 'plain',
        verdictTone: 'plain',
        body: NEEDS('a month', 'heart-rate-carrying workouts'),
      };
    }
    const { easyPct, midPct, hardPct, verdict } = polarised.value;
    const tail =
      verdict === 'polarised'
        ? `Polarised: over ${POLARISED_EASY_PCT}% easy and over ${POLARISED_HARD_PCT}% genuinely hard, with the middle kept out of it.`
        : verdict === 'junk-middle'
          ? `The junk middle — ${Math.round(midPct)}% of the time in Z3, which is too hard to recover from and too easy to adapt to.`
          : verdict === 'pyramid'
            ? `Pyramid, not polarised — polarised needs ${POLARISED_EASY_PCT}% easy AND ${POLARISED_HARD_PCT}% hard. No junk middle, which is the real trap. One weekly hard effort would tip it.`
            : 'Not enough volume in the window to call a shape at all.';
    return {
      ...base,
      readable: true,
      value: whole(easyPct),
      verdict: '',
      valueTone: 'plain',
      verdictTone: 'plain',
      body: `Verdict: ${tail} Hard share is ${Math.round(hardPct)}%.`,
    };
  });

  // ——— 4 · sleep regularity ——————————————————————————————————————
  const sriPanel = $derived.by((): Panel => {
    const base = { id: 'sri', name: 'Sleep regularity · SRI', window: '30d', unit: '' };
    if (!usable(sleepRegularity)) {
      return {
        ...base,
        readable: false,
        value: '—',
        verdict: 'no read',
        valueTone: 'plain',
        verdictTone: 'plain',
        body: NEEDS('thirty nights', 'recorded sleep'),
      };
    }
    const sri = sleepRegularity.value;
    const short = Math.max(0, SRI_TARGET - sri);
    const regular = sri >= SRI_TARGET;
    return {
      ...base,
      readable: true,
      value: whole(sri),
      verdict: regular ? 'regular' : 'irregular',
      valueTone: regular ? 'good' : 'accent',
      verdictTone: regular ? 'good' : 'accent',
      body: `Phillips 2017 index: the chance any two nights agree minute-for-minute. ${
        regular
          ? `At or past the ${SRI_TARGET} target — bed and wake times are landing in the same window.`
          : `${short} points under the ${SRI_TARGET} target — this is the number the fixed-window habit moves.`
      }`,
      caption: `0 = random · ${SRI_TARGET} = target · 100 = identical nightly`,
    };
  });

  // ——— 5 · circadian drift ——————————————————————————————————————
  const CIRCADIAN_FLAG_HOURS = 1;
  const circadianPanel = $derived.by((): Panel => {
    const base = { id: 'circadian', name: 'Circadian drift', window: '21d', unit: 'h' };
    if (!usable(circadian)) {
      return {
        ...base,
        readable: false,
        value: '—',
        unit: '',
        verdict: 'no read',
        valueTone: 'plain',
        verdictTone: 'plain',
        body: NEEDS('a fortnight', 'sleep intervals'),
      };
    }
    const { driftHours, flag } = circadian.value;
    const aligned = flag === 'aligned';
    return {
      ...base,
      readable: true,
      value: signed(driftHours, 1),
      verdict: aligned ? 'aligned' : flag === 'drift-late' ? 'drift late' : 'drift early',
      valueTone: aligned ? 'good' : 'accent',
      verdictTone: aligned ? 'good' : 'accent',
      body: `Sleep midpoint has moved ${hoursAndMinutes(driftHours)} ${driftHours >= 0 ? 'later' : 'earlier'} over the last week versus the fortnight before. Anything past ${CIRCADIAN_FLAG_HOURS} hour is flagged. Phase, not duration — and the two go wrong together.`,
    };
  });

  /** Base and current midpoint as percentages across a ±3h rule. */
  const circadianMarks = $derived.by(() => {
    if (!usable(circadian)) return null;
    const { baselineMidpointMin, recentMidpointMin } = circadian.value;
    const span = 6 * 60; // three hours either side of the baseline
    const pos = (min: number) =>
      Math.max(6, Math.min(94, 50 + ((min - baselineMidpointMin) / span) * 100));
    return {
      base: { left: pos(baselineMidpointMin), label: clockFromMinutes(baselineMidpointMin) },
      now: { left: pos(recentMidpointMin), label: clockFromMinutes(recentMidpointMin) },
    };
  });

  // ——— 6 · autonomic balance ————————————————————————————————————
  const autonomicPanel = $derived.by((): Panel => {
    const base = { id: 'autonomic', name: 'Autonomic balance', window: '28d', unit: '' };
    if (!usable(autonomic)) {
      return {
        ...base,
        readable: false,
        value: '—',
        verdict: 'no read',
        valueTone: 'plain',
        verdictTone: 'plain',
        body: NEEDS('a fortnight', 'paired HRV and resting-HR mornings'),
      };
    }
    const { score } = autonomic.value;
    const word =
      score >= 70 ? 'fresh' : score >= 50 ? 'balanced' : score >= 30 ? 'slightly suppressed' : 'suppressed';
    return {
      ...base,
      readable: true,
      value: whole(score),
      verdict: word,
      valueTone: score >= 50 ? 'good' : 'plain',
      verdictTone: score >= 50 ? 'good' : 'plain',
      body: `HRV z minus RHR z, mapped to 0–100. ${
        score >= 50
          ? 'Above the midpoint: HRV is sitting at or over its own baseline while resting heart rate stays at or under its own.'
          : 'Under the midpoint: HRV below its own baseline while resting heart rate sits above. Mild, consistent, and consistent with short sleep.'
      }`,
    };
  });

  /** Both z-scores as a signed share of a ±2 rule, for the centred bars. */
  const zRows = $derived.by(() => {
    if (!usable(autonomic)) return [];
    const { hrvZ, rhrZ } = autonomic.value;
    const width = (z: number) => Math.min(50, (Math.abs(z) / 2) * 50);
    return [
      { label: 'HRV z', z: hrvZ, width: width(hrvZ), left: hrvZ >= 0, good: hrvZ >= 0 },
      { label: 'RHR z', z: rhrZ, width: width(rhrZ), left: rhrZ >= 0, good: rhrZ <= 0 },
    ];
  });

  // ——— 7 · recovery debt ————————————————————————————————————————
  const debtPanel = $derived.by((): Panel => {
    const base = { id: 'debt', name: 'Recovery debt', window: '14d', unit: 'min' };
    if (!usable(recoveryDebt)) {
      return {
        ...base,
        readable: false,
        value: '—',
        unit: '',
        verdict: 'no read',
        valueTone: 'plain',
        verdictTone: 'plain',
        body: NEEDS('a week', 'nights with a sleep-need figure'),
      };
    }
    const { sleepDebtMin, overdrawn } = recoveryDebt.value;
    const over = sleepDebtMin / SLEEP_DEBT_FLAG_MIN;
    return {
      ...base,
      readable: true,
      value: whole(sleepDebtMin),
      verdict: overdrawn ? 'overdrawn' : 'in credit',
      valueTone: overdrawn ? 'accent' : 'good',
      verdictTone: overdrawn ? 'accent' : 'good',
      body: `Sum of nightly shortfall against Whoop's own sleep need. ${
        overdrawn
          ? `Past the ${SLEEP_DEBT_FLAG_MIN}-minute flag by ${over.toFixed(1)} times.`
          : `Inside the ${SLEEP_DEBT_FLAG_MIN}-minute flag, so the fortnight has broken even.`
      }`,
      caption: `cumulative 14d · dashed = ${SLEEP_DEBT_FLAG_MIN}min flag`,
    };
  });

  /** The debt curve, and where the flag line falls on the same scale. */
  const debtChart = $derived.by(() => {
    if (!usable(recoveryDebt)) return null;
    const values = recoveryDebt.value.series.map((p) => p.debt);
    if (values.length < 2) return null;
    const e = extent([...values, 0, SLEEP_DEBT_FLAG_MIN]);
    return {
      points: sparkPoints(values, 100, 34, e),
      flagY: yOf(SLEEP_DEBT_FLAG_MIN, e, 34),
    };
  });

  // ——— 8 · efficiency ————————————————————————————————————————————
  const efficiencyPanel = $derived.by((): Panel => {
    const outings = efficiency?.daily.length ?? 0;
    const base = {
      id: 'efficiency',
      name: 'Efficiency · beats/km',
      window: outings ? `${outings} outing${outings === 1 ? '' : 's'}` : '28d',
      unit: '',
    };
    const latest = efficiency?.latest7 ?? null;
    const baseline = efficiency?.baseline28 ?? null;
    if (latest == null || baseline == null || baseline <= 0) {
      return {
        ...base,
        readable: false,
        value: '—',
        verdict: 'no read',
        valueTone: 'plain',
        verdictTone: 'plain',
        body: NEEDS('four weeks', 'pace-sport outings carrying heart rate'),
      };
    }
    const deltaPct = ((latest - baseline) / baseline) * 100;
    const better = deltaPct <= 0;
    return {
      ...base,
      readable: true,
      value: whole(latest),
      verdict: `vs ${Math.round(baseline)} baseline`,
      valueTone: 'plain',
      verdictTone: better ? 'good' : 'plain',
      body: `Heartbeats spent per kilometre — the cleanest read on whether fitness is moving. ${
        better ? 'Down' : 'Up'
      } ${Math.abs(deltaPct).toFixed(0)}% on baseline, on ${outings} outing${outings === 1 ? '' : 's'}. Needs volume before it means anything; watch, don't act.`,
      caption: 'lower is better · dashed = 28d baseline',
    };
  });

  const efficiencyChart = $derived.by(() => {
    const daily = efficiency?.daily ?? [];
    const baseline = efficiency?.baseline28 ?? null;
    if (daily.length < 2 || baseline == null) return null;
    const values = sample(daily.map((p) => p.value), 12);
    const e = extent([...values, baseline]);
    return { points: sparkPoints(values, 100, 30, e), baseY: yOf(baseline, e, 30) };
  });

  const panels = $derived([
    acwrPanel,
    monotonyPanel,
    polarisedPanel,
    sriPanel,
    circadianPanel,
    autonomicPanel,
    debtPanel,
    efficiencyPanel,
  ]);
</script>

<section class="b">
  <div class="b-inner">
    <div class="b-head">
      <SectionHead
        dark
        strapCh={44}
        kicker="B / The instrument deck"
        title={['Eight analytics', 'already running']}
        strap="Every panel below is a metric the site already computes and mostly doesn't show. Each states the window it needs, because a band read off nine days of data is a guess wearing a number."
      />
    </div>

    <div class="b-grid">
      {#each panels as p (p.id)}
        <div class="b-panel">
          <div class="b-panel-head">
            <p class="b-panel-name">{p.name}</p>
            <p class="b-panel-badge" class:needs={!p.readable}>
              {p.readable ? `Derived · ${p.window}` : `Needs ${p.window}`}
            </p>
          </div>

          <div class="b-figure">
            <p class="b-value tone-{p.valueTone}">
              {p.value}{#if p.unit}<span class="b-unit">{p.unit}</span>{/if}
            </p>
            {#if p.verdict}
              <p class="b-verdict tone-{p.verdictTone}">{p.verdict}</p>
            {/if}
          </div>

          <!-- Each instrument draws the one chart that suits it; nothing here
               is a generic plot with a different series in it. -->
          {#if p.id === 'acwr' && p.readable}
            <div class="b-bands">
              {#each ACWR_BAND_LABELS as label, i (label)}
                <div class="b-band" class:on={i === acwrActive} style="flex: {ACWR_BAND_FR[i]}"></div>
              {/each}
            </div>
          {:else if p.id === 'monotony' && p.readable}
            <div class="b-weekbars">
              {#each monotonyBars as h, i (i)}
                <div class="b-weekbar" class:last={i === monotonyBars.length - 1} style="height: {h}%"></div>
              {/each}
            </div>
          {:else if p.id === 'polarised' && usable(polarised)}
            <div class="b-stack">
              <div class="b-stack-easy" style="width: {polarised.value.easyPct}%"></div>
              <div class="b-stack-mid" style="width: {polarised.value.midPct}%"></div>
              <div class="b-stack-hard" style="width: {polarised.value.hardPct}%"></div>
            </div>
            <div class="b-stacklabels">
              <p style="width: {polarised.value.easyPct}%">Z1–Z2 easy</p>
              <p style="width: {polarised.value.midPct}%">Z3</p>
              <p class="accent" style="width: {polarised.value.hardPct}%">Z4–5</p>
            </div>
          {:else if p.id === 'sri' && usable(sleepRegularity)}
            <div class="b-meter">
              <div class="b-meter-fill" class:good={sleepRegularity.value >= SRI_TARGET} style="width: {Math.max(0, Math.min(100, sleepRegularity.value))}%"></div>
              <div class="b-meter-target" style="left: {SRI_TARGET}%"></div>
            </div>
          {:else if p.id === 'circadian' && circadianMarks}
            <div class="b-rule">
              <div class="b-rule-line"></div>
              <div class="b-rule-base" style="left: {circadianMarks.base.left}%"></div>
              <p class="b-rule-baselabel" style="left: {circadianMarks.base.left}%">Base {circadianMarks.base.label}</p>
              <div class="b-rule-dot" style="left: {circadianMarks.now.left}%"></div>
              <p class="b-rule-nowlabel" style="left: {circadianMarks.now.left}%">Now {circadianMarks.now.label}</p>
            </div>
          {:else if p.id === 'autonomic' && zRows.length}
            <div class="b-zrows">
              {#each zRows as z (z.label)}
                <div class="b-zrow">
                  <p class="b-zlabel">{z.label}</p>
                  <div class="b-ztrack">
                    <div class="b-zcentre"></div>
                    <div
                      class="b-zfill"
                      class:good={z.good}
                      style="width: {z.width}%; {z.left ? 'left: 50%' : 'right: 50%'}"
                    ></div>
                  </div>
                  <p class="b-zvalue" class:good={z.good}>{signed(z.z, 2)}</p>
                </div>
              {/each}
            </div>
          {:else if p.id === 'debt' && p.readable && debtChart}
            <svg viewBox="0 0 100 34" preserveAspectRatio="none" class="b-curve" aria-hidden="true">
              <polyline points={debtChart.points} fill="none" stroke="var(--accent-on-dark)" stroke-width="1.8" />
              <line x1="0" y1={debtChart.flagY} x2="100" y2={debtChart.flagY} stroke="rgba(237,228,212,0.4)" stroke-width="0.8" stroke-dasharray="3 3" />
            </svg>
          {:else if p.id === 'efficiency' && p.readable && efficiencyChart}
            <svg viewBox="0 0 100 30" preserveAspectRatio="none" class="b-curve" aria-hidden="true">
              <line x1="0" y1={efficiencyChart.baseY} x2="100" y2={efficiencyChart.baseY} stroke="rgba(237,228,212,0.4)" stroke-width="0.8" stroke-dasharray="3 3" />
              <polyline points={efficiencyChart.points} fill="none" stroke="var(--accent-on-dark)" stroke-width="1.8" />
            </svg>
          {/if}

          {#if p.caption}
            <p class="b-caption">{p.caption}</p>
          {/if}
          <p class="b-body">{p.body}</p>
        </div>
      {/each}
    </div>

    <p class="b-sources">
      Formula sources · ACWR: Williams 2017 EWMA, 7d/28d half-lives. Monotony/strain: Foster.
      Intensity: HR zones off hrMax, Tanaka-or-observed. SRI: Phillips 2017. Autonomic: z-scores
      vs trailing 28d. Recovery debt: nightly shortfall vs Whoop sleep need, {SLEEP_DEBT_FLAG_MIN}min
      flag. VO₂max: ACSM norms, fixed age-32 profile — the percentile is anchored, the slope is not.
      The window on each badge is the sample that metric requires before its band means anything.
    </p>
  </div>
</section>

<style>
  .b {
    background: var(--text-primary);
    color: var(--bg);
    padding: 0 clamp(20px, 3vw, 44px) clamp(40px, 5vw, 68px);
  }
  .b-inner {
    max-width: 1400px;
    margin: 0 auto;
  }
  .b-head {
    padding: clamp(28px, 3.5vw, 48px) 0 0;
    border-top: 1px solid rgba(237, 228, 212, 0.16);
  }

  .b-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 16px;
  }
  .b-panel {
    background: var(--text-primary);
    border: 1px solid rgba(237, 228, 212, 0.16);
    padding: 22px;
    min-width: 0;
  }

  .b-panel-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 14px;
  }
  .b-panel-name,
  .b-panel-badge {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    margin: 0;
  }
  .b-panel-name {
    font-weight: 500;
    letter-spacing: 0.15em;
  }
  .b-panel-badge {
    letter-spacing: 0.1em;
    color: rgba(237, 228, 212, 0.45);
    white-space: nowrap;
  }
  .b-panel-badge.needs {
    color: var(--accent-on-dark);
  }

  .b-figure {
    display: flex;
    align-items: baseline;
    gap: 14px;
    flex-wrap: wrap;
    margin-bottom: 16px;
  }
  .b-value {
    font-family: var(--font-display);
    font-size: 40px;
    line-height: 0.86;
    letter-spacing: -0.02em;
    margin: 0;
  }
  .b-unit {
    font-size: var(--fs-body);
    color: rgba(237, 228, 212, 0.45);
  }
  .b-verdict {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    margin: 0;
    max-width: 11ch;
  }
  .tone-accent {
    color: var(--accent-on-dark);
  }
  .tone-good {
    color: var(--good-on-dark);
  }
  .tone-plain {
    color: rgba(237, 228, 212, 0.7);
  }
  .b-value.tone-plain {
    color: var(--bg);
  }

  /* ——— ACWR band gauge ————————————————————————————————————————
     `flex` weights, not percentages: the 2px gaps then come out of the tracks
     instead of pushing the last band off the end of the row. */
  .b-bands {
    display: flex;
    gap: 2px;
    margin-bottom: 6px;
  }
  .b-band {
    height: 10px;
    background: rgba(237, 228, 212, 0.16);
  }
  .b-band.on {
    background: var(--accent-on-dark);
  }
  /* ——— monotony week bars ——————————————————————————————————— */
  .b-weekbars {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 3px;
    align-items: end;
    height: 44px;
    margin-bottom: 14px;
  }
  .b-weekbar {
    background: rgba(237, 228, 212, 0.3);
  }
  .b-weekbar.last {
    background: var(--good-on-dark);
  }

  /* ——— intensity stack ——————————————————————————————————————— */
  .b-stack {
    display: flex;
    height: 12px;
    margin-bottom: 6px;
  }
  .b-stack-easy {
    background: var(--good-on-dark);
  }
  .b-stack-mid {
    background: rgba(237, 228, 212, 0.3);
  }
  .b-stack-hard {
    background: var(--accent-on-dark);
  }
  .b-stacklabels {
    display: flex;
    margin-bottom: 14px;
  }
  .b-stacklabels p {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: rgba(237, 228, 212, 0.45);
    margin: 0;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
  }
  .b-stacklabels p.accent {
    color: var(--accent-on-dark);
  }

  /* ——— SRI meter ————————————————————————————————————————————— */
  .b-meter {
    position: relative;
    height: 10px;
    background: rgba(237, 228, 212, 0.16);
    margin-bottom: 6px;
  }
  .b-meter-fill {
    position: absolute;
    left: 0;
    top: 0;
    height: 10px;
    background: var(--accent-on-dark);
  }
  .b-meter-fill.good {
    background: var(--good-on-dark);
  }
  .b-meter-target {
    position: absolute;
    top: -3px;
    width: 2px;
    height: 16px;
    background: var(--bg);
  }

  /* ——— circadian rule ———————————————————————————————————————— */
  .b-rule {
    position: relative;
    height: 34px;
    margin-bottom: 14px;
  }
  .b-rule-line {
    position: absolute;
    left: 0;
    right: 0;
    top: 16px;
    height: 1px;
    background: rgba(237, 228, 212, 0.16);
  }
  .b-rule-base {
    position: absolute;
    top: 6px;
    width: 2px;
    height: 22px;
    background: rgba(237, 228, 212, 0.55);
  }
  .b-rule-dot {
    position: absolute;
    top: 10px;
    width: 10px;
    height: 10px;
    border-radius: 100px;
    background: var(--accent-on-dark);
    transform: translateX(-5px);
  }
  .b-rule-baselabel,
  .b-rule-nowlabel {
    position: absolute;
    transform: translateX(-50%);
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    white-space: nowrap;
    margin: 0;
  }
  .b-rule-baselabel {
    top: -4px;
    color: rgba(237, 228, 212, 0.45);
  }
  .b-rule-nowlabel {
    top: 24px;
    color: var(--accent-on-dark);
  }

  /* ——— autonomic z bars ——————————————————————————————————————— */
  .b-zrows {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-bottom: 14px;
  }
  .b-zrow {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .b-zlabel,
  .b-zvalue {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    margin: 0;
  }
  .b-zlabel {
    letter-spacing: 0.1em;
    width: 46px;
    flex-shrink: 0;
    color: rgba(237, 228, 212, 0.55);
  }
  .b-zvalue {
    width: 44px;
    flex-shrink: 0;
    text-align: right;
    color: var(--accent-on-dark);
  }
  .b-zvalue.good {
    color: var(--good-on-dark);
  }
  .b-ztrack {
    flex: 1;
    position: relative;
    height: 8px;
    background: rgba(237, 228, 212, 0.14);
  }
  .b-zcentre {
    position: absolute;
    left: 50%;
    top: 0;
    width: 1px;
    height: 8px;
    background: rgba(237, 228, 212, 0.4);
  }
  .b-zfill {
    position: absolute;
    top: 0;
    height: 8px;
    background: var(--accent-on-dark);
  }
  .b-zfill.good {
    background: var(--good-on-dark);
  }

  /* ——— curves ————————————————————————————————————————————————— */
  .b-curve {
    width: 100%;
    height: 34px;
    display: block;
    margin-bottom: 6px;
  }

  .b-caption {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: rgba(237, 228, 212, 0.45);
    margin: 0 0 14px;
  }
  .b-body {
    font-size: var(--fs-label);
    line-height: 1.5;
    color: rgba(237, 228, 212, 0.7);
    margin: 0;
    text-wrap: pretty;
  }

  .b-sources {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.7;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: rgba(237, 228, 212, 0.45);
    margin: 24px 0 0;
    max-width: 100ch;
  }
</style>
