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
  // Computed each recompute so callouts anchor to the article's right edge,
  // not the viewport's right edge.
  let calloutLeft = $state<number>(16);
  let calloutWidth = $state<number>(320);
  let regenFor = $state<string | null>(null);
  let regenNote = $state('');
  let editFor = $state<string | null>(null);
  let editText = $state('');

  const MIN_GAP = 8; // px between stacked callouts
  const SIDE_GAP = 16; // px between editor's right edge and the callouts column
  const PREFERRED_WIDTH = 320;
  const MIN_WIDTH = 220;
  const NARROW_BREAKPOINT = 1100; // below this we drop the margin column for a drawer

  // Narrow-viewport drawer: when there's no room for a margin column, a
  // pinned bottom-right pill exposes the suggestions in an expandable list.
  let narrow = $state<boolean>(typeof window !== 'undefined' ? window.innerWidth < NARROW_BREAKPOINT : false);
  let drawerOpen = $state<boolean>(false);

  function recompute() {
    if (!editorEl) { anchors = []; return; }
    narrow = window.innerWidth < NARROW_BREAKPOINT;
    if (narrow) {
      // Drawer mode — no per-suggestion screen anchoring needed.
      anchors = [];
      return;
    }
    // Callouts column position — anchor to the editor's right edge so the
    // suggestion cards sit beside the article rather than out at the
    // viewport edge.
    const editorRect = editorEl.getBoundingClientRect();
    const available = window.innerWidth - editorRect.right - SIDE_GAP - 8;
    calloutWidth = Math.max(MIN_WIDTH, Math.min(PREFERRED_WIDTH, available));
    calloutLeft = editorRect.right + SIDE_GAP;

    const raw: { id: string; top: number }[] = [];
    for (const p of proposals) {
      if (p.status !== 'pending') continue;
      const el = editorEl.querySelector(`[data-suggestion-id="${p.id}"]`) as HTMLElement | null;
      if (!el) continue;
      const r = el.getBoundingClientRect();
      raw.push({ id: p.id, top: r.top });
    }
    raw.sort((a, b) => a.top - b.top);
    // Stack downward, using each callout's real rendered height when we can
    // measure it; fall back to a conservative default for newly-spawned ones.
    let lastBottom = -Infinity;
    const stacked: Anchor[] = [];
    for (const a of raw) {
      const top = Math.max(a.top, lastBottom + MIN_GAP);
      stacked.push({ id: a.id, top });
      const calloutEl = document.querySelector(`[data-callout-id="${a.id}"]`) as HTMLElement | null;
      const measured = calloutEl?.offsetHeight ?? 0;
      lastBottom = top + (measured > 0 ? measured : 100);
    }
    anchors = stacked;
  }

  $effect(() => {
    // Re-read proposal list to register dependency.
    void proposals.length;
    recompute();
    // Re-run on next frame so we can read each callout's actual measured
    // height (which only exists after the first paint with the initial
    // estimated tops).
    const raf = requestAnimationFrame(() => recompute());
    const handler = () => recompute();
    window.addEventListener('resize', handler);
    window.addEventListener('scroll', handler, true);
    return () => {
      cancelAnimationFrame(raf);
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

{#snippet cardBody(p: ProseProposal)}
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
{/snippet}

{#if narrow}
  {@const pending = proposals.filter((p) => p.status === 'pending')}
  {#if pending.length > 0}
    <div class="drawer" class:open={drawerOpen} aria-label="Pending suggestions">
      <button class="drawer-toggle" onclick={() => (drawerOpen = !drawerOpen)} aria-expanded={drawerOpen}>
        Suggestions ({pending.length}) <span class="caret">{drawerOpen ? '▾' : '▴'}</span>
      </button>
      {#if drawerOpen}
        <div class="drawer-body">
          {#each pending as p (p.id)}
            <div
              class="callout drawer-callout"
              class:active={activeId === p.id}
              data-callout-id={p.id}
              role="button"
              tabindex="0"
              onclick={() => selectCallout(p)}
              onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && selectCallout(p)}
            >
              {@render cardBody(p)}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
{:else}
  <aside class="margin-layer" aria-label="Pending suggestions">
    {#each proposals.filter((p) => p.status === 'pending') as p (p.id)}
      {@const anchor = anchors.find((a) => a.id === p.id)}
      {#if anchor}
        <div
          class="callout"
          class:active={activeId === p.id}
          data-callout-id={p.id}
          style="top: {anchor.top}px; left: {calloutLeft}px; width: {calloutWidth}px;"
          role="button"
          tabindex="0"
          onclick={() => selectCallout(p)}
          onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && selectCallout(p)}
        >
          <button class="anchor-link" onclick={(e) => { e.stopPropagation(); selectCallout(p); }} aria-label="Scroll to highlighted text">→</button>
          {@render cardBody(p)}
        </div>
      {/if}
    {/each}
  </aside>
{/if}

<style>
  .margin-layer {
    position: fixed;
    inset: 0 0 auto 0;
    pointer-events: none;
    z-index: 70;
    height: 0; /* container has no height itself; callouts position themselves */
  }
  .callout {
    position: fixed;
    /* `left` and `width` are set inline at recompute time so callouts anchor
       beside the article body rather than at the viewport's right edge. */
    background: var(--bg-card, var(--bg-page, #fff));
    border: 1px solid var(--card-border);
    padding: 0.55rem 0.7rem;
    pointer-events: auto;
    box-shadow: 0 4px 14px rgba(0,0,0,0.12);
    font-size: 0.85rem;
    display: flex; flex-direction: column; gap: 0.4rem;
    cursor: pointer;
    transition: border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease;
    z-index: 1;
  }
  .callout:hover {
    border-color: rgba(255, 184, 0, 0.7);
    z-index: 5;
  }
  .callout.active {
    border-color: rgba(255, 184, 0, 1);
    box-shadow: 0 6px 24px rgba(255, 184, 0, 0.45), 0 4px 14px rgba(0, 0, 0, 0.18);
    /* Lift the selected callout above all neighbours so action buttons are
       never hidden behind a stacked card below it. */
    z-index: 50;
    transform: translateY(-1px);
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

  /* --- Narrow-viewport drawer --- */
  .drawer {
    position: fixed; bottom: 16px; right: 16px;
    z-index: 60; /* below the chat widget (z 80) */
    display: flex; flex-direction: column-reverse; align-items: flex-end;
    gap: 8px;
    pointer-events: auto;
  }
  .drawer-toggle {
    border: 1px solid var(--card-border);
    background: var(--bg-card, #fff);
    color: var(--text-primary);
    font-family: var(--font-mono);
    font-size: 0.78rem;
    padding: 0.4rem 0.7rem;
    box-shadow: 0 4px 14px rgba(0,0,0,0.12);
    cursor: pointer;
    display: inline-flex; align-items: center; gap: 0.4rem;
  }
  .drawer-toggle .caret { color: var(--text-muted); font-size: 0.85rem; }
  .drawer.open .drawer-toggle { border-color: rgba(255, 184, 0, 0.7); }
  .drawer-body {
    width: min(360px, calc(100vw - 32px));
    max-height: 60vh;
    overflow-y: auto;
    background: var(--bg-card, #fff);
    border: 1px solid var(--card-border);
    box-shadow: 0 6px 24px rgba(0,0,0,0.18);
    padding: 0.6rem;
    display: flex; flex-direction: column; gap: 0.5rem;
  }
  .drawer-callout {
    /* Override .callout's position:fixed inside the drawer flow. */
    position: static !important;
    width: auto !important;
    left: auto !important;
    top: auto !important;
  }
</style>
