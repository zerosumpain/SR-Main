<script lang="ts">
  import type { ProseProposal } from '$lib/blog/assistant/proposal';

  type Props = {
    proposals: ProseProposal[];
    editorEl?: HTMLElement;
    onAccept: (p: ProseProposal, modifiedText?: string) => void;
    onReject: (p: ProseProposal) => void;
    onRegenerate: (p: ProseProposal, note: string) => void;
  };
  let { proposals, editorEl, onAccept, onReject, onRegenerate }: Props = $props();

  type Anchor = { id: string; top: number; height: number };
  let anchors = $state<Anchor[]>([]);
  let regenFor = $state<string | null>(null);
  let regenNote = $state('');
  let editFor = $state<string | null>(null);
  let editText = $state('');

  function recompute() {
    if (!editorEl) { anchors = []; return; }
    const containerRect = editorEl.getBoundingClientRect();
    const next: Anchor[] = [];
    for (const p of proposals) {
      if (p.status !== 'pending') continue;
      const el = editorEl.querySelector(`[data-suggestion-id="${p.id}"]`) as HTMLElement | null;
      if (!el) continue;
      const r = el.getBoundingClientRect();
      next.push({ id: p.id, top: r.top - containerRect.top, height: r.height });
    }
    anchors = next;
  }

  $effect(() => {
    // re-run whenever proposals change OR window resizes
    recompute();
    const handler = () => recompute();
    window.addEventListener('resize', handler);
    window.addEventListener('scroll', handler, true);
    return () => {
      window.removeEventListener('resize', handler);
      window.removeEventListener('scroll', handler, true);
    };
  });

  function submitEdit(p: ProseProposal) {
    onAccept(p, editText);
    editFor = null;
    editText = '';
  }

  function submitRegen(p: ProseProposal) {
    if (!regenNote.trim()) return;
    onRegenerate(p, regenNote.trim());
    regenFor = null;
    regenNote = '';
  }
</script>

<aside class="margin-layer" aria-label="Pending suggestions">
  {#each proposals.filter((p) => p.status === 'pending') as p (p.id)}
    {@const anchor = anchors.find((a) => a.id === p.id)}
    {#if anchor}
      <div class="callout" style="top: {anchor.top}px;">
        {#if editFor === p.id}
          <textarea class="nm-textarea" rows="3" bind:value={editText}></textarea>
          <div class="acts">
            <button class="nm-save-btn" onclick={() => submitEdit(p)}>Save</button>
            <button class="nm-btn-ghost" onclick={() => { editFor = null; editText = ''; }}>Cancel</button>
          </div>
        {:else}
          <p class="suggested">{p.suggested || '(delete)'}</p>
          {#if p.reason}<p class="reason">{p.reason}</p>{/if}
          <div class="acts">
            <button class="nm-save-btn" onclick={() => onAccept(p)}>Accept</button>
            <button class="nm-btn-ghost" onclick={() => onReject(p)}>Reject</button>
            <button class="nm-link-btn" onclick={() => { editFor = p.id; editText = p.suggested; }}>Edit</button>
            <button class="nm-link-btn" onclick={() => (regenFor = regenFor === p.id ? null : p.id)}>↻</button>
          </div>
          {#if regenFor === p.id}
            <div class="regen-row">
              <input class="nm-text-input" placeholder="ask for another version…"
                bind:value={regenNote}
                onkeydown={(e) => e.key === 'Enter' && submitRegen(p)} />
            </div>
          {/if}
        {/if}
      </div>
    {/if}
  {/each}
</aside>

<style>
  .margin-layer {
    position: absolute;
    top: 0;
    right: -340px;
    width: 320px;
    pointer-events: none;
  }
  .callout {
    position: absolute;
    width: 100%;
    background: var(--bg-section);
    border: 1px solid var(--card-border);
    padding: 0.5rem 0.6rem;
    pointer-events: auto;
    box-shadow: 0 2px 6px rgba(0,0,0,0.06);
    font-size: 0.85rem;
    display: flex; flex-direction: column; gap: 0.35rem;
  }
  .suggested { margin: 0; font-weight: 500; }
  .reason { margin: 0; font-size: 0.78rem; color: var(--text-muted); }
  .acts { display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap; }
  .regen-row { display: flex; }
  .regen-row .nm-text-input { width: 100%; }
  @media (max-width: 1100px) {
    .margin-layer { display: none; }
  }
</style>
