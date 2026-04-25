<script lang="ts">
  import type { Snippet } from 'svelte';
  import EvidenceChip from './EvidenceChip.svelte';

  let {
    name,
    evidenceId,
    onopenDetail,
    onopenEvidence,
    insufficient = false,
    value,
    status,
    statusTone = 'neutral',
    bar,
  }: {
    name: string;
    evidenceId: string;
    onopenDetail?: () => void;
    onopenEvidence?: (id: string) => void;
    insufficient?: boolean;
    value?: Snippet;
    status?: Snippet;
    statusTone?: 'good' | 'warn' | 'bad' | 'neutral';
    bar?: Snippet;
  } = $props();

  function activate() {
    if (!insufficient) onopenDetail?.();
  }
</script>

<div
  class="mrow"
  class:mrow-disabled={insufficient}
  role={onopenDetail && !insufficient ? 'button' : undefined}
  tabindex={onopenDetail && !insufficient ? 0 : undefined}
  onclick={activate}
  onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } }}
>
  <div class="mrow-name">
    <span class="mrow-label">{name}</span>
    <EvidenceChip id={evidenceId} onopen={(ev) => { event?.stopPropagation?.(); onopenEvidence?.(ev); }} />
  </div>

  <div class="mrow-value">
    {#if insufficient}
      <span class="mrow-dim">—</span>
    {:else if value}
      {@render value()}
    {/if}
  </div>

  <div class="mrow-status mrow-{statusTone}">
    {#if insufficient}
      <span class="mrow-insufficient">insufficient data</span>
    {:else if status}
      {@render status()}
    {/if}
  </div>

  <div class="mrow-bar">
    {#if !insufficient && bar}{@render bar()}{/if}
  </div>

  <span class="mrow-arrow" aria-hidden="true">{insufficient ? '' : '›'}</span>
</div>

<style>
  .mrow {
    display: grid;
    grid-template-columns: minmax(0, 1.6fr) minmax(60px, auto) minmax(0, 1fr) minmax(120px, 1.4fr) auto;
    align-items: center;
    gap: 0.85rem;
    padding: 0.55rem 0.6rem 0.55rem 0.4rem;
    border-bottom: 1px solid var(--divider);
    cursor: pointer;
    transition: background 80ms ease;
  }
  .mrow:last-child { border-bottom: 0; }
  .mrow:hover:not(.mrow-disabled) { background: var(--surface-overlay); }
  .mrow:focus-visible { outline: 1px solid var(--accent); outline-offset: -1px; background: var(--surface-overlay); }
  .mrow-disabled { cursor: default; }

  .mrow-name {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
  }
  .mrow-label {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mrow-value {
    font-family: var(--font-mono);
    font-size: 16px;
    color: var(--text-primary);
    text-align: right;
    line-height: 1;
    min-width: 0;
    white-space: nowrap;
  }
  .mrow-dim { color: var(--text-ghost); }

  .mrow-status {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-muted);
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .mrow-good   { color: var(--accent); }
  .mrow-warn   { color: var(--text-secondary); }
  .mrow-bad    { color: var(--status-error); }
  .mrow-neutral { color: var(--text-muted); }
  .mrow-insufficient { font-style: italic; text-transform: none; letter-spacing: 0; color: var(--text-ghost); }

  .mrow-bar { min-width: 0; }
  .mrow-arrow {
    font-family: var(--font-mono);
    font-size: 14px;
    color: var(--text-ghost);
    line-height: 1;
  }
  .mrow:hover:not(.mrow-disabled) .mrow-arrow { color: var(--accent); }

  @media (max-width: 640px) {
    .mrow { grid-template-columns: minmax(0, 1fr) auto auto; row-gap: 4px; }
    .mrow-status { grid-column: 1 / 2; font-size: 9px; }
    .mrow-bar { grid-column: 1 / -1; }
    .mrow-arrow { grid-row: 1; }
  }
</style>
