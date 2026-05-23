<script lang="ts">
  import type { ResolvedModel, ID } from '../lib/types';

  interface Props {
    model: ResolvedModel;
    hoverId: ID | 'spine' | null;
    hoverOutputId: ID | null;
    onHoverStrand: (id: ID | null) => void;
    onHoverOutput: (id: ID | null) => void;
  }
  let { model, hoverId, hoverOutputId, onHoverStrand, onHoverOutput }: Props = $props();

  let sources = $derived(model.strands.filter((s) => !s.isReference));
  let references = $derived(model.strands.filter((s) => s.isReference));
</script>

<div class="legend">
  <div class="lg-section">
    <span class="lab">Sources</span>
    <ul>
      {#each sources as s (s.id)}
        <li
          class:active={hoverId === s.id}
          onpointerenter={() => onHoverStrand(s.id)}
          onpointerleave={() => onHoverStrand(null)}
        >
          <span class="dot" style="background:{s.colour}"></span>
          <span class="nm">{s.name}</span>
        </li>
      {/each}
    </ul>
  </div>
  {#if references.length > 0}
    <div class="lg-section">
      <span class="lab">Reference data</span>
      <ul>
        {#each references as s (s.id)}
          <li
            class:active={hoverId === s.id}
            onpointerenter={() => onHoverStrand(s.id)}
            onpointerleave={() => onHoverStrand(null)}
          >
            <span class="dot dotted" style="border-color:{s.colour}"></span>
            <span class="nm">{s.name}</span>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
  {#if model.outputs.length > 0}
    <div class="lg-section">
      <span class="lab">Outputs</span>
      <ul>
        {#each model.outputs as o (o.id)}
          <li
            class:active={hoverOutputId === o.id}
            onpointerenter={() => onHoverOutput(o.id)}
            onpointerleave={() => onHoverOutput(null)}
          >
            <span class="ring" style="border-color:{o.colour}"></span>
            <span class="nm">{o.name}</span>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</div>

<style>
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 18px 28px;
    font-family: 'DM Sans', system-ui, sans-serif;
    font-size: 12.5px;
    color: var(--ink);
  }
  .lg-section { min-width: 0; }
  .lab {
    display: block;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 10px;
    letter-spacing: 0.18em;
    color: rgba(28, 22, 17, 0.55);
    text-transform: uppercase;
    margin-bottom: 6px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 3px 6px;
  }
  li {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    cursor: default;
    padding: 3px 6px;
    border-radius: 4px;
    transition: background 0.12s;
    white-space: nowrap;
  }
  li:hover, li.active {
    background: rgba(28, 22, 17, 0.06);
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    box-shadow: 0 0 0 1px rgba(28, 22, 17, 0.12);
  }
  .dot.dotted {
    background: transparent !important;
    border: 1.5px dashed #888;
    border-radius: 50%;
    box-shadow: none;
  }
  .ring {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 2px solid #888;
    background: transparent;
  }
  .nm { font-size: 12px; }

  @media (max-width: 720px) {
    .legend { flex-direction: column; gap: 6px; }
  }
</style>
