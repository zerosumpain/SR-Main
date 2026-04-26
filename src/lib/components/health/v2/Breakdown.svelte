<script lang="ts">
  import type { HealthDay, Workout, ActivityRings } from '$lib/health/series-30d-service';
  import Sparkline from './Sparkline.svelte';

  let {
    series,
    today,
    yesterday,
    workouts,
    rhrBaseline = 58,
    rings,
  }: {
    series: HealthDay[];
    today: HealthDay;
    yesterday: HealthDay;
    workouts: Workout[];
    rhrBaseline?: number;
    rings: ActivityRings;
  } = $props();

  const recovery = $derived(series.map((d) => d.rec));
  const hrvSeries = $derived(series.map((d) => d.hrv));
  const strainSeries = $derived(series.map((d) => d.strain));
  const rhrSeries = $derived(series.map((d) => d.rhr));

  const recAvg7 = $derived(
    Math.round(series.slice(-7).reduce((a, b) => a + b.rec, 0) / 7),
  );
  const hrvAvg7 = $derived(
    Math.round(series.slice(-7).reduce((a, b) => a + b.hrv, 0) / 7),
  );

  const recoveryTag = $derived(
    today.rec < 40 ? 'RED' : today.rec < 67 ? 'AMBER' : 'GREEN',
  );
  const recoveryTagClass = $derived(
    today.rec < 67 ? 'bad' : 'good',
  );
  const hrvTag = $derived(today.hrv < hrvAvg7 ? `↓ ${Math.round(((hrvAvg7 - today.hrv) / hrvAvg7) * 100)}%` : `↑ ${Math.round(((today.hrv - hrvAvg7) / hrvAvg7) * 100)}%`);
  const strainTag = $derived(yesterday.strain >= 14 ? 'HIGH' : yesterday.strain >= 10 ? 'MODERATE' : 'LIGHT');
  const strainTagClass = $derived(yesterday.strain >= 14 ? 'good' : 'flat');

  // Sleep card
  const sleepStages = $derived(
    today.sleepStages ?? { deep: 0, rem: 0, light: 0, awake: 0 },
  );
  const sleepTotal = $derived(
    sleepStages.deep + sleepStages.rem + sleepStages.light + sleepStages.awake,
  );
  // 20-block representation, proportional
  const sleepBlocks = $derived(
    sleepTotal > 0
      ? buildSleepBlocks(sleepStages)
      : Array(20).fill('light'),
  );

  function buildSleepBlocks(stages: { deep: number; rem: number; light: number; awake: number }): string[] {
    const total = stages.deep + stages.rem + stages.light + stages.awake;
    const target = 20;
    const counts = {
      deep: Math.round((stages.deep / total) * target),
      rem: Math.round((stages.rem / total) * target),
      awake: Math.round((stages.awake / total) * target),
      light: 0,
    };
    counts.light = target - counts.deep - counts.rem - counts.awake;
    if (counts.light < 0) {
      counts.light = 0;
      const overflow = counts.deep + counts.rem + counts.awake - target;
      counts.light = Math.max(0, target - counts.deep - counts.rem - counts.awake);
      void overflow;
    }
    const out: string[] = [];
    for (let i = 0; i < counts.light; i++) out.push('light');
    for (let i = 0; i < counts.deep; i++) out.push('deep');
    for (let i = 0; i < counts.rem; i++) out.push('rem');
    for (let i = 0; i < counts.awake; i++) out.push('awake');
    return out.slice(0, target);
  }

  function fmtMins(mins: number): string {
    const h = Math.floor(mins / 60);
    const m = mins - h * 60;
    return `${h}:${m.toString().padStart(2, '0')}`;
  }

  // Activity rings — driven by Apple Health (Move kcal / Exercise min / Stand hours)
  const stepsToday = $derived(today.steps);
  const stepsTotal30d = $derived(Math.round(series.reduce((a, b) => a + b.steps, 0) / 1000));
  const movePct = $derived(Math.min(1, rings.moveKcal / Math.max(1, rings.moveTarget)));
  const exercisePct = $derived(Math.min(1, rings.exerciseMin / Math.max(1, rings.exerciseTarget)));
  const standPct = $derived(Math.min(1, rings.standHours / Math.max(1, rings.standTarget)));

  function fmtPct(n: number): string {
    return `${Math.round(n * 100)}%`;
  }
</script>

<div class="h-detail-grid">
  <!-- Recovery -->
  <div class="h-card span-3">
    <div class="h-card-head">
      <p class="h-card-name">RECOVERY · TODAY</p>
      <span class="h-card-tag {recoveryTagClass}">{recoveryTag}</span>
    </div>
    <p class="h-card-value accent">{today.rec}<span class="h-card-unit">%</span></p>
    <Sparkline data={recovery} fill />
    <p class="h-card-foot">7d avg <em>{recAvg7}%</em>. Threshold for green: 67%.</p>
  </div>

  <!-- HRV -->
  <div class="h-card span-4">
    <div class="h-card-head">
      <p class="h-card-name">HRV · 30D</p>
      <span class="h-card-tag" class:bad={today.hrv < hrvAvg7} class:good={today.hrv >= hrvAvg7}
        >{hrvTag}</span
      >
    </div>
    <p class="h-card-value accent">{today.hrv}<span class="h-card-unit"> ms</span></p>
    <Sparkline data={hrvSeries} fill />
    <p class="h-card-foot">
      Baseline <em>{hrvAvg7}ms</em>. Today's reading vs window average.
    </p>
  </div>

  <!-- Strain -->
  <div class="h-card span-3">
    <div class="h-card-head">
      <p class="h-card-name">STRAIN · YESTERDAY</p>
      <span class="h-card-tag {strainTagClass}">{strainTag}</span>
    </div>
    <p class="h-card-value">
      {yesterday.strain.toFixed(1)}<span class="h-card-unit"> / 21</span>
    </p>
    <Sparkline data={strainSeries} accent={false} />
    <p class="h-card-foot">
      Whoop strain. Yesterday vs the 30-day shape.
    </p>
  </div>

  <!-- Sleep -->
  <div class="h-card span-6 tinted">
    <div class="h-card-head">
      <p class="h-card-name">SLEEP · LAST NIGHT</p>
      <span class="h-card-tag" class:bad={(today.sleepScore ?? 0) < 70} class:good={(today.sleepScore ?? 0) >= 70}>
        SCORE {today.sleepScore ?? '–'}
      </span>
    </div>
    <p class="h-card-value">
      {today.slept.toFixed(1)}<span class="h-card-unit"
        >{today.sleepStart && today.sleepEnd
          ? ` h · ${today.sleepStart} → ${today.sleepEnd}`
          : ' h'}</span
      >
    </p>
    <div class="h-sleep-bar">
      {#each sleepBlocks as s, i (i)}
        <div class="h-sleep-block {s}"></div>
      {/each}
    </div>
    <div class="h-sleep-legend">
      <span class="h-sleep-legend-item">
        <span class="h-sleep-legend-sw" style="background:#5a2f0a"></span>Deep {fmtMins(
          sleepStages.deep,
        )}
      </span>
      <span class="h-sleep-legend-item">
        <span class="h-sleep-legend-sw" style="background:var(--accent)"></span>REM {fmtMins(
          sleepStages.rem,
        )}
      </span>
      <span class="h-sleep-legend-item">
        <span class="h-sleep-legend-sw" style="background:rgba(196,87,10,0.5)"></span>Light {fmtMins(
          sleepStages.light,
        )}
      </span>
      <span class="h-sleep-legend-item">
        <span class="h-sleep-legend-sw" style="background:rgba(26,16,8,0.18)"></span>Awake {fmtMins(
          sleepStages.awake,
        )}
      </span>
    </div>
    <p class="h-card-foot">
      {sleepStages.awake > 30
        ? `<em>${fmtMins(sleepStages.awake)}</em> spent awake. `
        : ''}Deep was <em>{fmtMins(sleepStages.deep)}</em>. {today.slept < 7
        ? 'Below the 7-hour line.'
        : 'Within the recommended range.'}
    </p>
  </div>

  <!-- Activity rings -->
  <div class="h-card span-6">
    <div class="h-card-head">
      <p class="h-card-name">ACTIVITY · TODAY</p>
      <span class="h-card-tag flat"
        >{workouts.length === 0 ? 'REST DAY' : `${workouts.length} SESSIONS`}</span
      >
    </div>
    <div class="h-activity-row">
      <svg class="h-rings-svg" viewBox="0 0 100 100" aria-hidden="true">
        <circle class="h-ring-track" cx="50" cy="50" r="42" />
        <circle
          class="h-ring-fill move"
          cx="50"
          cy="50"
          r="42"
          stroke-dasharray="{movePct * 264} 264"
          pathLength="264"
        />
        <circle class="h-ring-track" cx="50" cy="50" r="32" />
        <circle
          class="h-ring-fill exercise"
          cx="50"
          cy="50"
          r="32"
          stroke-dasharray="{exercisePct * 201} 201"
          pathLength="201"
        />
        <circle class="h-ring-track" cx="50" cy="50" r="22" />
        <circle
          class="h-ring-fill stand"
          cx="50"
          cy="50"
          r="22"
          stroke-dasharray="{standPct * 138} 138"
          pathLength="138"
        />
      </svg>
      <div class="h-activity-meta">
        <div class="h-activity-grid">
          <div>
            <p class="h-card-name h-activity-mini">STEPS</p>
            <p class="h-card-value h-activity-mini-val">
              {(stepsToday / 1000).toFixed(1)}<span class="h-card-unit">k</span>
            </p>
          </div>
          <div>
            <p class="h-card-name h-activity-mini">30D · TOTAL</p>
            <p class="h-card-value h-activity-mini-val">
              {stepsTotal30d}<span class="h-card-unit">k</span>
            </p>
          </div>
        </div>
        <p class="h-card-foot h-activity-foot">
          Move <em>{rings.moveKcal} kcal</em> · Exercise <em>{rings.exerciseMin} min</em> · Stand
          <em>{rings.standHours}/{rings.standTarget}h</em>.
        </p>
      </div>
    </div>
  </div>

  <!-- Workouts -->
  <div class="h-card span-6">
    <div class="h-card-head">
      <p class="h-card-name">WORKOUTS · LAST 7</p>
      <span class="h-card-tag flat">{workouts.length} SESSIONS</span>
    </div>
    {#if workouts.length}
      <div class="h-workout-list">
        {#each workouts as w, i (i)}
          <div class="h-workout-row">
            <span class="h-workout-day">{w.day}</span>
            <span class="h-workout-name">{w.name}</span>
            <span class="h-workout-strain">{w.strain.toFixed(1)}</span>
            <span class="h-workout-dur">{w.dur}</span>
          </div>
        {/each}
      </div>
      <p class="h-card-foot h-workouts-foot">
        Avg strain <em
          >{(workouts.reduce((a, b) => a + b.strain, 0) / workouts.length).toFixed(1)}</em
        >.
      </p>
    {:else}
      <p class="h-card-foot">No sessions recorded in the last 7 days.</p>
    {/if}
  </div>

  <!-- Resting HR -->
  <div class="h-card span-6 tinted h-rhr-card">
    <div class="h-card-head">
      <p class="h-card-name">RESTING HR · 30D</p>
      <span
        class="h-card-tag"
        class:bad={today.rhr - rhrBaseline > 0}
        class:good={today.rhr - rhrBaseline < 0}
        class:flat={today.rhr - rhrBaseline === 0}
      >
        {today.rhr - rhrBaseline === 0
          ? '— bpm'
          : `${today.rhr - rhrBaseline > 0 ? '↑' : '↓'} ${Math.abs(today.rhr - rhrBaseline)} bpm`}
      </span>
    </div>
    <p class="h-card-value">{today.rhr}<span class="h-card-unit"> bpm</span></p>
    <Sparkline data={rhrSeries} accent={false} />
    <p class="h-card-foot">
      Baseline <em>{rhrBaseline} bpm</em>. {today.rhr > rhrBaseline + 3
        ? "Today's elevated reading is consistent with the HRV drop — same physiological story, two metrics."
        : "Today's reading sits near baseline."}
    </p>
  </div>
</div>

<style>
  .h-detail-grid {
    display: grid;
    grid-template-columns: repeat(12, 1fr);
    gap: 0;
    border: 2px solid var(--card-border);
  }
  @media (max-width: 1100px) {
    .h-detail-grid {
      grid-template-columns: repeat(6, 1fr);
    }
  }
  @media (max-width: 700px) {
    .h-detail-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }
  .h-card {
    position: relative;
    padding: 18px 18px 16px;
    border-right: 1px solid var(--divider);
    border-bottom: 1px solid var(--divider);
    background: var(--bg);
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-height: 220px;
  }
  .h-card.span-6 {
    grid-column: span 6;
  }
  .h-card.span-4 {
    grid-column: span 4;
  }
  .h-card.span-3 {
    grid-column: span 3;
  }
  @media (max-width: 1100px) {
    .h-card.span-6,
    .h-card.span-4 {
      grid-column: span 6;
    }
    .h-card.span-3 {
      grid-column: span 3;
    }
  }
  @media (max-width: 700px) {
    .h-card.span-6,
    .h-card.span-4,
    .h-card.span-3 {
      grid-column: span 2;
    }
  }
  .h-card.tinted {
    background: rgba(26, 16, 8, 0.04);
  }
  .h-card-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
  }
  .h-card-name {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0;
  }
  .h-card-tag {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    padding: 2px 6px;
    border: 1px solid var(--card-border);
    color: var(--text-muted);
    white-space: nowrap;
  }
  .h-card-tag.good {
    color: var(--accent);
    border-color: rgba(196, 87, 10, 0.4);
  }
  .h-card-tag.bad {
    color: #8a3a08;
    border-color: rgba(138, 58, 8, 0.4);
  }
  .h-card-tag.flat {
    color: var(--text-muted);
  }
  .h-card-value {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 56px;
    letter-spacing: -0.02em;
    line-height: 0.9;
    margin: 0;
    color: var(--text-primary);
  }
  .h-card-value.accent {
    color: var(--accent);
  }
  .h-card-unit {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.15em;
    color: var(--text-muted);
    text-transform: uppercase;
  }
  .h-card-foot {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.05em;
    color: var(--text-secondary);
    line-height: 1.5;
    margin: 0;
    margin-top: auto;
  }
  .h-card-foot :global(em) {
    color: var(--accent);
    font-style: normal;
  }

  .h-sleep-bar {
    display: grid;
    grid-template-columns: repeat(20, 1fr);
    gap: 1px;
    height: 36px;
  }
  .h-sleep-block {
    height: 100%;
  }
  .h-sleep-block.deep {
    background: #5a2f0a;
  }
  .h-sleep-block.rem {
    background: var(--accent);
  }
  .h-sleep-block.light {
    background: rgba(196, 87, 10, 0.5);
  }
  .h-sleep-block.awake {
    background: rgba(26, 16, 8, 0.18);
  }
  .h-sleep-legend {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }
  .h-sleep-legend-item {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .h-sleep-legend-sw {
    width: 8px;
    height: 8px;
  }

  .h-workout-list {
    display: flex;
    flex-direction: column;
    gap: 0;
    margin-top: 8px;
  }
  .h-workout-row {
    display: grid;
    grid-template-columns: 60px 1fr auto auto;
    gap: 14px;
    align-items: baseline;
    padding: 8px 0;
    border-top: 1px solid var(--divider);
  }
  .h-workout-row:first-child {
    border-top: none;
  }
  .h-workout-day {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.1em;
    color: var(--text-muted);
    text-transform: uppercase;
  }
  .h-workout-name {
    font-family: var(--font-body);
    font-size: 14px;
    color: var(--text-primary);
    font-weight: 500;
  }
  .h-workout-strain {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 18px;
    letter-spacing: -0.02em;
    color: var(--accent);
  }
  .h-workout-dur {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-muted);
    letter-spacing: 0.1em;
  }
  .h-workouts-foot {
    margin-top: 4px;
  }

  .h-activity-row {
    display: flex;
    align-items: center;
    gap: 24px;
    flex-wrap: wrap;
  }
  .h-activity-meta {
    flex: 1;
    min-width: 180px;
  }
  .h-activity-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .h-activity-mini {
    font-size: 9px;
  }
  .h-activity-mini-val {
    font-size: 28px;
  }
  .h-activity-foot {
    margin-top: 10px;
  }

  .h-rings-svg {
    width: 110px;
    height: 110px;
    display: block;
  }
  .h-ring-track {
    fill: none;
    stroke: rgba(26, 16, 8, 0.1);
    stroke-width: 8;
  }
  .h-ring-fill {
    fill: none;
    stroke-width: 8;
    stroke-linecap: round;
    transform: rotate(-90deg);
    transform-origin: center;
  }
  .h-ring-fill.move {
    stroke: var(--accent);
  }
  .h-ring-fill.exercise {
    stroke: #8a3a08;
  }
  .h-ring-fill.stand {
    stroke: #5a2f0a;
  }

  .h-rhr-card {
    justify-content: space-between;
  }
</style>
