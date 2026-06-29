<script lang="ts">
  import BandGauge from './BandGauge.svelte';
  import EvidenceChip from '$lib/components/health/EvidenceChip.svelte';

  type Sufficiency = 'ok' | 'partial' | 'insufficient';

  type SleepRegularity = {
    value: number; // SRI 0..100 float
    sufficiency: Sufficiency;
    asOf: string;
    sampleSize: number;
  };

  type Circadian = {
    value: {
      driftHours: number; // signed
      baselineMidpointMin: number;
      recentMidpointMin: number;
      flag: 'aligned' | 'drift-late' | 'drift-early';
    };
    sufficiency: Sufficiency;
    asOf: string;
    sampleSize: number;
  };

  let {
    sleepRegularity,
    circadian,
    onevidence,
  }: {
    sleepRegularity: SleepRegularity | null;
    circadian: Circadian | null;
    onevidence?: (id: string) => void;
  } = $props();

  // ---- Card 1: Sleep Regularity (SRI) -------------------------------------
  const showSri = $derived(
    !!sleepRegularity && sleepRegularity.sufficiency !== 'insufficient',
  );
  // SRI arrives as a float — round only for display.
  const sri = $derived(sleepRegularity ? sleepRegularity.value : 0);
  const sriRounded = $derived(Math.round(sri));

  const sriTag = $derived(
    sriRounded >= 87
      ? { label: 'LOCKED-IN', cls: 'good' }
      : sriRounded >= 70
        ? { label: 'DECENT', cls: 'warn' }
        : { label: 'ERRATIC', cls: 'bad' },
  );
  const sriValueCls = $derived(
    sriRounded >= 87 ? 'accent' : sriRounded >= 70 ? 'warn' : 'bad',
  );

  const sriZones = [
    { to: 70, label: 'ERRATIC', tone: 'bad' as const },
    { to: 87, label: 'DECENT', tone: 'warn' as const },
    { to: 100, label: 'REGULAR', tone: 'good' as const },
  ];
  // index of the live zone (first zone whose `to` the value falls under)
  const sriActive = $derived(sri < 70 ? 0 : sri < 87 ? 1 : 2);

  const sriAction = $derived(
    sriRounded >= 87
      ? 'Rock-steady schedule — your clock thanks you.'
      : sriRounded >= 70
        ? 'Tighten bed/wake times by 30 min.'
        : 'All over the place — pick a fixed wake time and hold it.',
  );

  // ---- Card 2: Body Clock · Drift -----------------------------------------
  const showDrift = $derived(
    !!circadian && circadian.sufficiency !== 'insufficient',
  );
  const drift = $derived(circadian ? circadian.value.driftHours : 0);
  const driftAbs = $derived(Math.abs(drift));
  const flag = $derived(circadian ? circadian.value.flag : 'aligned');

  const driftTag = $derived(
    flag === 'aligned'
      ? { label: 'ALIGNED', cls: 'good' }
      : flag === 'drift-late'
        ? { label: 'RUNNING LATE', cls: 'warn' }
        : { label: 'RUNNING EARLY', cls: 'warn' },
  );
  const driftValueCls = $derived(flag === 'aligned' ? 'accent' : 'warn');
  const driftDisplay = $derived(
    `${drift >= 0 ? '+' : ''}${drift.toFixed(1)}`,
  );

  // Sentence: describe magnitude + direction (later/earlier) vs 3-week norm,
  // then the concrete instruction keyed on whether it's actually adrift.
  const driftDir = $derived(
    flag === 'drift-early' ? 'earlier' : 'later',
  );
  const driftPhrase = $derived(
    `${driftAbs.toFixed(1)}h ${driftDir}`,
  );
  const driftInstruction = $derived(
    driftAbs > 1
      ? 'Nudge it back toward baseline — anchor your mornings.'
      : 'Bang on your baseline — keep it.',
  );
</script>

{#if showSri || showDrift}
  <div class="h-detail-grid">
    {#if showSri && sleepRegularity}
      <div class="h-card span-6">
        <div class="h-card-head">
          <div class="h-card-head-l">
            <p class="h-card-name">SLEEP REGULARITY · SRI</p>
            <EvidenceChip id="sri" onopen={onevidence} />
          </div>
          <span class="h-card-tag {sriTag.cls}">{sriTag.label}</span>
        </div>
        <p class="h-card-value {sriValueCls}">
          {sriRounded}<span class="h-card-unit"> /100</span>
        </p>
        <div class="h-gauge-wrap">
          <BandGauge
            value={sri}
            min={0}
            max={100}
            zones={sriZones}
            active={sriActive}
            formatValue={(v) => Math.round(v) + ''}
          />
        </div>
        <p class="h-card-foot action">{sriAction}</p>
      </div>
    {/if}

    {#if showDrift && circadian}
      <div class="h-card span-6 tinted">
        <div class="h-card-head">
          <div class="h-card-head-l">
            <p class="h-card-name">BODY CLOCK · DRIFT</p>
            <EvidenceChip id="circadian-alignment" onopen={onevidence} />
          </div>
          <span class="h-card-tag {driftTag.cls}">{driftTag.label}</span>
        </div>
        <p class="h-card-value {driftValueCls}">
          {driftDisplay}<span class="h-card-unit"> h</span>
        </p>
        <p class="h-card-foot action">
          Your sleep midpoint's drifted <em>{driftPhrase}</em> than your 3-week
          norm. {driftInstruction}
        </p>
      </div>
    {/if}
  </div>
{/if}

<style>
  /* Gauge needs headroom above the track for its marker value label. */
  .h-gauge-wrap {
    margin-top: 14px;
  }
</style>
