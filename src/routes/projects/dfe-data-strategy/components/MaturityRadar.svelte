<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import { MATURITY_DIMENSIONS, MATURITY_LEVELS } from '$lib/dfe-data-strategy/maturity';

  const N = MATURITY_DIMENSIONS.length;
  const cx = 150;
  const cy = 140;
  const R = 108;
  const ang = (i: number) => (-90 + (i * 360) / N) * (Math.PI / 180);
  const pt = (i: number, level: number) => {
    const r = (Math.max(0, Math.min(5, level)) / 5) * R;
    return [cx + r * Math.cos(ang(i)), cy + r * Math.sin(ang(i))];
  };
  const poly = (vals: number[]) => vals.map((v, i) => pt(i, v).join(',')).join(' ');

  const current = $derived(MATURITY_DIMENSIONS.map((d) => app.state.maturityCurrent[d.id] ?? 2));
  const target = $derived(MATURITY_DIMENSIONS.map((d) => app.state.maturityTarget[d.id] ?? 4));
  const projected = $derived(MATURITY_DIMENSIONS.map((d) => app.align.maturityProjected[d.id] ?? 2));
  const lvlName = (n: number) => MATURITY_LEVELS[Math.max(0, Math.min(4, Math.round(n) - 1))]?.name ?? '';
</script>

<div class="mr">
  <div class="mr-chart">
    <svg viewBox="0 0 300 290" width="100%" style="max-width:340px" role="img" aria-label="Maturity radar">
      <!-- rings -->
      {#each [1, 2, 3, 4, 5] as ring}
        <polygon points={poly(MATURITY_DIMENSIONS.map(() => ring))} fill="none" stroke="rgba(28,22,17,0.1)" stroke-width="1" />
      {/each}
      <!-- spokes + labels -->
      {#each MATURITY_DIMENSIONS as d, i}
        {@const o = pt(i, 5)}
        {@const l = pt(i, 5.75)}
        <line x1={cx} y1={cy} x2={o[0]} y2={o[1]} stroke="rgba(28,22,17,0.1)" stroke-width="1" />
        <text x={l[0]} y={l[1]} font-size="8.5" font-family="var(--font-mono)" fill="rgba(28,22,17,0.6)"
          text-anchor={l[0] < cx - 8 ? 'end' : l[0] > cx + 8 ? 'start' : 'middle'} dominant-baseline="middle">{d.name.split(' ')[0]}</text>
      {/each}
      <!-- target -->
      <polygon points={poly(target)} fill="rgba(58,95,168,0.08)" stroke="#3a5fa8" stroke-width="1.5" stroke-dasharray="3 3" />
      <!-- projected (engine estimate) -->
      <polygon points={poly(projected)} fill="rgba(47,125,79,0.16)" stroke="#2f7d4f" stroke-width="2" />
      <!-- current -->
      <polygon points={poly(current)} fill="none" stroke="#b4632e" stroke-width="1.5" />
    </svg>
    <div class="mr-key">
      <span class="k"><i style="background:#b4632e"></i>Current</span>
      <span class="k"><i style="background:#2f7d4f"></i>Projected under this strategy</span>
      <span class="k"><i style="border:1.5px dashed #3a5fa8;background:transparent"></i>Target</span>
    </div>
  </div>

  <div class="mr-sliders">
    {#each MATURITY_DIMENSIONS as d, i}
      <div class="dim">
        <div class="d-head">
          <span class="d-name" title={d.description}>{d.name}</span>
          <span class="d-proj" title="Projected level under the current strategy">→ {lvlName(projected[i])}</span>
        </div>
        <div class="d-controls">
          <label class="dc">
            <span>Now</span>
            <input type="range" min="1" max="5" step="1" value={current[i]} oninput={(e) => app.setMaturity('current', d.id, +e.currentTarget.value)} style="accent-color:#b4632e" />
            <b>{current[i]}</b>
          </label>
          <label class="dc">
            <span>Target</span>
            <input type="range" min="1" max="5" step="1" value={target[i]} oninput={(e) => app.setMaturity('target', d.id, +e.currentTarget.value)} style="accent-color:#3a5fa8" />
            <b>{target[i]}</b>
          </label>
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .mr { display: grid; grid-template-columns: minmax(260px, 340px) 1fr; gap: 14px 24px; align-items: start; }
  .mr-chart { display: flex; flex-direction: column; align-items: center; }
  .mr-key { display: flex; flex-direction: column; gap: 3px; margin-top: 6px; }
  .mr-key .k { display: inline-flex; align-items: center; gap: 6px; font-family: var(--font-mono); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.65); }
  .mr-key i { width: 12px; height: 6px; border-radius: var(--radius-sharp); display: inline-block; }
  .mr-sliders { display: grid; grid-template-columns: 1fr; gap: 7px; }
  .dim { border-bottom: 1px solid rgba(28,22,17,0.08); padding-bottom: 6px; }
  .d-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  .d-name { font-size: var(--fs-label-xs); font-weight: 600; color: var(--ink); }
  .d-proj { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--success); white-space: nowrap; }
  .d-controls { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 14px; margin-top: 3px; }
  .dc { display: grid; grid-template-columns: 38px 1fr 14px; align-items: center; gap: 5px; }
  .dc span { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; color: rgba(28,22,17,0.5); }
  .dc input { width: 100%; cursor: pointer; }
  .dc b { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--ink); text-align: right; }
  @media (max-width: 720px) { .mr { grid-template-columns: 1fr; } }
</style>
