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

  type Anchor = { id: string; top: number };
  let anchors = $state<Anchor[]>([]);
  let regenFor = $state<string | null>(null);
  let regenNote = $state('');
  let editFor = $state<string | null>(null);
  let editText = $state('');

  const MIN_GAP = 8; // px between stacked callouts

  function recompute() {
    if (!editorEl) { anchors = []; return; }
    const raw: { id: string; top: number }[] = [];
    for (const p of proposals) {
      if (p.status !== 'pending') continue;
      const el = editorEl.querySelector(`[data-suggestion-id="${p.id}"]`) as HTMLElement | null;
      if (!el) continue;
      const r = el.getBoundingClientRect();
      raw.push({ id: p.id, top: r.top });
    }
    raw.sort((a, b) => a.top - b.top);
    // Naive overlap-resolution: stack downward with MIN_GAP.
    let lastBottom = -Infinity;
    const stacked: Anchor[] = [];
    for (const a of raw) {
      const top = Math.max(a.top, lastBottom + MIN_GAP);
      stacked.push({ id: a.id, top });
      lastBottom = top + 80; // assumed callout height; refined after first paint via re-run on resize
    }
    anchors = stacked;
  }

  $effect(() => {
    // Re-read proposal list to register dependency.
    void proposals.length;
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

  let activeId = $state<string | null>(null);
  let activeTimer: ReturnType<typeof setTimeout> | null = null;

  function setActive(id: string | null, scrollMark: boolean) {
    if (activeTimer) { clearTimeout(activeTimer); activeTimer = null; }
    // Clear previous active mark.
    if (editorEl) {
      editorEl.querySelectorAll('[data-suggestion-id].sg-active').forEach((el) => el.classList.remove('sg-active'));
    }
    activeId = id;
    if (id && editorEl) {
      const el = editorEl.querySelector(`[data-suggestion-id="${id}"]`) as HTMLElement | null;
      if (el) {
        el.classList.add('sg-active');
        if (scrollMark) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
    activeTimer = setTimeout(() => {
      if (editorEl) {
        editorEl.querySelectorAll('[data-suggestion-id].sg-active').forEach((el) => el.classList.remove('sg-active'));
      }
      activeId = null;
    }, 4000);
  }

  function selectCallout(p: ProseProposal) {
    setActive(p.id, true);
  }

  // Listen for clicks on suggestion marks in the editor body and surface
  // the matching callout (scroll into view + active highlight).
  $effect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as { id: string };
      if (!detail?.id) return;
      const calloutEl = document.querySelector(`[data-callout-id="${detail.id}"]`) as HTMLElement | null;
      calloutEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setActive(detail.id, false);
    };
    window.addEventListener('jkai:suggestion-click', handler as EventListener);
    return () => window.removeEventListener('jkai:suggestion-click', handler as EventListener);
  });
</script>

<aside class="margin-layer" aria-label="Pending suggestions">
  {#each proposals.filter((p) => p.status === 'pending') as p (p.id)}
    {@const anchor = anchors.find((a) => a.id === p.id)}
    {#if anchor}
      <div
        class="callout"
        class:active={activeId === p.id}
        data-callout-id={p.id}
        style="top: {anchor.top}px;"
        role="button"
        tabindex="0"
        onclick={() => selectCallout(p)}
        onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && selectCallout(p)}
      >
        <button class="anchor-link" onclick={(e) => { e.stopPropagation(); selectCallout(p); }} aria-label="Scroll to highlighted text">→</button>
        {#if editFor === p.id}
          <textarea class="nm-textarea" rows="3" bind:value={editText} onclick={(e) => e.stopPropagation()}></textarea>
          <div class="acts">
            <button class="nm-save-btn" onclick={(e) => { e.stopPropagation(); submitEdit(p); }}>Save</button>
            <button class="nm-btn-ghost" onclick={(e) => { e.stopPropagation(); editFor = null; editText = ''; }}>Cancel</button>
          </div>
        {:else}
          <p class="suggested">{p.suggested || '(delete)'}</p>
          {#if p.reason}<p class="reason">{p.reason}</p>{/if}
          <div class="acts">
            <button class="nm-save-btn" onclick={(e) => { e.stopPropagation(); onAccept(p); }}>Accept</button>
            <button class="nm-btn-ghost" onclick={(e) => { e.stopPropagation(); onReject(p); }}>Reject</button>
            <button class="nm-link-btn" onclick={(e) => { e.stopPropagation(); editFor = p.id; editText = p.suggested; }}>Edit</button>
            <button class="nm-link-btn" onclick={(e) => { e.stopPropagation(); regenFor = regenFor === p.id ? null : p.id; }}>↻</button>
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
    position: fixed;
    top: 0;
    right: 16px;
    width: 320px;
    pointer-events: none;
    z-index: 70;
    height: 0; /* container has no height itself; callouts position themselves */
  }
  .callout {
    position: fixed;
    right: 16px;
    width: 320px;
    background: var(--bg-card, var(--bg-page, #fff));
    border: 1px solid var(--card-border);
    padding: 0.55rem 0.7rem;
    pointer-events: auto;
    box-shadow: 0 4px 14px rgba(0,0,0,0.12);
    font-size: 0.85rem;
    display: flex; flex-direction: column; gap: 0.4rem;
    cursor: pointer;
    transition: border-color 120ms ease, box-shadow 120ms ease;
  }
  .callout:hover { border-color: rgba(255, 184, 0, 0.7); }
  .callout.active {
    border-color: rgba(255, 184, 0, 1);
    box-shadow: 0 4px 18px rgba(255, 184, 0, 0.35);
  }
  .anchor-link {
    position: absolute; left: -22px; top: 6px;
    width: 18px; height: 18px;
    border: 1px solid var(--card-border);
    background: var(--bg-card, #fff);
    cursor: pointer; padding: 0;
    font-size: 0.7rem; line-height: 1;
    display: flex; align-items: center; justify-content: center;
    color: var(--text-muted);
  }
  .suggested {
    margin: 0; font-weight: 500;
    background: rgba(34, 139, 34, 0.10);
    padding: 0.35rem 0.45rem;
    border-left: 3px solid rgba(34, 139, 34, 0.6);
  }
  .reason { margin: 0; font-size: 0.78rem; color: var(--text-muted); }
  .acts { display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap; }
  .regen-row { display: flex; }
  .regen-row .nm-text-input { width: 100%; }
  @media (max-width: 1100px) {
    .margin-layer, .callout { display: none; }
  }
</style>
