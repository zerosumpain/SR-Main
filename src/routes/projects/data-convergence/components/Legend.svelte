<script lang="ts">
  import type { ResolvedModel, ID } from '../lib/types';

  interface Props {
    model: ResolvedModel;
    hoverId: ID | 'spine' | null;
    onHover: (id: ID | null) => void;
  }
  let { model, hoverId, onHover }: Props = $props();
</script>

<div class="legend">
  <span class="lab">SOURCES</span>
  <ul>
    {#each model.strands as s (s.id)}
      <li
        class:active={hoverId === s.id}
        onpointerenter={() => onHover(s.id)}
        onpointerleave={() => onHover(null)}
      >
        <span class="dot" style="background:{s.colour}"></span>
        <span class="nm">{s.name}</span>
      </li>
    {/each}
  </ul>
</div>

<style>
  .legend {
    display: flex;
    align-items: baseline;
    gap: 14px;
    flex-wrap: wrap;
    font-family: 'DM Sans', system-ui, sans-serif;
    font-size: 12.5px;
    color: var(--ink);
  }
  .lab {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 10.5px;
    letter-spacing: 0.16em;
    color: rgba(28, 22, 17, 0.5);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
  }
  li {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    cursor: default;
    padding: 4px 8px;
    border-radius: 4px;
    transition: background 0.14s;
  }
  li:hover, li.active {
    background: rgba(28, 22, 17, 0.06);
  }
  .dot {
    width: 11px;
    height: 11px;
    border-radius: 50%;
    box-shadow: 0 0 0 1px rgba(28, 22, 17, 0.12);
  }
</style>
