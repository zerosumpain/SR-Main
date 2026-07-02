<script lang="ts">
  import type { Snippet } from 'svelte';
  import { GLOSSARY_BY_ID } from '../lib/glossary';

  let { id, children }: { id: string; children?: Snippet } = $props();
  const g = $derived(GLOSSARY_BY_ID[id]);
</script>

{#if g}
  <span class="term" tabindex="0">
    {#if children}{@render children()}{:else}{g.term}{/if}
    <span class="tip" role="tooltip"><b>{g.term}</b> {g.def}</span>
  </span>
{:else if children}
  {@render children()}
{/if}

<style>
  .term {
    position: relative;
    border-bottom: 1px dotted var(--accent-ink);
    cursor: help;
  }
  .tip {
    position: absolute;
    left: 50%;
    bottom: calc(100% + 7px);
    transform: translateX(-50%);
    width: max-content;
    max-width: 290px;
    background: var(--ink, #1c1611);
    color: #f1ead6;
    font-size: 11.5px;
    line-height: 1.5;
    font-style: normal;
    font-family: 'DM Sans', sans-serif;
    padding: 8px 11px;
    border-radius: var(--radius-round);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.12s;
    z-index: 40;
  }
  .tip b {
    display: block;
    font-family: 'JetBrains Mono', monospace;
    font-size: 9.5px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    margin-bottom: 2px;
    color: #d8c9a8;
  }
  .term:hover .tip,
  .term:focus .tip {
    opacity: 1;
  }
</style>
