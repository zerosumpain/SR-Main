<script lang="ts">
  import type { MetaProposal } from '$lib/blog/assistant/proposal';

  type Props = {
    proposal: MetaProposal;
    onAccept: (p: MetaProposal) => void;
    onReject: (p: MetaProposal) => void;
    onRegenerate: (p: MetaProposal, note: string) => void;
  };
  let { proposal, onAccept, onReject, onRegenerate }: Props = $props();

  let regenerating = $state(false);
  let regenNote = $state('');

  function fmt(v: unknown): string {
    if (Array.isArray(v)) return v.join(', ');
    if (v == null) return '(none)';
    return String(v);
  }

  function submitRegen() {
    if (!regenNote.trim()) return;
    onRegenerate(proposal, regenNote.trim());
    regenerating = false;
    regenNote = '';
  }
</script>

<div class="chip" class:resolved={proposal.status !== 'pending'}>
  <div class="row">
    <span class="field">{proposal.field}</span>
    <span class="arrow">→</span>
    <span class="value" title={fmt(proposal.suggestedValue)}>{fmt(proposal.suggestedValue)}</span>
  </div>
  {#if proposal.reason}
    <p class="reason">{proposal.reason}</p>
  {/if}
  {#if proposal.status === 'pending'}
    <div class="actions">
      <button class="nm-save-btn" onclick={() => onAccept(proposal)}>Accept</button>
      <button class="nm-btn-ghost" onclick={() => onReject(proposal)}>Reject</button>
      <button class="nm-link-btn" onclick={() => (regenerating = !regenerating)}>↻</button>
    </div>
    {#if regenerating}
      <div class="regen-row">
        <input
          class="nm-text-input"
          placeholder="ask for another version…"
          bind:value={regenNote}
          onkeydown={(e) => e.key === 'Enter' && submitRegen()}
        />
        <button class="nm-btn-ghost" onclick={submitRegen} disabled={!regenNote.trim()}>Send</button>
      </div>
    {/if}
  {:else}
    <span class="status">{proposal.status}</span>
  {/if}
</div>

<style>
  .chip {
    border: 1px solid var(--line-strong);
    background: var(--surface-sunken);
    padding: 0.45rem 0.6rem;
    font-size: 0.85rem;
    display: flex; flex-direction: column; gap: 0.35rem;
  }
  .chip.resolved { opacity: 0.6; }
  .row { display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap; }
  .field { font-family: var(--font-mono); font-size: 0.78rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
  .arrow { color: var(--text-ghost); }
  .value { font-weight: 500; word-break: break-word; max-width: 100%; }
  .reason { font-size: 0.78rem; color: var(--text-muted); margin: 0; }
  .actions { display: flex; gap: 0.4rem; align-items: center; }
  .regen-row { display: flex; gap: 0.4rem; }
  .regen-row .nm-text-input { flex: 1; }
  .status { font-size: 0.75rem; color: var(--text-ghost); text-transform: uppercase; letter-spacing: 0.05em; }
</style>
