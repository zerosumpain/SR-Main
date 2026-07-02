<script lang="ts">
  interface Link {
    label: string;
    href: string;
    kind?: 'primary' | 'ghost';
  }
  let { links }: { links: Link[] } = $props();
</script>

<nav class="ns" aria-label="Next steps">
  <span class="ns-lab">Next</span>
  {#each links as l}
    <a class="ns-link" class:primary={l.kind === 'primary'} href={l.href}>{l.label} →</a>
  {/each}
</nav>

<style>
  .ns {
    display: flex;
    align-items: center;
    gap: 8px 10px;
    flex-wrap: wrap;
    margin: 26px 0 4px;
    padding-top: 14px;
    border-top: 1px dashed rgba(28, 22, 17, 0.22);
  }
  .ns-lab {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9.5px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: rgba(28, 22, 17, 0.45);
    margin-right: 2px;
  }
  .ns-link {
    font-family: 'DM Sans', sans-serif;
    font-size: 13px;
    font-weight: 500;
    color: var(--ink, #1c1611);
    text-decoration: none;
    padding: 7px 14px;
    border: 1px solid rgba(28, 22, 17, 0.28);
    border-radius: var(--radius-round);
    background: rgba(255, 255, 255, 0.5);
  }
  .ns-link:hover {
    background: rgba(28, 22, 17, 0.07);
  }
  .ns-link.primary {
    background: var(--ink, #1c1611);
    color: var(--paper, #f1ead6);
    border-color: var(--ink, #1c1611);
  }
  .ns-link.primary:hover {
    background: #000;
  }
</style>
