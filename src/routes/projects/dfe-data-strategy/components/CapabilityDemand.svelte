<script lang="ts">
  import { PRESSURES } from '../lib/pressures';
  import { CAPABILITY_AREAS } from '../lib/capabilities';
  import type { Origin } from '../lib/types';

  const ORIGINS: { id: Origin; label: string }[] = [
    { id: 'cross-government', label: 'Cross-gov' },
    { id: 'dfe-policy', label: 'The department policy' },
    { id: 'partners', label: 'Partners' },
  ];

  // demand[area][origin] = sum of severity of pressures of that origin demanding that capability
  const grid = $derived.by(() => {
    const g: Record<string, Record<string, number>> = {};
    let max = 1;
    const totals: Record<string, number> = {};
    for (const a of CAPABILITY_AREAS) {
      g[a.id] = { 'cross-government': 0, 'dfe-policy': 0, partners: 0 };
      for (const p of PRESSURES) if (p.demands.includes(a.id)) g[a.id][p.origin] += p.severity;
      totals[a.id] = ORIGINS.reduce((s, o) => s + g[a.id][o.id], 0);
      for (const o of ORIGINS) max = Math.max(max, g[a.id][o.id]);
    }
    const order = [...CAPABILITY_AREAS].sort((x, y) => totals[y.id] - totals[x.id]);
    return { g, max, totals, order };
  });
  const shade = (v: number) => (v <= 0 ? 'rgba(28,22,17,0.04)' : `rgba(47,97,85,${0.12 + 0.72 * (v / grid.max)})`);
</script>

<div class="cd">
  <div class="row head">
    <span class="cell lab"></span>
    {#each ORIGINS as o}<span class="cell col-h">{o.label}</span>{/each}
    <span class="cell col-h tot">Total</span>
  </div>
  {#each grid.order as a}
    <div class="row">
      <span class="cell lab" title={a.description}>{a.short}</span>
      {#each ORIGINS as o}
        {@const v = grid.g[a.id][o.id]}
        <span class="cell val" style="background:{shade(v)}; color:{v / grid.max > 0.55 ? '#fff' : 'rgba(28,22,17,0.7)'}">{v || ''}</span>
      {/each}
      <span class="cell tot">{grid.totals[a.id]}</span>
    </div>
  {/each}
  <p class="cd-note">Severity-weighted demand on each capability, by where the pressure comes from. Darker = more of the strategic load lands here. <b>{grid.order[0].short}</b>, <b>{grid.order[1].short}</b> and <b>{grid.order[2].short}</b> carry the most.</p>
</div>

<style>
  .cd { font-family: var(--font-body); }
  .row { display: grid; grid-template-columns: 1.4fr 1fr 1fr 1fr 0.7fr; gap: 3px; margin-bottom: 3px; }
  .cell { display: flex; align-items: center; justify-content: center; padding: 7px 6px; border-radius: var(--radius-sharp); font-size: var(--fs-label-xs); }
  .cell.lab { justify-content: flex-start; font-weight: 600; color: rgba(28,22,17,0.78); font-size: var(--fs-label-xs); }
  .col-h { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.05em; color: rgba(28,22,17,0.55); }
  .val { font-family: var(--font-mono); font-weight: 600; }
  .tot { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; color: rgba(28,22,17,0.6); background: rgba(28,22,17,0.04); }
  .head .cell { padding-top: 0; padding-bottom: 4px; }
  .cd-note { margin: 10px 0 0; font-size: var(--fs-label-xs); line-height: 1.5; color: rgba(28,22,17,0.6); }
  .cd-note b { color: var(--ink); }
</style>
