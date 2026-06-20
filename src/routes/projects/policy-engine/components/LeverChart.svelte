<script lang="ts">
  // LeverChart — the keystone interactive: real ENGINE levers docked beside a live
  // outcome chart that redraws as you drag, with an animated baseline-vs-current delta
  // that makes the scale of impact legible ("this much"). Unlike the self-contained
  // slider-sims, this reads the actual engine via app.sim / app.baseSim, so the number
  // it moves is the same number every other page shows. Self-contained.
  import { Tween } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';
  import OutcomeChart, { type ChartSeries } from './OutcomeChart.svelte';
  import LeverSlider from './LeverSlider.svelte';
  import { app } from '../lib/appState.svelte';
  import { OUTCOMES_BY_ID, OUTCOME_ELI5_LABEL } from '../lib/outcomes';
  import { signed, fmt } from '../lib/chartkit';

  interface Props {
    /** YearResult field to chart (e.g. 'gapKS4', 'gapAge3', 'neet'). */
    outcome: string;
    /** Engine lever ids to surface as sliders beside the chart. */
    levers: string[];
    title?: string;
    height?: number;
    /** Optional reference target line {value,label}. */
    target?: { value: number; label: string } | null;
    /** Accent colour for the scenario line. */
    color?: string;
    /** Show the disadvantaged sub-series too, if the outcome has a `${id}Dis` sibling. */
    withDis?: boolean;
  }
  let { outcome, levers, title, height = 240, target = null, color = '#b4632e', withDis = false }: Props = $props();

  const meta = $derived(OUTCOMES_BY_ID[outcome]);
  const oname = $derived(app.narrative === 'eli5' ? (OUTCOME_ELI5_LABEL[outcome] ?? meta?.label) : meta?.label);

  const years = $derived(app.viewSim.map((y) => y.year));
  const cur = $derived(app.viewSim.map((y) => (y as any)[outcome] as number));
  const base = $derived(app.viewBase.map((y) => (y as any)[outcome] as number));

  // value at the selected horizon, scenario vs status quo
  const idxH = $derived(Math.max(0, years.findIndex((y) => y === app.horizon)));
  const curH = $derived(cur[idxH] ?? cur[cur.length - 1]);
  const baseH = $derived(base[idxH] ?? base[base.length - 1]);
  const rawDelta = $derived(curH - baseH);
  const goodDelta = $derived(meta?.goodIfUp ? rawDelta : -rawDelta);

  // animated readouts — "this much"
  const tVal = new Tween(0, { duration: 420, easing: cubicOut });
  const tDelta = new Tween(0, { duration: 420, easing: cubicOut });
  $effect(() => { tVal.target = curH; });
  $effect(() => { tDelta.target = rawDelta; });

  const series = $derived.by<ChartSeries[]>(() => {
    const out: ChartSeries[] = [];
    out.push({ label: 'Your scenario', color, values: cur, emphasis: true });
    out.push({ label: 'Status quo', color: 'rgba(28,22,17,0.5)', values: base, dashed: true });
    if (withDis) {
      const disField = `${outcome}Dis`;
      const disVals = app.viewSim.map((y) => (y as any)[disField] as number);
      if (disVals.every((v) => typeof v === 'number')) {
        out.push({ label: 'Disadvantaged', color: '#7a5aa6', values: disVals });
      }
    }
    return out;
  });

  const deltaColor = $derived(goodDelta > 0.0005 ? '#2f7d4f' : goodDelta < -0.0005 ? '#b4455e' : 'rgba(28,22,17,0.5)');
  const dp = $derived(meta?.dp ?? 1);
</script>

<div class="lc">
  <div class="lc-grid">
    <div class="lc-chart">
      <OutcomeChart
        title={title ?? oname ?? outcome}
        unit={meta?.unit ?? ''}
        {years} {series}
        baseYear={2025}
        horizonYear={app.horizon}
        {target}
        dp={dp}
        height={height}
        goodIfUp={meta?.goodIfUp ?? true} />
    </div>
    <aside class="lc-side">
      <div class="readout" aria-live="polite">
        <span class="ro-lab">In {app.horizon}</span>
        <span class="ro-val">{fmt(tVal.current, dp)}<i>{meta?.unit}</i></span>
        <span class="ro-delta" style="color:{deltaColor}">
          {signed(tDelta.current, dp)} vs status quo
        </span>
      </div>
      <div class="lc-levers">
        <span class="lev-lab">Move the levers</span>
        {#each levers as id (id)}<LeverSlider {id} />{/each}
      </div>
    </aside>
  </div>
</div>

<style>
  .lc { margin: 10px 0; }
  .lc-grid { display: grid; grid-template-columns: 1fr 230px; gap: 14px; align-items: start; }
  @media (max-width: 720px) { .lc-grid { grid-template-columns: 1fr; } }
  .lc-side { display: flex; flex-direction: column; gap: 10px; }
  .readout {
    border: 1px solid rgba(28,22,17,0.14); border-left: 3px solid #b4632e; border-radius: var(--radius-round);
    background: rgba(255,255,255,0.45); padding: 8px 10px; display: flex; flex-direction: column; gap: 1px;
  }
  .ro-lab { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.1em; color: rgba(28,22,17,0.5); }
  .ro-val { font-family: 'Fraunces', serif; font-size: 26px; font-weight: 600; color: var(--ink); line-height: 1.05; }
  .ro-val i { font-style: normal; font-size: 11px; opacity: 0.55; margin-left: 3px; }
  .ro-delta { font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 600; margin-top: 2px; }
  .lc-levers { border-top: 1px solid rgba(28,22,17,0.1); padding-top: 6px; }
  .lev-lab { font-family: 'JetBrains Mono', monospace; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.1em; color: rgba(28,22,17,0.5); display: block; margin-bottom: 2px; }
</style>
