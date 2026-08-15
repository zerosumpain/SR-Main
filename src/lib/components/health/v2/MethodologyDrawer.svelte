<script lang="ts">
  import EvidencePanel from '$lib/components/health/EvidencePanel.svelte';

  let {
    open,
    focusId = null,
    onclose,
  }: { open: boolean; focusId: string | null; onclose: () => void } = $props();

  function onkeydown(e: KeyboardEvent) {
    if (open && e.key === 'Escape') onclose();
  }
</script>

<svelte:window {onkeydown} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="md-backdrop" onclick={onclose}>
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="md-panel" role="dialog" aria-modal="true" onclick={(e) => e.stopPropagation()}>
      <div class="md-head">
        <span class="md-kicker">METHODOLOGY · HOW THESE ARE COMPUTED</span>
        <button type="button" class="md-close" onclick={onclose}>CLOSE ✕</button>
      </div>
      <div class="md-body">
        {#key focusId}
          <EvidencePanel {focusId} />
        {/key}
      </div>
    </div>
  </div>
{/if}

<style>
  .md-backdrop {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: rgba(26, 16, 8, 0.55);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding: 6vh 20px;
    animation: md-fade 140ms ease;
  }
  .md-panel {
    width: 100%;
    max-width: 720px;
    max-height: 84vh;
    overflow: auto;
    background: var(--bg);
    border: 2px solid var(--line-strong);
    padding: 22px 22px 24px;
  }
  .md-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding-bottom: 14px;
    margin-bottom: 16px;
    border-bottom: 1px solid var(--line-hair);
  }
  .md-kicker {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .md-close {
    flex-shrink: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.15em;
    text-transform: uppercase;
    padding: 3px 8px;
    background: var(--surface-sunken);
    border: 1px solid var(--line-strong);
    color: var(--text-muted);
    cursor: pointer;
    transition:
      border-color 80ms ease,
      color 80ms ease;
  }
  .md-close:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .md-body {
    min-width: 0;
  }

  @keyframes md-fade {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .md-backdrop {
      animation: none;
    }
  }
</style>
