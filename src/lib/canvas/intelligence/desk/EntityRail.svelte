<!-- src/lib/canvas/intelligence/desk/EntityRail.svelte
     Zone-backdrop and section label only — entity cards are rendered as morphing
     ArtefactCard elements by ResearchDesk and must NOT be duplicated here. -->
<script lang="ts">
  let {
    count = 0,
    railWidth = 1600,
  }: {
    /** Number of entities in the rail (for the badge). */
    count?: number;
    /** Width of the zone band in world px — matches ORG.railWidth. */
    railWidth?: number;
  } = $props();
</script>

<div class="entity-rail-zone" style:width="{railWidth}px" aria-label="Entities zone" role="region">
  <span class="rail-label">ENTITIES</span>
  {#if count > 0}
    <span class="rail-badge">{count}</span>
  {/if}
</div>

<style>
  .entity-rail-zone {
    /* Hairline band behind the entity cards — visual zone marker, no chips. */
    position: relative;
    height: 100px;
    border: 1px solid rgba(26, 16, 8, 0.10);
    background: rgba(26, 16, 8, 0.025);
    box-sizing: border-box;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 6px 10px;
    pointer-events: none;
  }
  .rail-label {
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--text-muted, rgba(26, 16, 8, 0.45));
    line-height: 1;
  }
  .rail-badge {
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    color: var(--text-muted, rgba(26, 16, 8, 0.45));
    line-height: 1;
  }
</style>
