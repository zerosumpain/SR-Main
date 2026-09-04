<script lang="ts">
  import { onMount } from 'svelte';
  import { shortModelLabel } from '$lib/jkai/model-label';
  import { formatGbp } from '$lib/canvas/stats/costFormat';

  interface ConversationItem {
    id: string;
    title: string | null;
    source: string;
    updatedAt: string | Date;
    lastMessage: string | null;
    messageCount: number;
    costUsd?: string | number | null;
    modelId?: string | null;
    pinned?: boolean;
    shareToken?: string | null;
    shareVisibility?: string | null;
  }

  interface WhatsAppThread {
    id: string | null;
    phoneNumber: string | null;
    messages: Array<{ id: string; role: string; content: string; createdAt: string }>;
  }

  let {
    conversations,
    whatsappThread,
    activeConversationId,
    onSelect,
    onWhatsAppSelect,
    onDelete,
    onRename,
    onTogglePin,
    onShare,
    onNew,
    onClose,
    liveConversationIds = [],
    openTabIds = [],
  }: {
    conversations: ConversationItem[];
    whatsappThread: WhatsAppThread | null;
    activeConversationId: string | null;
    onSelect: (id: string) => void;
    onWhatsAppSelect: () => void;
    onDelete: (id: string) => void;
    onRename: (id: string, title: string) => void;
    onTogglePin: (id: string, pinned: boolean) => void;
    onShare: (c: ConversationItem) => void;
    onNew: () => void;
    onClose: () => void;
    liveConversationIds?: string[];
    openTabIds?: string[];
  } = $props();

  let query = $state('');
  let searchInput: HTMLInputElement | undefined = $state();
  let renamingId = $state<string | null>(null);
  let renameDraft = $state('');
  let confirmingDeleteId = $state<string | null>(null);

  const liveSet = $derived(new Set(liveConversationIds));
  const openSet = $derived(new Set(openTabIds));
  const threads = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return conversations
      .filter((c) => c.source !== 'whatsapp')
      .filter((c) => !q || `${c.title ?? ''}\n${c.lastMessage ?? ''}`.toLowerCase().includes(q))
      .slice()
      .sort((a, b) => {
        if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
  });

  onMount(() => {
    searchInput?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function title(c: ConversationItem): string {
    if (c.title?.trim()) return c.title.trim();
    return c.lastMessage?.trim().split('\n')[0]?.slice(0, 72) || 'New thread';
  }

  function excerpt(c: ConversationItem): string {
    const text = c.lastMessage?.replace(/\s+/g, ' ').trim();
    if (!text) return 'An empty thread, ready to use.';
    return text.length > 150 ? `${text.slice(0, 149)}…` : text;
  }

  function age(value: string | Date): string {
    const elapsed = Date.now() - new Date(value).getTime();
    if (!Number.isFinite(elapsed) || elapsed < 0) return 'now';
    const minutes = Math.floor(elapsed / 60_000);
    if (minutes < 1) return 'now';
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return days < 7 ? `${days}d` : new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short' }).format(new Date(value));
  }

  function meta(c: ConversationItem): string[] {
    const result: string[] = [];
    const model = shortModelLabel(c.modelId);
    if (model) result.push(model);
    if (c.messageCount > 0) result.push(`${c.messageCount} messages`);
    else result.push('draft');
    const cost = Number(c.costUsd ?? 0);
    if (cost > 0) result.push(formatGbp(cost));
    return result;
  }

  function beginRename(c: ConversationItem) {
    confirmingDeleteId = null;
    renamingId = c.id;
    renameDraft = c.title ?? '';
  }

  function commitRename() {
    if (!renamingId) return;
    onRename(renamingId, renameDraft);
    renamingId = null;
  }
</script>

<div class="library-layer" role="presentation">
  <button type="button" class="library-scrim" aria-label="Close thread library" onclick={onClose}></button>
  <section class="library" role="dialog" aria-modal="true" aria-labelledby="thread-library-title" tabindex="-1">
    <header class="library-head">
      <div>
        <span class="eyebrow">JKAI / working memory</span>
        <h1 id="thread-library-title">Thread library</h1>
      </div>
      <div class="head-actions">
        <button type="button" class="new-thread" onclick={onNew}><span aria-hidden="true">＋</span> New thread</button>
        <button type="button" class="close" onclick={onClose} aria-label="Close thread library">×</button>
      </div>
    </header>

    <div class="library-tools">
      <label for="thread-search">Find a thread</label>
      <div class="search-wrap">
        <span aria-hidden="true">⌕</span>
        <input bind:this={searchInput} id="thread-search" type="search" placeholder="Search titles and recent messages" bind:value={query} />
        <span class="result-count">{threads.length} / {conversations.filter((c) => c.source !== 'whatsapp').length}</span>
      </div>
    </div>

    <div class="library-scroll">
      {#if whatsappThread?.phoneNumber && whatsappThread.messages.length > 0}
        <button type="button" class="channel" class:current={activeConversationId === whatsappThread.id} onclick={onWhatsAppSelect}>
          <span class="live-dot"></span>
          <span><strong>WhatsApp continuation</strong><small>{whatsappThread.phoneNumber} · linked channel</small></span>
          <span class="channel-open">Open →</span>
        </button>
      {/if}

      {#if threads.length === 0}
        <div class="empty">
          <strong>No threads match “{query.trim()}”.</strong>
          <span>Try a phrase from the conversation, or start a clean thread.</span>
        </div>
      {:else}
        <div class="thread-grid">
          {#each threads as c, index (c.id)}
            <article class="thread-card" class:current={activeConversationId === c.id} class:running={liveSet.has(c.id)}>
              <div class="card-index">
                <span>{String(index + 1).padStart(2, '0')}</span>
                <span>{age(c.updatedAt)}</span>
              </div>

              {#if renamingId === c.id}
                <form class="rename" onsubmit={(event) => { event.preventDefault(); commitRename(); }}>
                  <input bind:value={renameDraft} aria-label="Thread title" />
                  <button type="submit">Save</button>
                  <button type="button" onclick={() => (renamingId = null)}>Cancel</button>
                </form>
              {:else}
                <button type="button" class="thread-open" onclick={() => onSelect(c.id)}>
                  <span class="thread-state">
                    {#if liveSet.has(c.id)}<span class="pulse"></span>working{:else if openSet.has(c.id)}open{:else if c.pinned}pinned{:else}thread{/if}
                  </span>
                  <strong>{title(c)}</strong>
                  <span class="excerpt">{excerpt(c)}</span>
                </button>
              {/if}

              <div class="card-foot">
                <span>{meta(c).join(' / ')}</span>
                <div class="card-actions">
                  <button type="button" class:active={c.pinned} onclick={() => onTogglePin(c.id, !c.pinned)}>{c.pinned ? 'Unpin' : 'Pin'}</button>
                  <button type="button" onclick={() => beginRename(c)}>Rename</button>
                  <button type="button" onclick={() => onShare(c)}>Share</button>
                  {#if confirmingDeleteId === c.id}
                    <button type="button" class="danger" onclick={() => { confirmingDeleteId = null; onDelete(c.id); }}>Confirm</button>
                    <button type="button" onclick={() => (confirmingDeleteId = null)}>Keep</button>
                  {:else}
                    <button type="button" onclick={() => { renamingId = null; confirmingDeleteId = c.id; }}>Delete</button>
                  {/if}
                </div>
              </div>
            </article>
          {/each}
        </div>
      {/if}
    </div>

    <footer class="library-foot">
      <span>Search, pin and manage the archive here.</span>
      <span>Open work stays in the strip behind this window.</span>
    </footer>
  </section>
</div>

<style>
  .library-layer { position:fixed; inset:0; z-index:120; display:grid; place-items:center; padding:24px; }
  .library-scrim { position:absolute; inset:0; width:100%; height:100%; border:0; background:rgba(26,16,8,.56); cursor:default; }
  .library { position:relative; width:min(1120px, 100%); height:min(780px, calc(100dvh - 48px)); display:flex; flex-direction:column; overflow:hidden; border:1px solid var(--text-primary); background:var(--bg); box-shadow:var(--elev-pop); }
  .library-head { display:flex; align-items:flex-end; justify-content:space-between; gap:24px; padding:24px 26px 20px; background:var(--text-primary); color:var(--bg); }
  .eyebrow { display:block; margin-bottom:6px; color:var(--accent-on-dark); font-family:var(--font-mono); font-size:var(--fs-label-xs); text-transform:uppercase; letter-spacing:var(--tracking-label-wide); }
  h1 { margin:0; font-family:var(--font-display); font-size:clamp(1.8rem, 4vw, 3.4rem); line-height:.95; text-transform:uppercase; letter-spacing:-.035em; }
  .head-actions { display:flex; align-items:center; gap:8px; }
  .new-thread, .close { height:42px; border:1px solid rgba(237,228,212,.28); background:transparent; color:var(--bg); font-family:var(--font-mono); cursor:pointer; }
  .new-thread { padding:0 15px; font-size:var(--fs-label); text-transform:uppercase; letter-spacing:.08em; }
  .new-thread:hover { border-color:var(--accent-on-dark); color:var(--accent-on-dark); }
  .close { width:42px; font-size:1.45rem; }
  .library-tools { padding:16px 26px; border-bottom:1px solid var(--line-strong); background:var(--surface-rail); }
  .library-tools label { display:block; margin-bottom:6px; color:var(--text-ghost); font-family:var(--font-mono); font-size:var(--fs-label-xs); text-transform:uppercase; letter-spacing:var(--tracking-label); }
  .search-wrap { display:flex; align-items:center; gap:10px; }
  .search-wrap > span:first-child { color:var(--accent); font-size:1.25rem; }
  .search-wrap input { flex:1; min-width:0; padding:8px 0; border:0; border-bottom:1px solid var(--line-strong); outline:0; background:transparent; color:var(--text-primary); font-family:var(--font-body); font-size:var(--fs-body); }
  .search-wrap input:focus { border-bottom-color:var(--accent); }
  .result-count { flex:none; color:var(--text-ghost); font-family:var(--font-mono); font-size:var(--fs-label-xs); }
  .library-scroll { flex:1; min-height:0; overflow:auto; padding:20px 26px 28px; }
  .channel { width:100%; display:flex; align-items:center; gap:12px; margin-bottom:16px; padding:12px 14px; border:1px solid var(--line-strong); background:var(--surface-sunken); color:var(--text-primary); text-align:left; cursor:pointer; }
  .channel.current { border-color:var(--accent); }
  .channel > span:nth-child(2) { display:flex; flex-direction:column; gap:2px; }
  .channel strong { font-size:var(--fs-body-sm); }
  .channel small { color:var(--text-muted); font-size:var(--fs-label-xs); }
  .channel-open { margin-left:auto; color:var(--accent); font-family:var(--font-mono); font-size:var(--fs-label-xs); text-transform:uppercase; }
  .live-dot, .pulse { width:7px; height:7px; border-radius:50%; background:var(--wa-green); }
  .thread-grid { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); border-top:1px solid var(--line-strong); border-left:1px solid var(--line-strong); }
  .thread-card { min-width:0; display:flex; flex-direction:column; min-height:225px; border-right:1px solid var(--line-strong); border-bottom:1px solid var(--line-strong); background:var(--bg); }
  .thread-card.current { box-shadow:inset 4px 0 var(--accent); background:var(--accent-tint-04); }
  .thread-card.running { box-shadow:inset 0 3px var(--accent); }
  .card-index { display:flex; justify-content:space-between; padding:10px 13px 0; color:var(--text-ghost); font-family:var(--font-mono); font-size:var(--fs-label-xs); text-transform:uppercase; letter-spacing:.08em; }
  .thread-open { flex:1; display:flex; flex-direction:column; align-items:flex-start; gap:8px; min-width:0; padding:10px 13px 14px; border:0; background:transparent; color:var(--text-primary); text-align:left; cursor:pointer; }
  .thread-open:hover strong { color:var(--accent); }
  .thread-state { display:flex; align-items:center; gap:6px; color:var(--accent); font-family:var(--font-mono); font-size:var(--fs-label-xs); text-transform:uppercase; letter-spacing:.1em; }
  .pulse { background:var(--accent); animation:pulse 1.5s ease-in-out infinite; }
  .thread-open strong { max-width:100%; overflow:hidden; color:var(--text-primary); font-size:var(--fs-body); line-height:1.25; text-overflow:ellipsis; white-space:nowrap; }
  .excerpt { display:-webkit-box; overflow:hidden; color:var(--text-muted); font-size:var(--fs-body-sm); line-height:1.45; -webkit-box-orient:vertical; -webkit-line-clamp:3; }
  .card-foot { display:flex; align-items:flex-end; justify-content:space-between; gap:12px; padding:10px 13px; border-top:1px solid var(--line-hair); color:var(--text-ghost); font-family:var(--font-mono); font-size:var(--fs-label-xs); text-transform:uppercase; }
  .card-actions { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:7px; }
  .card-actions button { padding:0; border:0; background:transparent; color:var(--text-muted); font-family:var(--font-mono); font-size:var(--fs-label-xs); text-transform:uppercase; cursor:pointer; }
  .card-actions button:hover, .card-actions button.active { color:var(--accent); }
  .card-actions button.danger { color:var(--error); }
  .rename { flex:1; display:flex; align-content:flex-start; flex-wrap:wrap; gap:8px; padding:16px 13px; }
  .rename input { width:100%; padding:9px 10px; border:1px solid var(--accent); background:var(--surface-card); color:var(--text-primary); font-size:var(--fs-body); }
  .rename button { padding:5px 9px; border:1px solid var(--line-strong); background:transparent; color:var(--text-muted); font-family:var(--font-mono); font-size:var(--fs-label-xs); text-transform:uppercase; cursor:pointer; }
  .empty { min-height:260px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px; border:1px solid var(--line-strong); color:var(--text-muted); }
  .empty strong { color:var(--text-primary); }
  .library-foot { display:flex; justify-content:space-between; gap:20px; padding:10px 26px; border-top:1px solid var(--line-strong); background:var(--surface-rail); color:var(--text-ghost); font-family:var(--font-mono); font-size:var(--fs-label-xs); text-transform:uppercase; letter-spacing:.06em; }
  @keyframes pulse { 50% { opacity:.35; } }
  @media (prefers-reduced-motion:reduce) { .pulse { animation:none; } }
  @media (max-width:720px) {
    .library-layer { padding:0; place-items:stretch; }
    .library { width:100%; height:100dvh; border:0; }
    .library-head { align-items:flex-start; padding:20px 16px 16px; }
    .new-thread { width:42px; padding:0; overflow:hidden; white-space:nowrap; }
    .new-thread span { display:inline-block; width:40px; }
    .library-tools, .library-scroll { padding-left:16px; padding-right:16px; }
    .thread-grid { grid-template-columns:minmax(0,1fr); }
    .thread-card { min-height:205px; }
    .library-foot { padding:9px 16px; }
    .library-foot span:last-child { display:none; }
  }
</style>
