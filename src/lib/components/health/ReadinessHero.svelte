<script lang="ts">
  let {
    readiness,
    onopenDetail,
  }: { readiness: any; onopenDetail?: () => void } = $props();

  const factors = $derived(readiness?.factors ?? {});

  function fmtKey(k: string): string {
    return k.replace(/([A-Z])/g, ' $1').trim();
  }
</script>

<section class="nm-sec rh">
  <div class="nm-sec-hd">
    <span class="sr-label-tight">Readiness</span>
    {#if readiness}
      <span class="nm-sec-meta">{readiness.label?.toLowerCase?.() ?? ''}</span>
    {/if}
    {#if readiness && onopenDetail}
      <button type="button" class="row-link" onclick={() => onopenDetail?.()}>Detail</button>
    {/if}
  </div>

  {#if readiness}
    <div class="rh-body">
      <div class="rh-score-block">
        <div class="rh-score">{Math.round(readiness.score)}</div>
        <p class="rh-recom">{readiness.recommendation}</p>
      </div>
      <ul class="rh-factors">
        {#each Object.entries(factors) as [key, factor]}
          {@const f = factor as any}
          {@const val = Math.round(f.value ?? 0)}
          {@const isHrv = key === 'hrvTrend' && f.raw != null}
          <li class="rh-frow">
            <span class="rh-fkey">{fmtKey(key)}</span>
            <span class="rh-fval">
              {#if isHrv}{Math.round(f.raw)}<span class="rh-unit">ms</span>{:else}{val}{/if}
            </span>
            <span class="rh-fbar"><span class="rh-fbar-fill" style="width:{Math.min(100, Math.max(0, val))}%;"></span></span>
          </li>
        {/each}
      </ul>
    </div>
  {:else}
    <p class="rh-empty">No readiness data available.</p>
  {/if}
</section>

<style>
  .rh { padding: 0.9rem 1.1rem 1rem; }
  .rh-body {
    display: grid;
    grid-template-columns: minmax(140px, auto) minmax(0, 1fr);
    gap: 1.5rem;
    align-items: center;
  }
  .rh-score-block { display: flex; flex-direction: column; gap: 0.4rem; }
  .rh-score {
    font-family: var(--font-display);
    font-size: 56px;
    font-weight: 200;
    line-height: 1;
    color: var(--text-primary);
    letter-spacing: -0.02em;
  }
  .rh-recom {
    margin: 0;
    font-size: 11px;
    line-height: 1.45;
    color: var(--text-muted);
    max-width: 32ch;
  }
  .rh-factors { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .rh-frow {
    display: grid;
    grid-template-columns: 1fr auto 120px;
    align-items: center;
    gap: 0.75rem;
    font-family: var(--font-mono);
    font-size: 11px;
  }
  .rh-fkey {
    color: var(--text-muted);
    text-transform: capitalize;
    letter-spacing: 0.05em;
  }
  .rh-fval { color: var(--text-primary); text-align: right; }
  .rh-unit { color: var(--text-ghost); font-size: 9px; margin-left: 2px; }
  .rh-fbar { display: block; height: 2px; background: var(--card-border); position: relative; }
  .rh-fbar-fill { display: block; height: 2px; background: var(--accent); }
  .rh-empty {
    margin: 0; font-family: var(--font-mono); font-size: 11px;
    color: var(--text-ghost); font-style: italic;
  }

  .row-link {
    margin-left: auto;
    font-family: var(--font-mono); font-size: 10px;
    text-transform: uppercase; letter-spacing: 0.1em;
    color: var(--accent); background: none; border: 0; padding: 0; cursor: pointer;
  }
  .row-link:hover { color: var(--accent-hover); text-decoration: underline; }

  @media (max-width: 640px) {
    .rh-body { grid-template-columns: 1fr; gap: 0.9rem; }
    .rh-frow { grid-template-columns: 1fr auto 80px; }
  }
</style>
