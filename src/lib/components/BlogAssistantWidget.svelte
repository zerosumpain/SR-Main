<script lang="ts">
  import type { Proposal, MetaProposal, ProseProposal } from '$lib/blog/assistant/proposal';
  import BlogAssistantSuggestionChip from './BlogAssistantSuggestionChip.svelte';

  type ChatRow = { role: 'user' | 'assistant'; content: string };

  type Props = {
    postId: number;
    adminToken: string;
    history: { role: string; content: string }[];
    proposalStore: import('$lib/blog/assistant/proposal-store').ProposalStore;
    displayMode: 'inline' | 'margin';
    onSetDisplayMode: (m: 'inline' | 'margin') => void;
    onProposalArrived: (p: Proposal) => void;
    onAcceptMeta: (p: MetaProposal) => Promise<void>;
    onRejectMeta: (p: MetaProposal) => void;
    onRegenerate: (p: Proposal, note: string) => void;
    onClear?: () => void;
    sendMessage?: (text: string) => Promise<void>;
  };

  let {
    postId, adminToken, history, proposalStore,
    displayMode, onSetDisplayMode,
    onProposalArrived, onAcceptMeta, onRejectMeta, onRegenerate,
    onClear,
    sendMessage = $bindable(),
  }: Props = $props();

  let open = $state(true);
  let busy = $state(false);
  let input = $state('');
  let abortCtl: AbortController | null = null;

  let chatRows = $state<ChatRow[]>(
    history
      .filter((r) => r.role === 'user' || r.role === 'assistant')
      .map((r) => ({ role: r.role as 'user' | 'assistant', content: r.content }))
  );
  // proposalStore is a plain Map — not $state-tracked. Bump this counter
  // whenever the store mutates so Svelte re-derives metaProposals.
  let proposalsTick = $state(0);
  let metaProposals = $derived.by(() => {
    proposalsTick;
    return proposalStore.list().filter((p): p is MetaProposal => p.kind === 'meta');
  });

  // Pos.x = px from LEFT edge of viewport, Pos.y = px from BOTTOM.
  // Default anchor: bottom-LEFT, so the widget doesn't collide with margin
  // callouts on the right.
  type Pos = { x: number; y: number };
  const POS_KEY = 'blog-assistant-widget-pos-v2';
  let pos = $state<Pos>(loadPos());
  function loadPos(): Pos {
    if (typeof localStorage === 'undefined') return { x: 16, y: 16 };
    try { return JSON.parse(localStorage.getItem(POS_KEY) ?? '{"x":16,"y":16}'); } catch { return { x: 16, y: 16 }; }
  }
  function savePos() { try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch { /* ignore */ } }

  let dragging = false;
  let dragStart: { x: number; y: number; px: number; py: number } | null = null;
  function startDrag(e: PointerEvent) {
    dragging = true;
    dragStart = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onDrag(e: PointerEvent) {
    if (!dragging || !dragStart) return;
    pos = {
      // dragging right (positive deltaX) increases left offset
      x: Math.max(8, dragStart.px + (e.clientX - dragStart.x)),
      // dragging up (negative deltaY) increases bottom offset
      y: Math.max(8, dragStart.py - (e.clientY - dragStart.y)),
    };
  }
  function endDrag(e: PointerEvent) {
    dragging = false; dragStart = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    savePos();
  }

  // Expose sendMessage for parent (page) to invoke programmatically (e.g. regenerate).
  sendMessage = async (text: string) => {
    input = text;
    await send();
  };

  async function send() {
    if (!input.trim() || busy) return;
    const message = input.trim();
    input = '';
    busy = true;
    chatRows = [...chatRows, { role: 'user', content: message }];
    let assistantBuf = '';
    let assistantIdx = -1;

    abortCtl = new AbortController();
    try {
      const res = await fetch(`/api/admin/blog/${postId}/assistant?token=${adminToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
        signal: abortCtl.signal,
      });
      if (!res.ok || !res.body) {
        chatRows = [...chatRows, { role: 'assistant', content: `Error: ${res.status}` }];
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const ev = JSON.parse(line.slice(6));
          if (ev.type === 'text') {
            assistantBuf += ev.delta;
            if (assistantIdx === -1) {
              chatRows = [...chatRows, { role: 'assistant', content: assistantBuf }];
              assistantIdx = chatRows.length - 1;
            } else {
              chatRows[assistantIdx] = { role: 'assistant', content: assistantBuf };
              chatRows = chatRows;
            }
          } else if (ev.type === 'proposal') {
            const p = ev.proposal as Proposal;
            if (p.replaces) proposalStore.replace(p.replaces, p);
            else proposalStore.add(p);
            proposalsTick++;
            onProposalArrived(p);
          } else if (ev.type === 'error') {
            chatRows = [...chatRows, { role: 'assistant', content: `Error: ${ev.message}` }];
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        chatRows = [...chatRows, { role: 'assistant', content: `Error: ${(e as Error).message}` }];
      }
    } finally {
      busy = false;
      abortCtl = null;
    }
  }

  function cancel() {
    abortCtl?.abort();
    busy = false;
  }

  async function clearChat() {
    if (!confirm('Clear the chat history and all pending proposals for this post?')) return;
    try {
      await fetch(`/api/admin/blog/${postId}/assistant/clear?token=${adminToken}`, { method: 'POST' });
    } catch { /* still clear locally */ }
    chatRows = [];
    proposalStore.clear();
    proposalsTick++;
    onClear?.();
  }

  function onKeydown(ev: KeyboardEvent) {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      send();
    }
  }

  function handleAcceptMeta(p: MetaProposal) {
    onAcceptMeta(p);
  }
</script>

{#if !open}
  <button
    class="fab"
    style="left: {pos.x}px; bottom: {pos.y}px;"
    onclick={() => (open = true)}
    aria-label="Open jkai"
  >🪶</button>
{:else}
  <section class="widget" style="left: {pos.x}px; bottom: {pos.y}px;" role="region" aria-label="jkai blog assistant">
    <header class="bar">
      <span
        class="title"
        onpointerdown={startDrag}
        onpointermove={onDrag}
        onpointerup={endDrag}
        onpointercancel={endDrag}
      >&gt;jkai</span>
      <span class="mode">
        <button type="button" class:active={displayMode === 'inline'} onclick={() => onSetDisplayMode('inline')}>inline</button>
        <button type="button" class:active={displayMode === 'margin'} onclick={() => onSetDisplayMode('margin')}>margin</button>
      </span>
      <button type="button" class="clear" onclick={clearChat} aria-label="Clear chat" title="Clear chat history and proposals">Clear</button>
      <button type="button" class="close" onclick={() => (open = false)} aria-label="Minimise">–</button>
    </header>

    <div class="body">
      {#each chatRows as row, i (i)}
        <div class="row {row.role}"><span class="bubble">{row.content}</span></div>
      {/each}
      {#each metaProposals as p (p.id)}
        <BlogAssistantSuggestionChip
          proposal={p}
          onAccept={handleAcceptMeta}
          onReject={onRejectMeta}
          onRegenerate={(prop, note) => onRegenerate(prop, note)}
        />
      {/each}
      {#if chatRows.length === 0 && metaProposals.length === 0}
        <p class="empty">Ask jkai to rewrite, retitle, retag, publish, etc.</p>
      {/if}
    </div>

    <footer class="composer">
      <textarea class="nm-textarea" rows="2" bind:value={input} onkeydown={onKeydown} disabled={busy}
        placeholder="Ask jkai…"></textarea>
      {#if busy}
        <button class="nm-btn-ghost" onclick={cancel}>Stop</button>
      {:else}
        <button class="nm-save-btn" onclick={send} disabled={!input.trim()}>Send</button>
      {/if}
    </footer>
  </section>
{/if}

<style>
  .fab {
    position: fixed; z-index: 80; width: 44px; height: 44px;
    border-radius: 50%; border: 1px solid var(--card-border);
    background: var(--bg-section); cursor: pointer; font-size: 1.2rem;
    box-shadow: 0 4px 10px rgba(0,0,0,0.08);
  }
  .widget {
    position: fixed; z-index: 80;
    width: 360px; height: 580px;
    background: var(--bg-card, var(--bg-page, #fff));
    border: 1px solid var(--card-border);
    box-shadow: 0 6px 24px rgba(0,0,0,0.18);
    display: flex; flex-direction: column;
  }
  .bar {
    display: flex; align-items: center; gap: 0.6rem;
    padding: 0.4rem 0.6rem;
    border-bottom: 1px solid var(--card-border);
    user-select: none;
  }
  .title {
    font-family: var(--font-mono); font-size: 0.9rem;
    cursor: grab; padding: 0.1rem 0.2rem;
  }
  .title:active { cursor: grabbing; }
  .mode { display: flex; gap: 0.25rem; margin-left: auto; }
  .mode button {
    border: 1px solid var(--card-border); background: transparent;
    padding: 0.1rem 0.4rem; font-size: 0.7rem; cursor: pointer;
  }
  .mode button.active { background: var(--accent-tint-08); }
  .clear {
    border: 1px solid var(--card-border); background: transparent;
    padding: 0.1rem 0.4rem; font-size: 0.7rem; cursor: pointer;
    color: var(--text-muted);
  }
  .clear:hover { color: var(--danger, #c33); border-color: var(--danger, #c33); }
  .close { border: 0; background: transparent; font-size: 1.2rem; cursor: pointer; padding: 0 0.3rem; }
  .body {
    flex: 1; overflow-y: auto; padding: 0.6rem;
    display: flex; flex-direction: column; gap: 0.5rem;
  }
  .row { display: flex; }
  .row.user { justify-content: flex-end; }
  .bubble {
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--card-border);
    background: var(--bg-section);
    font-size: 0.86rem; max-width: 85%;
    white-space: pre-wrap;
  }
  .row.user .bubble { background: var(--accent-tint-08); }
  .empty { font-size: 0.85rem; color: var(--text-muted); margin: 0; }
  .composer { display: flex; gap: 0.4rem; padding: 0.4rem; border-top: 1px solid var(--card-border); }
  .composer .nm-textarea { flex: 1; }
</style>
