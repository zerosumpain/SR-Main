<script lang="ts">
  import { app } from '../lib/appState.svelte';
  import { LEGISLATION_BY_ID } from '$lib/dfe-data-strategy/legislation';
  const tensions = $derived(app.align.tensions);
  const COL = { high: '#b1455e', medium: '#b4632e', low: '#9a7b1f' };
</script>

<div class="tl">
  {#if tensions.length === 0}
    <div class="tl-clear">
      <span class="ok">✓</span>
      <p>No tensions flagged. The current strategy is internally coherent — though that doesn’t mean it covers every pressure. Check the gaps and recommended focus.</p>
    </div>
  {:else}
    {#each tensions as t (t.id)}
      <div class="card" style="--c:{COL[t.severity]}">
        <div class="c-head">
          <span class="c-sev">{t.severity}</span>
          <h4 class="c-title">{t.title}</h4>
        </div>
        <p class="c-exp">{t.explanation}</p>
        <p class="c-res"><b>Resolve it:</b> {t.resolution}</p>
        <div class="c-foot">
          {#each t.triggers as tr}<span class="trig">{tr}</span>{/each}
          {#if t.legalRefs}
            {#each t.legalRefs as lr}
              {#if LEGISLATION_BY_ID[lr]}<a class="leg" href={`/projects/dfe-data-strategy/legislation#${lr}`} title={LEGISLATION_BY_ID[lr].summary}>§ {LEGISLATION_BY_ID[lr].name}</a>{/if}
            {/each}
          {/if}
        </div>
      </div>
    {/each}
  {/if}
</div>

<style>
  .tl { display: flex; flex-direction: column; gap: 9px; }
  .tl-clear { display: flex; align-items: flex-start; gap: 10px; padding: 12px 14px; border: 1px solid var(--success-border); background: var(--success-bg); border-radius: var(--radius-sharp); }
  .tl-clear .ok { font-size: 18px; color: var(--success); }
  .tl-clear p { margin: 0; font-size: var(--fs-label); line-height: 1.5; color: rgba(28,22,17,0.74); }
  .card { border: 1px solid color-mix(in srgb, var(--c) 40%, transparent); background: color-mix(in srgb, var(--c) 6%, transparent); border-left: 3px solid var(--c); border-radius: var(--radius-sharp); padding: 10px 13px; }
  .c-head { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; }
  .c-sev { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.06em; color: #fff; background: var(--c); padding: 2px 6px; border-radius: var(--radius-sharp); }
  .c-title { margin: 0; font-family: var(--fs-serif); font-size: var(--fs-body-sm); font-weight: 600; color: var(--ink); }
  .c-exp { margin: 0 0 6px; font-size: var(--fs-label); line-height: 1.5; color: rgba(28,22,17,0.78); }
  .c-res { margin: 0 0 7px; font-size: var(--fs-label-xs); line-height: 1.5; color: rgba(28,22,17,0.7); }
  .c-res b { color: var(--ink); }
  .c-foot { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .trig { font-family: var(--font-mono); font-size: var(--fs-label-xs); background: rgba(28,22,17,0.07); border-radius: var(--radius-sharp); padding: 2px 6px; color: rgba(28,22,17,0.6); }
  .leg { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--accent-ink); text-decoration: none; border-bottom: 1px dashed currentColor; }
</style>
