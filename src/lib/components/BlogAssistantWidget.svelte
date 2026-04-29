<script lang="ts">
  import type { Proposal, MetaProposal, ProseProposal } from '$lib/blog/assistant/proposal';
  import BlogAssistantSuggestionChip from './BlogAssistantSuggestionChip.svelte';

  type ChatRow =
    | { role: 'user' | 'assistant'; content: string }
    | { role: 'status'; content: string; transient?: boolean };

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

  // Revision history (rollback)
  type Revision = { id: number; field: string; previousValue: string; reason: string | null; createdAt: string; proposalId: string | null };
  let historyOpen = $state(false);
  let revisions = $state<Revision[]>([]);
  let loadingRevisions = $state(false);

  async function loadRevisions() {
    loadingRevisions = true;
    try {
      const r = await fetch(`/api/admin/blog/${postId}/revisions?token=${adminToken}`);
      if (r.ok) {
        const body = await r.json();
        revisions = body.revisions ?? [];
      }
    } finally {
      loadingRevisions = false;
    }
  }

  $effect(() => {
    const onChanged = () => { if (historyOpen) loadRevisions(); };
    window.addEventListener('jkai:revisions-changed', onChanged);
    return () => window.removeEventListener('jkai:revisions-changed', onChanged);
  });

  async function rollback(rev: Revision) {
    if (!confirm(`Roll back this ${rev.field} change?`)) return;
    const r = await fetch(`/api/admin/blog/${postId}/revisions/${rev.id}/rollback?token=${adminToken}`, { method: 'POST' });
    if (!r.ok) { appendStatus('✗ Rollback failed.'); return; }
    appendStatus(`↶ Rolled back ${rev.field}.`);
    // Notify the page so it refreshes its state from the returned post.
    const body = await r.json().catch(() => ({}));
    if (body?.post) {
      window.dispatchEvent(new CustomEvent('jkai:post-rolled-back', { detail: { post: body.post } }));
    }
    await loadRevisions();
  }

  function fmtRevValue(rev: Revision): string {
    if (rev.field === 'content') {
      const text = rev.previousValue.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      return text.length > 80 ? `${text.slice(0, 80)}…` : text;
    }
    if (rev.field === 'tags') {
      try { return (JSON.parse(rev.previousValue) as string[]).join(', '); } catch { return rev.previousValue; }
    }
    return rev.previousValue.length > 80 ? `${rev.previousValue.slice(0, 80)}…` : rev.previousValue;
  }

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

  function appendStatus(content: string, transient = false) {
    chatRows = [...chatRows, { role: 'status', content, transient }];
  }
  function clearTransientStatus() {
    chatRows = chatRows.filter((r) => !(r.role === 'status' && r.transient));
  }

  function shortLabel(p: Proposal): string {
    if (p.kind === 'meta') {
      const v = Array.isArray(p.suggestedValue) ? p.suggestedValue.join(', ') : String(p.suggestedValue ?? '');
      return `${p.field} → ${v.slice(0, 40)}${v.length > 40 ? '…' : ''}`;
    }
    const orig = (p.original ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    return orig.length > 40 ? `"${orig.slice(0, 40)}…"` : `"${orig}"`;
  }

  async function send() {
    if (!input.trim() || busy) return;
    const message = input.trim();
    input = '';
    busy = true;
    chatRows = [...chatRows, { role: 'user', content: message }];
    appendStatus('Reviewing post…', true);

    let assistantBuf = '';
    let assistantIdx = -1;
    let proposalsThisRun = 0;
    let firstEventArrived = false;

    abortCtl = new AbortController();
    try {
      const res = await fetch(`/api/admin/blog/${postId}/assistant?token=${adminToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
        signal: abortCtl.signal,
      });
      if (!res.ok || !res.body) {
        clearTransientStatus();
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
          if (!firstEventArrived) {
            firstEventArrived = true;
            clearTransientStatus();
          }
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
            proposalsThisRun++;
            // Brief progress note so the user sees suggestions land one by one.
            appendStatus(`Suggestion ${proposalsThisRun}: ${shortLabel(p)}`);
            onProposalArrived(p);
          } else if (ev.type === 'error') {
            chatRows = [...chatRows, { role: 'assistant', content: `Error: ${ev.message}` }];
          }
        }
      }

      // Stream finished. Summarise what happened.
      clearTransientStatus();
      if (proposalsThisRun > 0) {
        appendStatus(`✓ Done — ${proposalsThisRun} suggestion${proposalsThisRun === 1 ? '' : 's'} ready. Accept, reject, or modify each in the editor.`);
      } else if (assistantBuf.trim().length > 0) {
        // The assistant answered in text; no extra summary needed.
      } else {
        appendStatus('✓ Nothing to suggest — the post reads well as-is.');
      }
    } catch (e) {
      clearTransientStatus();
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
      <button type="button" class="hist" class:active={historyOpen}
        onclick={() => { historyOpen = !historyOpen; if (historyOpen) loadRevisions(); }}
        aria-label="History" title="Recent LLM changes (rollback)">↶</button>
      <button type="button" class="clear" onclick={clearChat} aria-label="Clear chat" title="Clear chat history and proposals">Clear</button>
      <button type="button" class="close" onclick={() => (open = false)} aria-label="Minimise">–</button>
    </header>

    {#if historyOpen}
      <div class="history-panel">
        <div class="hist-hd">
          <span>Recent LLM changes</span>
          {#if loadingRevisions}<span class="muted">loading…</span>{/if}
        </div>
        {#if revisions.length === 0 && !loadingRevisions}
          <p class="empty">No changes captured yet.</p>
        {:else}
          <ul class="hist-list">
            {#each revisions as rev (rev.id)}
              <li class="hist-row">
                <div class="hist-row-main">
                  <span class="hist-field">{rev.field}</span>
                  <span class="hist-prev" title={rev.previousValue}>{fmtRevValue(rev)}</span>
                </div>
                <button class="nm-btn-ghost" onclick={() => rollback(rev)}>Roll back</button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}

    <div class="body">
      {#each chatRows as row, i (i)}
        {#if row.role === 'status'}
          <div class="row status">
            {#if row.transient}<span class="dots" aria-hidden="true"></span>{/if}
            <span class="status-text">{row.content}</span>
          </div>
        {:else}
          <div class="row {row.role}"><span class="bubble">{row.content}</span></div>
        {/if}
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
  .hist {
    border: 1px solid var(--card-border); background: transparent;
    padding: 0.1rem 0.45rem; font-size: 0.85rem; cursor: pointer;
    color: var(--text-muted);
  }
  .hist.active { background: var(--accent-tint-08); color: var(--text-primary); }
  .history-panel {
    border-bottom: 1px solid var(--card-border);
    padding: 0.5rem 0.6rem;
    font-size: 0.8rem;
    max-height: 220px; overflow-y: auto;
    background: var(--bg-section, transparent);
  }
  .hist-hd {
    display: flex; justify-content: space-between; align-items: center;
    font-family: var(--font-mono); font-size: 0.72rem;
    color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em;
    margin-bottom: 0.4rem;
  }
  .muted { color: var(--text-ghost); text-transform: none; letter-spacing: 0; }
  .hist-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.35rem; }
  .hist-row {
    display: flex; gap: 0.5rem; align-items: center;
    padding: 0.3rem 0.4rem;
    border: 1px solid var(--card-border);
  }
  .hist-row-main { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .hist-field {
    font-family: var(--font-mono); font-size: 0.7rem;
    color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em;
  }
  .hist-prev {
    font-size: 0.78rem; color: var(--text-primary);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
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
  .row.status {
    display: flex; align-items: center; gap: 0.45rem;
    font-size: 0.78rem; color: var(--text-muted);
    font-family: var(--font-mono);
    padding: 0.1rem 0.1rem;
  }
  .status-text { word-break: break-word; }
  .dots {
    width: 0.9rem; height: 0.9rem;
    display: inline-block;
    background: radial-gradient(circle at 25% 50%, currentColor 25%, transparent 26%) 0 0 / 33% 100%,
                radial-gradient(circle at 25% 50%, currentColor 25%, transparent 26%) 50% 0 / 33% 100%,
                radial-gradient(circle at 25% 50%, currentColor 25%, transparent 26%) 100% 0 / 33% 100%;
    background-repeat: no-repeat;
    animation: jkai-dots 1.1s infinite ease-in-out;
    color: var(--accent, #888);
  }
  @keyframes jkai-dots {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 1; }
  }
  .empty { font-size: 0.85rem; color: var(--text-muted); margin: 0; }
  .composer { display: flex; gap: 0.4rem; padding: 0.4rem; border-top: 1px solid var(--card-border); }
  .composer .nm-textarea { flex: 1; }
</style>
