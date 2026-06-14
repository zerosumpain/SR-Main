<!-- src/lib/canvas/intelligence/desk/EntityRail.svelte -->
<script lang="ts">
  let {
    entities,
    selectedId,
    onSelect,
  }: {
    entities: { id: string; name: string; type: string }[];
    selectedId: string | null;
    onSelect: (id: string) => void;
  } = $props();
</script>

<div class="entity-rail" role="group" aria-label="Entities">
  {#each entities as e (e.id)}
    <button
      type="button"
      class="chip"
      class:selected={selectedId === e.id}
      data-entity-id={e.id}
      title={e.type}
      onclick={() => onSelect(e.id)}
    >
      <span class="name">{e.name}</span>
      <span class="kind">{e.type}</span>
    </button>
  {/each}
</div>

<style>
  .entity-rail {
    display: flex;
    flex-wrap: wrap;
    gap: 20px;
    align-items: flex-start;
  }
  .chip {
    display: inline-flex;
    flex-direction: column;
    gap: 2px;
    width: 220px;
    box-sizing: border-box;
    text-align: left;
    background: var(--text-primary, #1a1008);
    color: var(--card, #faf6ee);
    border: 1px solid rgba(26, 16, 8, 0.5);
    border-radius: 4px;
    box-shadow: 3px 4px 0 rgba(26, 16, 8, 0.1);
    padding: 9px 12px;
    cursor: pointer;
    transition: transform 120ms ease, box-shadow 120ms ease;
  }
  .chip:hover { transform: translateY(-1px); }
  .chip.selected { outline: 2px solid var(--accent, #c4570a); outline-offset: 2px; }
  .name {
    font-family: var(--font-display, 'Archivo Black', sans-serif);
    font-size: 13px;
    line-height: 1.1;
  }
  .kind {
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: 10px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    opacity: 0.7;
  }
</style>
