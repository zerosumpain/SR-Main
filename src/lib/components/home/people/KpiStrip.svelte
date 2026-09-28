<script lang="ts">
  /** The headline row under the filters: a few figures, each with what it counts. */
  let { cells }: { cells: Array<{ label: string; value: string; sub: string; note?: string | null; tone?: 'good' | 'watch' | null }> } = $props();
</script>

<dl class="ks">
  {#each cells as c (c.label)}
    <div>
      <dt>{c.label}</dt>
      <dd>{c.value}</dd>
      <small>{c.sub}</small>
      {#if c.note}<small class="ks-note" data-tone={c.tone ?? undefined}>{c.note}</small>{/if}
    </div>
  {/each}
</dl>

<style>
  .ks {
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 170px), 1fr));
    border-bottom: 1px solid var(--line-strong);
    background: var(--bg);
  }
  .ks div {
    padding: 14px clamp(16px, 2vw, 22px);
    border-right: 1px solid var(--line);
    display: grid;
    gap: 2px;
    align-content: start;
  }
  dt {
    font: 600 var(--fs-label-xs) var(--font-mono);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  dd {
    margin: 0;
    font: var(--fs-display-xs) var(--font-display);
    font-variant-numeric: tabular-nums;
  }
  small {
    font-size: var(--fs-label);
    color: var(--text-muted);
  }
  .ks-note {
    font: 600 var(--fs-label-xs) var(--font-mono);
    color: var(--accent-ink);
  }
  .ks-note[data-tone='watch'] {
    color: var(--accent);
  }
</style>
