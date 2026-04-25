<script lang="ts">
  let {
    readiness,
    onopenDetail,
  }: { readiness: any; onopenDetail?: () => void } = $props();

  const factors = $derived(readiness?.factors ?? {});
</script>

<section class="rh">
  <div class="rh-inner">
    {#if readiness}
      <button type="button" class="rh-left" onclick={() => onopenDetail?.()} title="Open readiness detail">
        <div class="rh-kicker">Readiness</div>
        <div class="rh-score">{Math.round(readiness.score)}</div>
        <div class="rh-label">{readiness.label}</div>
        <p class="rh-recom">{readiness.recommendation}</p>
      </button>
      <div class="rh-right">
        <div class="rh-rk">Composite factors</div>
        {#each Object.entries(factors) as [key, factor]}
          {@const f = factor as any}
          {@const val = Math.round(f.value ?? 0)}
          <div class="rh-frow">
            <span class="rh-fkey">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
            <span class="rh-fval">
              {#if key === 'hrvTrend' && f.raw != null}
                {Math.round(f.raw)} <span class="rh-unit">ms</span>
              {:else}
                {val}
              {/if}
            </span>
          </div>
          <div class="rh-fbar"><div class="rh-fbar-fill" style="width: {Math.min(100, Math.max(0, val))}%;"></div></div>
        {/each}
      </div>
    {:else}
      <p class="rh-empty">No readiness data available.</p>
    {/if}
  </div>
</section>

<style>
  .rh { padding: 1.5rem 1.5rem 2rem; max-width: 1200px; margin: 0 auto; }
  .rh-inner {
    display: grid;
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
    gap: 2.5rem;
    border: 1px solid var(--card-border);
    background: var(--bg-section);
    padding: 2rem 2rem 2rem;
  }
  .rh-left {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    text-align: left;
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
    color: inherit;
  }
  .rh-kicker {
    font-family: var(--font-mono); font-size: 10px; text-transform: uppercase;
    letter-spacing: 0.18em; color: var(--accent);
  }
  .rh-score {
    font-family: var(--font-display); font-size: 120px; font-weight: 200;
    line-height: 0.95; color: var(--accent); margin-top: 0.25rem;
  }
  .rh-label {
    font-family: var(--font-mono); font-size: 11px; text-transform: uppercase;
    letter-spacing: 0.18em; color: var(--text-secondary); margin-top: 0.5rem;
  }
  .rh-recom {
    margin: 1rem 0 0; font-size: 13px; line-height: 1.55;
    color: var(--text-secondary); max-width: 38ch;
  }
  .rh-right { display: flex; flex-direction: column; gap: 6px; }
  .rh-rk {
    font-family: var(--font-mono); font-size: 9px; text-transform: uppercase;
    letter-spacing: 0.12em; color: var(--text-ghost); margin-bottom: 6px;
  }
  .rh-frow {
    display: flex; justify-content: space-between;
    font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary);
    text-transform: capitalize;
  }
  .rh-fkey { color: var(--text-secondary); }
  .rh-fval { color: var(--text-primary); }
  .rh-unit { color: var(--text-ghost); font-size: 10px; }
  .rh-fbar { height: 2px; background: var(--card-border); margin-bottom: 6px; }
  .rh-fbar-fill { height: 2px; background: var(--accent); }
  .rh-empty {
    font-family: var(--font-mono); font-size: 12px; color: var(--text-ghost);
    text-align: center; padding: 3rem 0;
  }
  @media (max-width: 768px) {
    .rh-inner { grid-template-columns: 1fr; padding: 1.25rem; gap: 1.5rem; }
    .rh-score { font-size: 80px; }
  }
</style>
