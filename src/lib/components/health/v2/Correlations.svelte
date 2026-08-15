<script lang="ts">
  import type { Correlation } from '$lib/health/series-30d-service';
  let { items }: { items: Correlation[] } = $props();
</script>

<div class="h-corr-grid">
  {#each items as it, i (i)}
    <div class="h-corr">
      <p class="h-corr-cause"><em>{it.cause}</em></p>
      <p class="h-corr-effect">{it.effect} <span class="num">{it.num}</span></p>
      <p class="h-corr-badge h-corr-badge-{it.confidence.toLowerCase()}">{it.confidence}</p>
      <p class="h-corr-conf">{it.conf}</p>
    </div>
  {/each}
</div>

<style>
  .h-corr-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0;
    border: 2px solid var(--line-strong);
  }
  @media (max-width: 900px) {
    .h-corr-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }
  .h-corr {
    padding: 22px 20px;
    border-right: 1px solid var(--line-hair);
    border-bottom: 1px solid var(--line-hair);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .h-corr-cause {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0;
  }
  .h-corr-cause em {
    color: var(--accent);
    font-style: normal;
  }
  .h-corr-effect {
    font-family: var(--font-display);
    font-weight: 900;
    font-size: 22px;
    text-transform: uppercase;
    letter-spacing: -0.02em;
    line-height: 1.05;
    margin: 0;
    color: var(--text-primary);
  }
  .h-corr-effect .num {
    color: var(--accent);
  }
  .h-corr-conf {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.15em;
    color: var(--text-ghost);
    text-transform: uppercase;
    margin: 0;
  }
  .h-corr-badge {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 700;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    margin: 0;
    align-self: flex-start;
    padding: 2px 6px;
    border: 1px solid currentColor;
  }
  .h-corr-badge-strong {
    color: var(--accent);
  }
  .h-corr-badge-maybe {
    color: var(--text-muted);
  }
  .h-corr-badge-noise {
    color: var(--text-ghost);
  }
</style>
