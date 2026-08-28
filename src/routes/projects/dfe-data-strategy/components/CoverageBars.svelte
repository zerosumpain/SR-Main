<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import { PRESSURES } from '$lib/dfe-data-strategy/pressures';
  import { CAPABILITY_BY_ID } from '../lib/capabilities';
  import { pct } from '../lib/format';
  import type { Origin } from '$lib/dfe-data-strategy/types';

  const FILTERS: { id: 'all' | Origin; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'cross-government', label: 'Cross-gov' },
    { id: 'dfe-policy', label: 'The department policy' },
    { id: 'partners', label: 'Partners' },
  ];
  const list = $derived(
    PRESSURES.filter((p) => app.originFilter === 'all' || p.origin === app.originFilter).sort(
      (x, y) => y.severity * (1 - (app.align.coverage[y.id] ?? 0)) - x.severity * (1 - (app.align.coverage[x.id] ?? 0)),
    ),
  );
  let open = $state<string | null>(null);
  const eli = $derived(app.narrative === 'eli5');
  const tone = (c: number) => (c >= 0.66 ? '#2f7d4f' : c >= 0.4 ? '#9a7b1f' : '#b1455e');
</script>

<div class="cb">
  <div class="cb-filters">
    {#each FILTERS as f}
      <button class:on={app.originFilter === f.id} onclick={() => (app.originFilter = f.id)}>{f.label}</button>
    {/each}
  </div>

  {#each list as p (p.id)}
    {@const cov = app.align.coverage[p.id] ?? 0}
    <div class="row">
      <button class="r-main" onclick={() => (open = open === p.id ? null : p.id)} aria-expanded={open === p.id}>
        <div class="r-top">
          <span class="r-title">{p.title}</span>
          <span class="r-sev" title={`Severity ${p.severity}/5`}>{'●'.repeat(p.severity)}<span class="ghost">{'●'.repeat(5 - p.severity)}</span></span>
        </div>
        <div class="r-bar">
          <span class="r-fill" style="width:{cov * 100}%; background:{tone(cov)}"></span>
        </div>
        <div class="r-foot">
          <span class="r-cov" style="color:{tone(cov)}">{pct(cov)} covered</span>
          <span class="r-driver">driven by {p.demands.map((d) => CAPABILITY_BY_ID[d]?.short ?? d).join(' · ')}</span>
          <span class="r-chev">{open === p.id ? '▾' : '▸'}</span>
        </div>
      </button>
      {#if open === p.id}
        <div class="r-detail">
          <p class="rd-desc">{eli && p.eli5 ? p.eli5 : p.description}</p>
          <div class="rd-trace">
            <span class="rd-lab">How this coverage is computed</span>
            {#each app.align.coverageTrace[p.id] ?? [] as t}
              <div class="trace-row">
                <span class="t-area">{CAPABILITY_BY_ID[t.area]?.short ?? t.area}</span>
                <div class="t-bar"><span style="width:{t.cap * 100}%"></span></div>
                <span class="t-val">{pct(t.cap)} × {t.weight.toFixed(2)}</span>
              </div>
            {/each}
          </div>
          <div class="rd-meta">
            {#if p.policyEngineRef}<a class="rd-pe" href={p.policyEngineRef.href}>↪ {p.policyEngineRef.label}</a>{/if}
            {#if p.sourceUrl}<a class="rd-src" href={p.sourceUrl} target="_blank" rel="noopener">{p.sourceName ?? 'Source'} ↗</a>{/if}
          </div>
        </div>
      {/if}
    </div>
  {/each}
</div>

<style>
  .cb { display: flex; flex-direction: column; gap: 6px; }
  .cb-filters { display: flex; gap: 5px; flex-wrap: wrap; margin-bottom: 4px; }
  .cb-filters button { font-family: var(--font-mono); font-size: var(--fs-label-xs); padding: 4px 9px; border-radius: var(--radius-sharp); cursor: pointer;
    border: 1px solid rgba(28,22,17,0.2); background: rgba(255,255,255,0.6); color: var(--ink); }
  .cb-filters button.on { background: var(--ink); color: var(--paper); border-color: var(--ink); }
  .row { border: 1px solid rgba(28,22,17,0.1); border-radius: var(--radius-sharp); background: rgba(255,255,255,0.4); overflow: hidden; }
  .r-main { display: block; width: 100%; text-align: left; background: none; border: none; cursor: pointer; padding: 9px 11px; }
  .r-main:hover { background: rgba(28,22,17,0.03); }
  .r-top { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  .r-title { font-family: var(--font-body); font-size: var(--fs-label); font-weight: 600; color: var(--ink); }
  .r-sev { font-size: var(--fs-label-xs); color: #b4632e; letter-spacing: 1px; white-space: nowrap; }
  .r-sev .ghost { color: rgba(28,22,17,0.15); }
  .r-bar { height: 7px; border-radius: var(--radius-sharp); background: rgba(28,22,17,0.1); overflow: hidden; margin: 6px 0 4px; }
  .r-fill { display: block; height: 100%; border-radius: var(--radius-sharp); transition: width 0.2s ease; }
  .r-foot { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .r-cov { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; }
  .r-driver { font-size: var(--fs-label-xs); color: rgba(28,22,17,0.5); }
  .r-chev { margin-left: auto; color: rgba(28,22,17,0.4); font-size: var(--fs-label-xs); }
  .r-detail { padding: 4px 12px 12px; border-top: 1px solid rgba(28,22,17,0.08); }
  .rd-desc { margin: 8px 0; font-size: var(--fs-label); line-height: 1.5; color: rgba(28,22,17,0.74); }
  .rd-trace { background: rgba(28,22,17,0.03); border-radius: var(--radius-sharp); padding: 8px 10px; }
  .rd-lab { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.08em; color: rgba(28,22,17,0.5); }
  .trace-row { display: grid; grid-template-columns: 70px 1fr 86px; align-items: center; gap: 8px; margin-top: 4px; }
  .t-area { font-size: var(--fs-label-xs); color: rgba(28,22,17,0.7); }
  .t-bar { height: 6px; border-radius: var(--radius-sharp); background: rgba(28,22,17,0.1); overflow: hidden; }
  .t-bar span { display: block; height: 100%; background: var(--accent-ink); }
  .t-val { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: rgba(28,22,17,0.55); text-align: right; }
  .rd-meta { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 8px; }
  .rd-pe { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: #8a2d3a; text-decoration: none; border-bottom: 1px dashed currentColor; }
  .rd-src { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--accent-ink); text-decoration: none; border-bottom: 1px dashed currentColor; }
</style>
