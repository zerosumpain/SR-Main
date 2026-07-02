<script lang="ts">
  import type { Snippet } from 'svelte';
  let { label, children, open = false }: { label: string; children: Snippet; open?: boolean } = $props();
</script>

<details class="rv" {open}>
  <summary><span class="rv-plus" aria-hidden="true"></span>{label}</summary>
  <div class="rv-body">{@render children()}</div>
</details>

<style>
  .rv {
    margin: 8px 0 4px;
    border: 1px dashed rgba(28, 22, 17, 0.25);
    border-radius: var(--radius-round);
    background: rgba(255, 255, 255, 0.3);
  }
  .rv[open] {
    border-style: solid;
    background: rgba(255, 255, 255, 0.45);
  }
  summary {
    list-style: none;
    display: flex;
    align-items: center;
    gap: 9px;
    cursor: pointer;
    padding: 11px 16px;
    font-family: 'DM Sans', sans-serif;
    font-size: 13.5px;
    font-weight: 600;
    color: var(--ink);
  }
  summary::-webkit-details-marker {
    display: none;
  }
  summary:hover {
    color: var(--accent-ink);
  }
  .rv-plus {
    position: relative;
    width: 14px;
    height: 14px;
    flex: none;
  }
  .rv-plus::before,
  .rv-plus::after {
    content: '';
    position: absolute;
    background: currentColor;
    transition: transform 0.15s var(--ease-out, ease-out);
  }
  .rv-plus::before {
    left: 0;
    right: 0;
    top: 6px;
    height: 2px;
  }
  .rv-plus::after {
    top: 0;
    bottom: 0;
    left: 6px;
    width: 2px;
  }
  .rv[open] .rv-plus::after {
    transform: scaleY(0);
  }
  .rv-body {
    padding: 2px 16px 16px;
  }
</style>
