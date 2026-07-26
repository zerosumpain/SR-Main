<script lang="ts">
  import DraftsPanel from './DraftsPanel.svelte';
  import MetricsStrip from './MetricsStrip.svelte';
  import ThroughputMeter from './ThroughputMeter.svelte';

  interface SpendByPeriod {
    day: number;
    week: number;
    month: number;
    lifetime: number;
  }

  interface ConversationItem {
    id: string;
    title: string | null;
    source: string;
    updatedAt: string | Date;
    lastMessage: string | null;
    messageCount: number;
    costUsd?: string | number | null;
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
    onNew,
    onWhatsAppSelect,
    onDelete,
    onRename,
    onTogglePin,
    onShare,
    collapsed = false,
    onToggleCollapse,
    liveConversationIds = [],
    metrics,
    spendByPeriod,
  }: {
    conversations: ConversationItem[];
    whatsappThread: WhatsAppThread | null;
    activeConversationId: string | null;
    onSelect: (id: string) => void;
    onNew: () => void;
    onWhatsAppSelect: () => void;
    onDelete: (id: string) => void;
    onRename?: (id: string, title: string) => void;
    onTogglePin?: (id: string, pinned: boolean) => void;
    onShare?: (c: ConversationItem) => void;
    collapsed?: boolean;
    onToggleCollapse: () => void;
    liveConversationIds?: string[];
    metrics: { scheduled: number; running: number; completed: number; failed: number };
    spendByPeriod: SpendByPeriod;
  } = $props();

  const liveSet = $derived(new Set(liveConversationIds));

  // --- Search ---
  let search = $state('');
  const q = $derived(search.trim().toLowerCase());
  const searching = $derived(q.length > 0);

  function matches(c: ConversationItem): boolean {
    if (!q) return true;
    return (
      (c.title ?? '').toLowerCase().includes(q) ||
      (c.lastMessage ?? '').toLowerCase().includes(q)
    );
  }

  // The raw WhatsApp thread (source 'whatsapp') has its own dedicated row
  // below and opens the real conversation with its full history — keep it out
  // of the normal buckets so it isn't listed twice.
  const base = $derived(conversations.filter((c) => c.source !== 'whatsapp'));
  const visible = $derived(base.filter(matches));
  const pinned = $derived(visible.filter((c) => c.pinned));
  const unpinned = $derived(visible.filter((c) => !c.pinned));

  // --- Recency buckets (non-search view) ---
  type Bucket = 'today' | 'yesterday' | 'last_week' | 'older';
  const BUCKET_LABELS: Record<Bucket, string> = {
    today: 'Today', yesterday: 'Yesterday', last_week: 'Last 7 days', older: 'Older',
  };
  const BUCKET_ORDER: Bucket[] = ['today', 'yesterday', 'last_week', 'older'];

  function getBucket(date: string | Date): Bucket {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfYesterday = startOfToday - 86400000;
    const sevenDaysAgo = startOfToday - 7 * 86400000;
    const ts = new Date(date).getTime();
    if (ts >= startOfToday) return 'today';
    if (ts >= startOfYesterday) return 'yesterday';
    if (ts >= sevenDaysAgo) return 'last_week';
    return 'older';
  }

  const grouped = $derived.by(() => {
    const g: Record<Bucket, ConversationItem[]> = { today: [], yesterday: [], last_week: [], older: [] };
    for (const c of unpinned) g[getBucket(c.updatedAt)].push(c);
    return g;
  });

  let expanded = $state<Record<Bucket, boolean>>({
    today: true, yesterday: false, last_week: false, older: false,
  });
  let pinnedExpanded = $state(true);

  function toggleBucket(b: Bucket) {
    expanded = { ...expanded, [b]: !expanded[b] };
  }

  // --- Rename ---
  let renamingId = $state<string | null>(null);
  let renameDraft = $state('');

  function startRename(e: Event, c: ConversationItem) {
    e.stopPropagation();
    renamingId = c.id;
    renameDraft = c.title ?? '';
    confirmingDeleteId = null;
  }
  function commitRename() {
    if (renamingId) onRename?.(renamingId, renameDraft.trim());
    renamingId = null;
  }
  function cancelRename() {
    renamingId = null;
  }
  function focusSelect(node: HTMLInputElement) {
    node.focus();
    node.select();
  }

  // --- Pin ---
  function togglePin(e: Event, c: ConversationItem) {
    e.stopPropagation();
    onTogglePin?.(c.id, !c.pinned);
  }

  // --- Share ---
  function share(e: Event, c: ConversationItem) {
    e.stopPropagation();
    onShare?.(c);
  }

  // --- Delete (inline confirm, no browser alert) ---
  let confirmingDeleteId = $state<string | null>(null);
  function askDelete(e: Event, c: ConversationItem) {
    e.stopPropagation();
    confirmingDeleteId = c.id;
    renamingId = null;
  }
  function confirmDelete(e: Event, c: ConversationItem) {
    e.stopPropagation();
    confirmingDeleteId = null;
    onDelete(c.id);
  }
  function cancelDelete(e: Event) {
    e.stopPropagation();
    confirmingDeleteId = null;
  }

  function selectConv(id: string) {
    confirmingDeleteId = null;
    onSelect(id);
  }

  function relativeTime(iso: string | Date): string {
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60000) return 'now';
    if (ms < 3600000) return `${Math.floor(ms / 60000)}m`;
    if (ms < 86400000) return `${Math.floor(ms / 3600000)}h`;
    return `${Math.floor(ms / 86400000)}d`;
  }
  function truncate(text: string | null, len: number): string {
    if (!text) return '';
    return text.length > len ? text.slice(0, len) + '…' : text;
  }

  // Recent conversations for the collapsed rail dots (cap for tidiness).
  const railDots = $derived(base.slice(0, 9));
</script>

{#if collapsed}
  <div class="rail" style="border-color: var(--card-border);">
    <button class="rbtn primary" onclick={onNew} title="New chat" aria-label="New chat">
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M10 4v12M4 10h12"/></svg>
    </button>
    <button class="rbtn" onclick={onToggleCollapse} title="Search / expand" aria-label="Expand sidebar">
      <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="9" cy="9" r="6"/><path d="M14 14l4 4"/></svg>
    </button>
    <div class="rail-sep"></div>
    <div class="rail-dots">
      {#each railDots as c (c.id)}
        <button
          class="cdot"
          class:active={activeConversationId === c.id}
          class:live={liveSet.has(c.id)}
          onclick={() => selectConv(c.id)}
          title={c.title || 'Conversation'}
          aria-label={c.title || 'Conversation'}
        ></button>
      {/each}
    </div>
    <div class="rail-spacer"></div>
    <ThroughputMeter compact />
    <button class="rbtn" onclick={onToggleCollapse} title="Expand sidebar" aria-label="Expand sidebar">
      <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M8 5l5 5-5 5"/></svg>
    </button>
  </div>
{:else}
  <div class="sb" style="border-color: var(--card-border);">
    <!-- Header -->
    <div class="sb-hd">
      <span class="sb-eyebrow">Conversations</span>
      <button class="icon-btn" onclick={onToggleCollapse} title="Collapse sidebar" aria-label="Collapse sidebar">
        <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 5l-5 5 5 5"/></svg>
      </button>
    </div>

    <!-- New chat (primary) -->
    <button class="newchat" onclick={onNew}>
      <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M10 4v12M4 10h12"/></svg>
      New chat
    </button>

    <!-- Search -->
    <div class="search">
      <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="9" cy="9" r="6"/><path d="M14 14l4 4"/></svg>
      <input
        type="text"
        placeholder="Search conversations…"
        bind:value={search}
        onkeydown={(e) => { if (e.key === 'Escape') search = ''; }}
        aria-label="Search conversations"
      />
      {#if search}
        <button class="search-clear" onclick={() => (search = '')} title="Clear" aria-label="Clear search">
          <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 5l10 10M15 5L5 15"/></svg>
        </button>
      {/if}
    </div>

    <!-- List -->
    <div class="list">
      <!-- WhatsApp thread -->
      {#if whatsappThread?.phoneNumber && whatsappThread.messages.length > 0 && !searching}
        <button
          class="wa"
          class:active={activeConversationId === whatsappThread.id}
          onclick={onWhatsAppSelect}
        >
          <span class="wa-tag">WA</span>
          <span class="wa-body">
            <span class="wa-title">WhatsApp thread</span>
            <span class="wa-prev">{truncate(whatsappThread.messages[whatsappThread.messages.length - 1]?.content, 38)}</span>
          </span>
        </button>
      {/if}

      {#if searching}
        {#if visible.length === 0}
          <div class="empty">
            <svg width="26" height="26" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.3" style="opacity:.5"><circle cx="9" cy="9" r="6"/><path d="M14 14l4 4"/></svg>
            <div class="empty-big">No conversations match “{search.trim()}”.</div>
            <div class="empty-sm">Try a different term, or start a new chat.</div>
          </div>
        {:else}
          {#each [...pinned, ...unpinned] as c (c.id)}
            {@render row(c)}
          {/each}
        {/if}
      {:else if conversations.length === 0}
        <div class="empty">
          <svg width="26" height="26" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.3" style="opacity:.5"><path d="M4 5h12v8H8l-4 3z"/></svg>
          <div class="empty-big">No conversations yet.</div>
          <div class="empty-sm">Start a new chat to begin.</div>
        </div>
      {:else}
        <!-- Pinned -->
        {#if pinned.length > 0}
          <button class="sec-hd pin" onclick={() => (pinnedExpanded = !pinnedExpanded)}>
            <span class="sec-l">
              <span class="chev" class:open={pinnedExpanded}>
                <svg width="9" height="9" viewBox="0 0 12 12" fill="currentColor"><path d="M3 2l5 4-5 4z"/></svg>
              </span>
              <span class="sec-lbl">Pinned</span>
            </span>
            <span class="sec-cnt">{pinned.length}</span>
          </button>
          {#if pinnedExpanded}
            {#each pinned as c (c.id)}
              {@render row(c)}
            {/each}
          {/if}
        {/if}

        <!-- Recency buckets -->
        {#each BUCKET_ORDER as bucket}
          {#if grouped[bucket].length > 0}
            <button class="sec-hd" onclick={() => toggleBucket(bucket)}>
              <span class="sec-l">
                <span class="chev" class:open={expanded[bucket]}>
                  <svg width="9" height="9" viewBox="0 0 12 12" fill="currentColor"><path d="M3 2l5 4-5 4z"/></svg>
                </span>
                <span class="sec-lbl">{BUCKET_LABELS[bucket]}</span>
              </span>
              <span class="sec-cnt">{grouped[bucket].length}</span>
            </button>
            {#if expanded[bucket]}
              {#each grouped[bucket] as c (c.id)}
                {@render row(c)}
              {/each}
            {/if}
          {/if}
        {/each}
      {/if}
    </div>

    <!-- Drafts (offline-first, IndexedDB) -->
    <DraftsPanel />

    <!-- Footer -->
    <div class="foot">
      <ThroughputMeter />
      <MetricsStrip {metrics} {spendByPeriod} />
    </div>
  </div>
{/if}

{#snippet row(c: ConversationItem)}
  {#if renamingId === c.id}
    <div class="row rename-row">
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="rename-input"
        bind:value={renameDraft}
        use:focusSelect
        onkeydown={(e) => { if (e.key === 'Enter') commitRename(); else if (e.key === 'Escape') cancelRename(); }}
        onblur={commitRename}
        aria-label="Rename conversation"
      />
    </div>
  {:else}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="row"
      class:active={activeConversationId === c.id}
      onclick={() => selectConv(c.id)}
      onkeydown={(e) => { if (e.key === 'Enter') selectConv(c.id); }}
      role="button"
      tabindex="0"
    >
      <div class="row-top">
        {#if liveSet.has(c.id)}
          <span class="live" title="JKAI is working on this" aria-label="Live job"></span>
        {:else if c.pinned}
          <svg class="pin-badge" width="11" height="11" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M10 2l1.9 4.9L17 7.5l-3.8 3 1.3 5-4.5-2.9L5.5 15.5l1.3-5L3 7.5l5.1-.6z"/></svg>
        {/if}
        <span class="row-title">{c.title || 'New conversation'}</span>
        {#if c.shareVisibility && c.shareVisibility !== 'private'}
          <span class="shared-badge" title={`Shared · ${c.shareVisibility === 'public' ? 'anyone with the link' : 'signed-in users'}`} aria-label="Shared">
            <svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="15" cy="5" r="2"/><circle cx="5" cy="10" r="2"/><circle cx="15" cy="15" r="2"/><path d="M13.1 6.1 6.9 8.9M6.9 11.1l6.2 2.8"/></svg>
          </span>
        {/if}
        <span class="row-time">{relativeTime(c.updatedAt)}</span>
      </div>
      {#if c.lastMessage}
        <p class="row-prev">{truncate(c.lastMessage, 42)}</p>
      {/if}

      <!-- Hover actions (each button stops propagation so the row isn't selected) -->
      <div class="actions">
        {#if confirmingDeleteId === c.id}
          <button class="act danger" onclick={(e) => confirmDelete(e, c)} title="Confirm delete" aria-label="Confirm delete">
            <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M4 10l4 4 8-9"/></svg>
          </button>
          <button class="act" onclick={cancelDelete} title="Cancel" aria-label="Cancel delete">
            <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 5l10 10M15 5L5 15"/></svg>
          </button>
        {:else}
          <button class="act" onclick={(e) => togglePin(e, c)} title={c.pinned ? 'Unpin' : 'Pin'} aria-label={c.pinned ? 'Unpin' : 'Pin'}>
            <svg width="13" height="13" viewBox="0 0 20 20" fill={c.pinned ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.4"><path d="M10 2l1.9 4.9L17 7.5l-3.8 3 1.3 5-4.5-2.9L5.5 15.5l1.3-5L3 7.5l5.1-.6z"/></svg>
          </button>
          <button class="act" onclick={(e) => startRename(e, c)} title="Rename" aria-label="Rename">
            <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 13.5V16h2.5L14 8.5 11.5 6z"/><path d="M11.5 6L14 8.5"/></svg>
          </button>
          <button class="act" onclick={(e) => share(e, c)} title="Share" aria-label="Share">
            <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="15" cy="5" r="2.2"/><circle cx="5" cy="10" r="2.2"/><circle cx="15" cy="15" r="2.2"/><path d="M12.9 6.2 7.1 8.8M7.1 11.2l5.8 2.6"/></svg>
          </button>
          <button class="act danger" onclick={(e) => askDelete(e, c)} title="Delete" aria-label="Delete">
            <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5 6h10M8 6V4h4v2M6 6l1 10h6l1-10"/></svg>
          </button>
        {/if}
      </div>
    </div>
  {/if}
{/snippet}

<style>
  /* ---- expanded shell ---- */
  .sb {
    width: 100%;
    display: flex;
    flex-direction: column;
    height: 100%;
    border-right: 1px solid var(--card-border);
    background: var(--bg);
  }
  @media (min-width: 640px) { .sb { width: 16rem; flex-shrink: 0; } }

  .sb-hd {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 12px 10px;
  }
  .sb-eyebrow {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    color: var(--text-secondary);
  }
  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: 1px solid transparent;
    border-radius: var(--radius-round);
    color: var(--text-ghost);
    background: none;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .icon-btn:hover { color: var(--text-primary); background: var(--card-bg); }

  .newchat {
    margin: 0 12px 10px;
    display: flex;
    align-items: center;
    gap: 8px;
    justify-content: center;
    padding: 9px 12px;
    border: 1.5px solid var(--accent);
    border-radius: var(--radius-round);
    color: var(--accent);
    background: none;
    font-family: var(--font-sans);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .newchat:hover { background: var(--accent); color: #fff; }

  .search { position: relative; margin: 0 12px 6px; }
  .search > svg { position: absolute; left: 9px; top: 50%; transform: translateY(-50%); color: var(--text-ghost); pointer-events: none; }
  .search input {
    width: 100%;
    padding: 7px 28px 7px 30px;
    border: 1px solid var(--card-border);
    border-radius: var(--radius-round);
    background: var(--surface-elevated);
    font-family: var(--font-sans);
    font-size: 12.5px;
    color: var(--text-primary);
  }
  .search input::placeholder { color: var(--text-ghost); }
  .search input:focus { outline: none; border-color: var(--accent); }
  .search-clear {
    position: absolute; right: 7px; top: 50%; transform: translateY(-50%);
    display: inline-flex; align-items: center; justify-content: center;
    width: 18px; height: 18px; border: none; background: none; color: var(--text-ghost);
    cursor: pointer; border-radius: var(--radius-round);
  }
  .search-clear:hover { color: var(--text-primary); background: var(--card-bg); }

  .list { flex: 1; overflow-y: auto; padding: 6px 0; }

  /* section header */
  .sec-hd {
    display: flex; align-items: center; justify-content: space-between;
    width: 100%; padding: 9px 12px 4px; background: none; border: none; cursor: pointer;
  }
  .sec-l { display: flex; align-items: center; gap: 6px; }
  .chev { color: var(--text-ghost); display: inline-flex; transition: transform 0.15s; }
  .chev.open { transform: rotate(90deg); }
  .sec-lbl { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.13em; color: var(--text-secondary); }
  .sec-cnt { font-family: var(--font-mono); font-size: 10px; color: var(--text-ghost); }
  .sec-hd.pin .sec-lbl { color: var(--accent-ink); }

  /* row */
  .row {
    position: relative; display: block; width: 100%; text-align: left;
    padding: 8px 12px 8px 13px; border-left: 2px solid transparent;
    cursor: pointer; transition: background 0.1s;
  }
  .row:hover { background: var(--bg-section); }
  .row.active { background: color-mix(in srgb, var(--accent) 9%, transparent); border-left-color: var(--accent); }
  .row:focus-visible { outline: none; background: var(--bg-section); border-left-color: var(--accent-ink); }
  .row-top { display: flex; align-items: center; gap: 6px; }
  .row-title {
    flex: 1; font-size: 13px; font-weight: 500; color: var(--text-primary);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.3;
  }
  .row.active .row-title { color: var(--accent); }
  .row-time { font-family: var(--font-mono); font-size: 10px; color: var(--text-ghost); flex-shrink: 0; }
  .row-prev { font-size: 11.5px; color: var(--text-ghost); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 2px; line-height: 1.3; }
  .pin-badge { color: var(--accent-ink); flex-shrink: 0; }
  .shared-badge { color: var(--accent-ink); flex-shrink: 0; display: inline-flex; opacity: 0.75; }
  .live {
    width: 7px; height: 7px; border-radius: var(--radius-pill); background: var(--wa-green); flex-shrink: 0;
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--wa-green) 60%, transparent);
    animation: live-pulse 1.6s ease-out infinite;
  }
  @keyframes live-pulse {
    0%   { box-shadow: 0 0 0 0 color-mix(in srgb, var(--wa-green) 55%, transparent); }
    70%  { box-shadow: 0 0 0 6px color-mix(in srgb, var(--wa-green) 0%, transparent); }
    100% { box-shadow: 0 0 0 0 transparent; }
  }

  /* hover action cluster */
  .actions {
    position: absolute; right: 8px; top: 6px; display: flex; gap: 1px;
    background: var(--surface-elevated); border: 1px solid var(--card-border);
    border-radius: var(--radius-round); padding: 1px;
    opacity: 0; transform: translateX(4px); transition: opacity 0.12s, transform 0.12s;
  }
  .row:hover .actions, .row:focus-within .actions { opacity: 1; transform: none; }
  .act {
    display: inline-flex; align-items: center; justify-content: center;
    width: 24px; height: 22px; border: none; background: none; color: var(--text-muted);
    cursor: pointer; border-radius: 3px; transition: background 0.1s, color 0.1s;
  }
  .act:hover { background: var(--card-bg); color: var(--text-primary); }
  .act.danger:hover { background: color-mix(in srgb, var(--error) 16%, transparent); color: #a3352f; }

  /* rename */
  .rename-row { padding: 6px 12px 6px 13px; }
  .rename-input {
    width: 100%; padding: 5px 7px; border: 1px solid var(--accent); border-radius: 3px;
    background: var(--bg); font-family: var(--font-sans); font-size: 13px; color: var(--text-primary);
  }
  .rename-input:focus { outline: none; }

  /* whatsapp */
  .wa {
    display: flex; align-items: center; gap: 8px; width: calc(100% - 16px);
    padding: 9px 10px; margin: 2px 8px 6px; border: 1px solid var(--card-border);
    border-radius: var(--radius-round); background: none; cursor: pointer; text-align: left;
    transition: background 0.1s;
  }
  .wa:hover { background: var(--bg-section); }
  .wa.active { background: color-mix(in srgb, var(--accent) 9%, transparent); border-color: color-mix(in srgb, var(--accent) 40%, var(--card-border)); }
  .wa-tag {
    font-family: var(--font-mono); font-size: 9px; font-weight: 500; padding: 2px 5px;
    border-radius: 3px; background: color-mix(in srgb, var(--wa-green) 16%, transparent);
    color: #128c3e; letter-spacing: 0.05em; flex-shrink: 0;
  }
  .wa-body { display: flex; flex-direction: column; min-width: 0; }
  .wa-title { font-size: 12px; font-weight: 500; color: var(--text-secondary); }
  .wa-prev { font-size: 11px; color: var(--text-ghost); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  /* empty state */
  .empty { padding: 30px 16px; text-align: center; color: var(--text-ghost); }
  .empty-big { font-size: 12.5px; color: var(--text-muted); margin-top: 10px; }
  .empty-sm { font-size: 11px; margin-top: 3px; }

  /* footer */
  .foot {
    border-top: 1px solid var(--card-border); padding: 9px 12px;
    display: flex; flex-direction: column; gap: 5px;
  }

  /* ---- collapsed rail ---- */
  .rail {
    width: 56px; height: 100%; border-right: 1px solid var(--card-border); background: var(--bg);
    display: flex; flex-direction: column; align-items: center; padding: 12px 0; gap: 8px;
  }
  .rbtn {
    width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center;
    border: 1px solid var(--card-border); border-radius: var(--radius-round);
    color: var(--text-secondary); background: none; cursor: pointer;
    transition: background 0.12s, color 0.12s, border-color 0.12s;
  }
  .rbtn:hover { background: var(--card-bg); color: var(--text-primary); }
  .rbtn.primary { border-color: var(--accent); color: var(--accent); }
  .rbtn.primary:hover { background: var(--accent); color: #fff; }
  .rail-sep { width: 24px; height: 1px; background: var(--card-border); margin: 2px 0; }
  .rail-dots { display: flex; flex-direction: column; align-items: center; gap: 8px; overflow: hidden; }
  .cdot { width: 8px; height: 8px; border-radius: var(--radius-pill); background: var(--card-border); border: none; padding: 0; cursor: pointer; transition: transform 0.1s; }
  .cdot:hover { transform: scale(1.35); }
  .cdot.active { background: var(--accent); }
  .cdot.live { background: var(--wa-green); }
  .rail-spacer { flex: 1; }
</style>
