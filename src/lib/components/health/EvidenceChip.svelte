<script lang="ts">
  import { getMethodologyEntry } from '$lib/health/methodology';

  let {
    id,
    onopen,
  }: { id: string; onopen?: (id: string) => void } = $props();

  const entry = $derived(getMethodologyEntry(id));
</script>

{#if entry}
  <button
    type="button"
    class="ev-chip"
    title={`${entry.metric} — ${entry.cite}. Click for methodology.`}
    onclick={() => onopen?.(id)}
  >
    <span class="ev-cite">{entry.cite}</span>
  </button>
{/if}

<style>
  .ev-chip {
    display: inline-flex;
    align-items: center;
    height: 22px;
    padding: 0 8px;
    background: var(--bg-section);
    border: 1px solid var(--card-border);
    color: var(--text-ghost);
    font-family: var(--font-mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    cursor: pointer;
    transition: background 80ms ease, color 80ms ease, border-color 80ms ease;
  }
  .ev-chip:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .ev-cite { font-weight: 700; }
</style>
