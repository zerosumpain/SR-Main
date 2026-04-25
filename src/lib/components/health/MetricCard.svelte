<script lang="ts">
  import type { Snippet } from 'svelte';
  import EvidenceChip from './EvidenceChip.svelte';

  let {
    label,
    evidenceId,
    onopenDetail,
    onopenEvidence,
    children,
    insufficient = false,
  }: {
    label: string;
    evidenceId: string;
    onopenDetail?: () => void;
    onopenEvidence?: (id: string) => void;
    children: Snippet;
    insufficient?: boolean;
  } = $props();
</script>

<section class="nm-sec mc">
  <div class="nm-sec-hd mc-hd">
    <span class="sr-label-tight">{label}</span>
    <EvidenceChip id={evidenceId} onopen={onopenEvidence} />
    {#if onopenDetail && !insufficient}
      <button type="button" class="row-link mc-detail" onclick={onopenDetail}>Detail</button>
    {/if}
  </div>
  <div class="mc-body">
    {#if insufficient}
      <p class="mc-insufficient">Insufficient data — needs more history to compute.</p>
    {:else}
      {@render children()}
    {/if}
  </div>
</section>

<style>
  .mc-hd { gap: 0.5rem; }
  .mc-detail { margin-left: auto; }
  .mc-body { display: flex; flex-direction: column; gap: 0.6rem; }
  .mc-insufficient {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-ghost);
    font-style: italic;
    margin: 0;
  }
  /* row-link is canonical from /admin/files; redefine here so this component
   * is self-contained when used outside /health. */
  .row-link {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--accent);
    background: none;
    border: 0;
    padding: 0;
    cursor: pointer;
  }
  .row-link:hover { color: var(--accent-hover); text-decoration: underline; }
</style>
