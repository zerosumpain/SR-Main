<script lang="ts">
  import BandGauge from './BandGauge.svelte';
  import Sparkline from './Sparkline.svelte';
  import EvidenceChip from '$lib/components/health/EvidenceChip.svelte';

  type Sufficiency = 'ok' | 'partial' | 'insufficient';

  type RecoveryDebt = {
    value: {
      sleepDebtMin: number;
      strainRecoveryBalance: number;
      overdrawn: boolean;
      series: { date: string; debt: number }[];
    };
    sufficiency: Sufficiency;
    asOf: string;
    sampleSize: number;
  };

  type Autonomic = {
    value: {
      score: number;
      hrvZ: number;
      rhrZ: number;
      hrv7dMean: number;
      rhr7dMean: number;
      hrvBaselineMean: number;
      rhrBaselineMean: number;
    };
    sufficiency: Sufficiency;
    asOf: string;
    sampleSize: number;
  };

  let {
    recoveryDebt,
    autonomic,
    onevidence,
  }: {
    recoveryDebt: RecoveryDebt | null;
    autonomic: Autonomic | null;
    onevidence?: (id: string) => void;
  } = $props();

  // ---- Card 1: Recovery Debt ----------------------------------------------
  const showDebt = $derived(
    !!recoveryDebt && recoveryDebt.sufficiency !== 'insufficient',
  );
  const debtHours = $derived(
    recoveryDebt ? recoveryDebt.value.sleepDebtMin / 60 : 0,
  );
  const debtSeries = $derived(
    recoveryDebt ? recoveryDebt.value.series.map((s) => s.debt) : [],
  );
  const strainOutrunning = $derived(
    !!recoveryDebt && recoveryDebt.value.strainRecoveryBalance > 0,
  );

  // ---- Card 2: Autonomic Balance ------------------------------------------
  const showAutonomic = $derived(
    !!autonomic && autonomic.sufficiency !== 'insufficient',
  );
  const score = $derived(autonomic ? autonomic.value.score : 0);

  const autoTag = $derived(
    score >= 70
      ? { label: 'FRESH', cls: 'good' }
      : score >= 50
        ? { label: 'BALANCED', cls: 'good' }
        : score >= 30
          ? { label: 'LEANING TIRED', cls: 'warn' }
          : { label: 'STRAINED', cls: 'bad' },
  );
  const autoValueCls = $derived(
    score >= 50 ? 'accent' : score >= 30 ? 'warn' : 'bad',
  );

  const autoZones = [
    { to: 30, label: 'STRAINED', tone: 'bad' as const },
    { to: 50, label: 'LOW', tone: 'warn' as const },
    { to: 70, label: 'BALANCED', tone: 'good' as const },
    { to: 100, label: 'FRESH', tone: 'good' as const },
  ];
  // index of the live zone (first zone whose `to` the score falls under)
  const autoActive = $derived(
    score <= 30 ? 0 : score <= 50 ? 1 : score <= 70 ? 2 : 3,
  );

  // HRV vs baseline phrasing (7d mean vs baseline mean) — descriptive, not clinical.
  const hrvDelta = $derived(
    autonomic
      ? autonomic.value.hrv7dMean - autonomic.value.hrvBaselineMean
      : 0,
  );
  const hrvPhrase = $derived(
    autonomic
      ? hrvDelta >= 1.5
        ? `HRV's running above your baseline (${Math.round(autonomic.value.hrv7dMean)} vs ${Math.round(autonomic.value.hrvBaselineMean)}ms)`
        : hrvDelta <= -1.5
          ? `HRV's sitting below your baseline (${Math.round(autonomic.value.hrv7dMean)} vs ${Math.round(autonomic.value.hrvBaselineMean)}ms)`
          : `HRV's tracking your baseline (${Math.round(autonomic.value.hrv7dMean)} vs ${Math.round(autonomic.value.hrvBaselineMean)}ms)`
      : '',
  );
</script>

{#if showDebt || showAutonomic}
  <div class="h-detail-grid">
    {#if showDebt && recoveryDebt}
      <div class="h-card span-6">
        <div class="h-card-head">
          <div class="h-card-head-l">
            <p class="h-card-name">RECOVERY DEBT · 14D</p>
            <EvidenceChip id="recovery-debt" onopen={onevidence} />
          </div>
          {#if recoveryDebt.value.overdrawn}
            <span class="h-card-tag bad">OVERDRAWN</span>
          {:else}
            <span class="h-card-tag good">IN BALANCE</span>
          {/if}
        </div>
        <p class="h-card-value" class:bad={recoveryDebt.value.overdrawn}>
          {debtHours.toFixed(1)}<span class="h-card-unit"> h owed</span>
        </p>
        {#if debtSeries.length}
          <Sparkline data={debtSeries} fill />
        {/if}
        <p class="h-spark-cap">CUMULATIVE SLEEP DEBT</p>
        {#if recoveryDebt.value.overdrawn}
          <p class="h-card-foot action">
            You're <em>{debtHours.toFixed(1)}h</em> down{strainOutrunning
              ? " and strain's been outrunning recovery"
              : ''} — bank an early night this week.
          </p>
        {:else}
          <p class="h-card-foot action">
            Sleep debt's under control{strainOutrunning
              ? ", though strain's been outrunning recovery"
              : ''} — hold the line.
          </p>
        {/if}
      </div>
    {/if}

    {#if showAutonomic && autonomic}
      <div class="h-card span-6 tinted">
        <div class="h-card-head">
          <div class="h-card-head-l">
            <p class="h-card-name">AUTONOMIC BALANCE</p>
            <EvidenceChip id="autonomic-balance" onopen={onevidence} />
          </div>
          <span class="h-card-tag {autoTag.cls}">{autoTag.label}</span>
        </div>
        <p class="h-card-value {autoValueCls}">
          {Math.round(score)}<span class="h-card-unit"> /100</span>
        </p>
        <div class="h-gauge-wrap">
          <BandGauge
            value={score}
            min={0}
            max={100}
            zones={autoZones}
            active={autoActive}
            formatValue={(v) => Math.round(v) + ''}
          />
        </div>
        <p class="h-card-foot action">
          {hrvPhrase}. {score < 30
            ? 'Sustained low — check sleep, alcohol, illness before training hard.'
            : "Nervous system's coping — train as planned."}
        </p>
      </div>
    {/if}
  </div>
{/if}

<style>
  /* Caption under the recovery-debt spark — mono micro-label, in-palette. */
  .h-spark-cap {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--text-ghost);
    margin: -4px 0 0;
  }
  /* Gauge needs headroom above the track for its marker value label. */
  .h-gauge-wrap {
    margin-top: 14px;
  }
</style>
