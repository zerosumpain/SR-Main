<script lang="ts">
  // Training-load section: ACWR (acute:chronic workload ratio) with a banded
  // gauge + 28-day load mini-chart, a 7-day monotony read, and the 7-day
  // intensity-mix (polarisation) split. Each card fails soft — if its source is
  // null or insufficient it is simply omitted, never rendered as a zero stub.
  // Shared .h-detail-grid / .h-card / .h-card-* classes come from the globally
  // imported cards.css; only bespoke viz classes live in this file's style block.
  import BandGauge from './BandGauge.svelte';
  import EvidenceChip from '$lib/components/health/EvidenceChip.svelte';

  type Sufficiency = 'ok' | 'partial' | 'insufficient';

  type TrainingLoad = {
    acute: number;
    chronic: number;
    ratio: number;
    zone: 'detraining' | 'undertraining' | 'optimal' | 'caution' | 'danger';
    history: { date: string; load: number }[];
  };

  type Monotony = {
    value: { monotony: number; strain: number; mean: number; sd: number; band: 'low' | 'moderate' | 'high' };
    sufficiency: Sufficiency;
    asOf: string;
    sampleSize: number;
  };

  type Polarised = {
    value: {
      easyPct: number;
      midPct: number;
      hardPct: number;
      verdict: 'polarised' | 'pyramid' | 'junk-middle' | 'insufficient-volume';
      totalMinutes: number;
    };
    sufficiency: Sufficiency;
    asOf: string;
    sampleSize: number;
  };

  let {
    trainingLoad,
    monotony,
    polarised,
    onevidence,
  }: {
    trainingLoad: TrainingLoad | null;
    monotony: Monotony | null;
    polarised: Polarised | null;
    onevidence?: (id: string) => void;
  } = $props();

  // --- Gating -------------------------------------------------------------
  const showAcwr = $derived(
    !!trainingLoad && !(trainingLoad.acute === 0 && trainingLoad.chronic === 0),
  );
  const showMonotony = $derived(
    !!monotony &&
      monotony.sufficiency !== 'insufficient' &&
      monotony.value.mean > 0 &&
      monotony.value.sd > 0,
  );
  const showPolarised = $derived(
    !!polarised && polarised.sufficiency !== 'insufficient',
  );

  // --- ACWR ---------------------------------------------------------------
  // Zone → tag tone. optimal = good, caution|undertraining = warn (amber),
  // danger|detraining = bad (brown). The gauge `active` index follows the
  // ordered zones below (detraining 0 … danger 4).
  const ACWR_ZONES = [
    { to: 0.5, label: 'DETRAIN', tone: 'bad' as const },
    { to: 0.8, label: 'BUILD', tone: 'warn' as const },
    { to: 1.3, label: 'OPTIMAL', tone: 'good' as const },
    { to: 1.5, label: 'CAUTION', tone: 'warn' as const },
    { to: 2, label: 'DANGER', tone: 'bad' as const },
  ];

  const ZONE_ACTIVE: Record<TrainingLoad['zone'], number> = {
    detraining: 0,
    undertraining: 1,
    optimal: 2,
    caution: 3,
    danger: 4,
  };

  function acwrTagTone(zone: TrainingLoad['zone']): 'good' | 'warn' | 'bad' {
    if (zone === 'optimal') return 'good';
    if (zone === 'caution' || zone === 'undertraining') return 'warn';
    return 'bad'; // danger | detraining
  }

  function acwrValueTone(zone: TrainingLoad['zone']): '' | 'accent' | 'warn' | 'bad' {
    const t = acwrTagTone(zone);
    return t === 'good' ? 'accent' : t === 'warn' ? 'warn' : 'bad';
  }

  function acwrAction(zone: TrainingLoad['zone']): string {
    if (zone === 'optimal') return "Load's in the sweet spot — keep the rhythm.";
    if (zone === 'caution' || zone === 'danger')
      return 'Acute load is outrunning your base — pull back a day or two.';
    return 'Base is fading — add easy volume to rebuild.';
  }

  const acwrTone = $derived(showAcwr ? acwrTagTone(trainingLoad!.zone) : 'good');
  const acwrValTone = $derived(showAcwr ? acwrValueTone(trainingLoad!.zone) : '');
  const acwrActive = $derived(showAcwr ? ZONE_ACTIVE[trainingLoad!.zone] : -1);

  // 28-day load mini-chart: last 28 days, height ∝ load / max. The most recent 7
  // (acute window) are accent; the prior 21 (chronic tail) are muted brown.
  const loadBars = $derived.by(() => {
    if (!showAcwr) return [] as { h: number; recent: boolean }[];
    const hist = trainingLoad!.history.slice(-28);
    const maxLoad = Math.max(1, ...hist.map((d) => d.load));
    const n = hist.length;
    return hist.map((d, i) => ({
      h: Math.max(2, Math.round((d.load / maxLoad) * 100)),
      recent: i >= n - 7,
    }));
  });

  // --- Monotony -----------------------------------------------------------
  function monotonyTag(band: Monotony['value']['band']): { label: string; tone: 'good' | 'warn' | 'bad' } {
    if (band === 'low') return { label: 'VARIED', tone: 'good' };
    if (band === 'moderate') return { label: 'MODERATE', tone: 'warn' };
    return { label: 'MONOTONOUS', tone: 'bad' };
  }

  function monotonyAction(band: Monotony['value']['band']): string {
    if (band === 'low') return 'Good variation — recovery and load are well spaced.';
    if (band === 'moderate') return 'Mix in a genuinely easy day.';
    return 'Too samey — vary intensity to cut overtraining risk.';
  }

  const monoTag = $derived(showMonotony ? monotonyTag(monotony!.value.band) : null);
  const monoValTone = $derived.by(() => {
    if (!showMonotony) return '';
    const b = monotony!.value.band;
    return b === 'high' ? 'bad' : b === 'moderate' ? 'warn' : '';
  });

  // --- Polarised ----------------------------------------------------------
  function polarisedAction(verdict: Polarised['value']['verdict']): string {
    if (verdict === 'polarised') return 'Textbook 80/20 — protect the easy days.';
    if (verdict === 'junk-middle')
      return 'Too much medium — push the hard days harder, the easy days easier.';
    if (verdict === 'pyramid') return 'Solid base — add a touch more high-intensity.';
    return '';
  }

  // Clamp segment widths so a stacked bar always reads cleanly even with rounding.
  const polSegs = $derived.by(() => {
    if (!showPolarised) return [] as { key: string; pct: number; cls: string; label: string }[];
    const v = polarised!.value;
    return [
      { key: 'easy', pct: v.easyPct, cls: 'easy', label: 'EASY' },
      { key: 'mid', pct: v.midPct, cls: 'mid', label: 'MID' },
      { key: 'hard', pct: v.hardPct, cls: 'hard', label: 'HARD' },
    ];
  });

  const polVerdictLabel = $derived(
    showPolarised ? polarised!.value.verdict.replace(/-/g, ' ').toUpperCase() : '',
  );
</script>

<div class="h-detail-grid">
  {#if showAcwr}
    <!-- ACWR -->
    <div class="h-card span-8">
      <div class="h-card-head">
        <div class="h-card-head-l">
          <p class="h-card-name">TRAINING LOAD · ACWR</p>
          <EvidenceChip id="acwr" onopen={onevidence} />
        </div>
        <span class="h-card-tag {acwrTone}">{trainingLoad!.zone.toUpperCase()}</span>
      </div>

      <p class="h-card-value {acwrValTone}">{trainingLoad!.ratio.toFixed(2)}</p>

      <div class="tl-gauge">
        <BandGauge
          value={trainingLoad!.ratio}
          min={0}
          max={2}
          zones={ACWR_ZONES}
          active={acwrActive}
          formatValue={(v) => v.toFixed(2)}
        />
      </div>

      <div class="tl-bars-wrap">
        <p class="tl-bars-cap">28-DAY LOAD</p>
        <div class="tl-bars">
          {#each loadBars as b, i (i)}
            <span
              class="tl-bar"
              class:recent={b.recent}
              style="height: {b.h}%"
            ></span>
          {/each}
        </div>
      </div>

      <p class="h-card-foot action">{acwrAction(trainingLoad!.zone)}</p>
    </div>
  {/if}

  {#if showMonotony && monoTag}
    <!-- Monotony -->
    <div class="h-card span-4">
      <div class="h-card-head">
        <div class="h-card-head-l">
          <p class="h-card-name">MONOTONY · 7D</p>
          <EvidenceChip id="monotony" onopen={onevidence} />
        </div>
        <span class="h-card-tag {monoTag.tone}">{monoTag.label}</span>
      </div>

      <p class="h-card-value {monoValTone}">{monotony!.value.monotony.toFixed(2)}</p>

      <p class="h-card-foot action">{monotonyAction(monotony!.value.band)}</p>
    </div>
  {/if}

  {#if showPolarised}
    <!-- Intensity mix / polarisation -->
    <div class="h-card span-12">
      <div class="h-card-head">
        <div class="h-card-head-l">
          <p class="h-card-name">INTENSITY MIX · 7D</p>
          <EvidenceChip id="polarised" onopen={onevidence} />
        </div>
        <span class="h-card-tag flat">{polVerdictLabel}</span>
      </div>

      <div class="tl-mix-bar">
        {#each polSegs as s, i (i)}
          {#if s.pct > 0}
            <span class="tl-mix-seg {s.cls}" style="flex: {s.pct} 0 0"></span>
          {/if}
        {/each}
      </div>

      <div class="tl-mix-legend">
        {#each polSegs as s, i (i)}
          <span class="tl-mix-legend-item">
            <span class="tl-mix-sw {s.cls}"></span>{s.label}
            <em>{Math.round(s.pct)}%</em>
          </span>
        {/each}
        <span class="tl-mix-legend-item tl-mix-total">
          {Math.round(polarised!.value.totalMinutes)} MIN
        </span>
      </div>

      <p class="h-card-foot action">{polarisedAction(polarised!.value.verdict)}</p>
    </div>
  {/if}
</div>

<style>
  /* 28-day load mini-chart -------------------------------------------------- */
  .tl-bars-wrap {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .tl-bars-cap {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-ghost);
    margin: 0;
  }
  .tl-bars {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 40px;
  }
  .tl-bar {
    flex: 1 1 0;
    min-width: 0;
    background: rgba(26, 16, 8, 0.25);
  }
  .tl-bar.recent {
    background: var(--accent);
  }

  /* Keep the gauge from collapsing its label row under tight card flex. */
  .tl-gauge {
    margin-top: 4px;
    margin-bottom: 2px;
  }

  /* Intensity-mix stacked bar ---------------------------------------------- */
  .tl-mix-bar {
    display: flex;
    height: 18px;
    gap: 1px;
    background: var(--bg);
    margin-top: 4px;
  }
  .tl-mix-seg {
    height: 100%;
  }
  .tl-mix-seg.easy {
    background: rgba(196, 87, 10, 0.5);
  }
  .tl-mix-seg.mid {
    background: var(--warn);
  }
  .tl-mix-seg.hard {
    background: var(--accent);
  }
  .tl-mix-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    align-items: center;
  }
  .tl-mix-legend-item {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .tl-mix-legend-item em {
    color: var(--text-primary);
    font-style: normal;
  }
  .tl-mix-sw {
    width: 8px;
    height: 8px;
  }
  .tl-mix-sw.easy {
    background: rgba(196, 87, 10, 0.5);
  }
  .tl-mix-sw.mid {
    background: var(--warn);
  }
  .tl-mix-sw.hard {
    background: var(--accent);
  }
  .tl-mix-total {
    color: var(--text-ghost);
    margin-left: auto;
  }
</style>
