<script lang="ts">
  import type { ResolvedModel, ID, StrandConfig, OutputConfig } from '../lib/types';

  interface Props {
    model: ResolvedModel;
    /** Raw config — includes hidden rows that the resolved model has filtered out. */
    rawStrands: StrandConfig[];
    rawOutputs: OutputConfig[];
    hoverId: ID | 'spine' | null;
    hoverOutputId: ID | null;
    onHoverStrand: (id: ID | null) => void;
    onHoverOutput: (id: ID | null) => void;
    onToggleStrand: (id: ID) => void;
    onToggleOutput: (id: ID) => void;
  }
  let { model, rawStrands, rawOutputs, hoverId, hoverOutputId, onHoverStrand, onHoverOutput, onToggleStrand, onToggleOutput }: Props = $props();

  let sources = $derived(rawStrands.filter((s) => !s.isReference));
  let references = $derived(rawStrands.filter((s) => s.isReference));
  // model isn't read here yet but accepting it keeps the API future-proof.
  $effect(() => { void model; });
</script>

<div class="legend">
  <div class="lg-section">
    <span class="lab">Sources <span class="hint">(click to toggle)</span></span>
    <ul>
      {#each sources as s (s.id)}
        <li
          class:active={hoverId === s.id}
          class:hidden-row={s.visible === false}
          role="button"
          tabindex="0"
          onpointerenter={() => onHoverStrand(s.id)}
          onpointerleave={() => onHoverStrand(null)}
          onclick={() => onToggleStrand(s.id)}
          onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleStrand(s.id); } }}
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
            class:hidden-row={s.visible === false}
            onpointerenter={() => onHoverStrand(s.id)}
            onpointerleave={() => onHoverStrand(null)}
            onclick={() => onToggleStrand(s.id)}
          >
            <span class="dot dotted" style="border-color:{s.colour}"></span>
            <span class="nm">{s.name}</span>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
  {#if rawOutputs.length > 0}
    <div class="lg-section">
      <span class="lab">Outputs <span class="hint">(click to toggle)</span></span>
      <ul>
        {#each rawOutputs as o (o.id)}
          <li
            class:active={hoverOutputId === o.id}
            class:hidden-row={o.visible === false}
            role="button"
            tabindex="0"
            onpointerenter={() => onHoverOutput(o.id)}
            onpointerleave={() => onHoverOutput(null)}
            onclick={() => onToggleOutput(o.id)}
            onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleOutput(o.id); } }}
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
  .hint {
    letter-spacing: 0.06em;
    text-transform: none;
    font-size: 9.5px;
    color: rgba(28, 22, 17, 0.4);
    margin-left: 4px;
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
    cursor: pointer;
    padding: 3px 6px;
    border-radius: 4px;
    transition: background 0.12s, opacity 0.12s;
    white-space: nowrap;
    user-select: none;
  }
  li:hover, li.active {
    background: rgba(28, 22, 17, 0.06);
  }
  li.hidden-row {
    opacity: 0.38;
  }
  li.hidden-row .nm {
    text-decoration: line-through;
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
