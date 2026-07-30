<script lang="ts">
  import DraftsPanel from './DraftsPanel.svelte';
  import ThroughputMeter from './ThroughputMeter.svelte';
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
    onNew,
    onWhatsAppSelect,
    onDelete,
    onRename,
    onTogglePin,
    onShare,
    collapsed = false,
    onToggleCollapse,
    liveConversationIds = [],
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
  } = $props();

  const liveSet = $derived(new Set(liveConversationIds));

  // --- Search ---
  let search = $state('');
  const q = $derived(search.trim().toLowerCase());
  const searching = $derived(q.length > 0);

  function matches(c: ConversationItem): boolean {
    if (!q) return true;
    return (
      (c.title ?? '').toLowerCase().includes(q) || (c.lastMessage ?? '').toLowerCase().includes(q)
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
    today: 'Today',
    yesterday: 'Yesterday',
    last_week: 'Last 7 days',
    older: 'Older',
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
    const g: Record<Bucket, ConversationItem[]> = {
      today: [],
      yesterday: [],
      last_week: [],
      older: [],
    };
    for (const c of unpinned) g[getBucket(c.updatedAt)].push(c);
    return g;
  });

  // Rail rows are numbered `01`, `02`, … continuously down the visible list,
  // across bucket headings — the index is a position in the rail, not in a
  // group, so it stays meaningful as sections collapse.
  const rowIndex = $derived.by(() => {
    const order = searching
      ? [...pinned, ...unpinned]
      : [...pinned, ...BUCKET_ORDER.flatMap((b) => grouped[b])];
    const m = new Map<string, string>();
    order.forEach((c, i) => m.set(c.id, String(i + 1).padStart(2, '0')));
    return m;
  });

  let expanded = $state<Record<Bucket, boolean>>({
    today: true,
    yesterday: false,
    last_week: false,
    older: false,
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

  function truncate(text: string | null, len: number): string {
    if (!text) return '';
    return text.length > len ? text.slice(0, len) + '…' : text;
  }

  /** A thread with no title is not "New thread" 27 times over — it is whatever
   *  was said in it. Fall back to the opening line so the rail is scannable
   *  before the titler has run. */
  function rowTitle(c: ConversationItem): string {
    if (c.title?.trim()) return c.title.trim();
    const first = c.lastMessage?.trim().split('\n')[0];
    if (first) return truncate(first, 44);
    return 'New thread';
  }

  /** `model / cost / source`, minus whatever carries no information. Every row
   *  showing the same default model, £0.00 and WEB is three-quarters noise; a
   *  chunk earns its place by differing from the default. */
  function metaChunks(c: ConversationItem): string[] {
    const chunks: string[] = [];
    const model = shortModelLabel(c.modelId);
    if (model) chunks.push(model);
    const cost = c.costUsd === null || c.costUsd === undefined ? 0 : Number(c.costUsd);
    if (cost > 0) chunks.push(formatGbp(cost));
    if (c.messageCount === 0) chunks.push('draft');
    else if (c.source && c.source !== 'web') chunks.push(c.source);
    return chunks;
  }

  // Recent conversations for the collapsed rail dots (cap for tidiness).
  const railDots = $derived(base.slice(0, 9));
</script>

{#if collapsed}
  <div class="rail">
    <button class="rbtn primary" onclick={onNew} title="New thread" aria-label="New thread">+</button>
    <button class="rbtn" onclick={onToggleCollapse} title="Expand rail" aria-label="Expand rail">
      ▸
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
  </div>
{:else}
  <div class="sb">
    <!-- Header -->
    <div class="sb-hd">
      <span class="rail-label">Threads</span>
      <div class="sb-hd-btns">
        <button class="collapse-btn" onclick={onToggleCollapse} title="Collapse rail" aria-label="Collapse rail">
          ◂
        </button>
        <button class="new-btn" onclick={onNew} title="New thread" aria-label="New thread">+</button>
      </div>
    </div>

    <!-- Search -->
    <div class="search">
      <input
        type="text"
        placeholder="search threads"
        bind:value={search}
        onkeydown={(e) => {
          if (e.key === 'Escape') search = '';
        }}
        aria-label="Search conversations"
      />
      {#if search}
        <button class="search-clear" onclick={() => (search = '')} title="Clear" aria-label="Clear search">✕</button>
      {/if}
    </div>

    <!-- List -->
    <div class="list">
      {#if searching}
        {#if visible.length === 0}
          <div class="empty">
            <div class="empty-big">No threads match “{search.trim()}”.</div>
            <div class="empty-sm">Try a different term, or start a new one.</div>
          </div>
        {:else}
          {#each [...pinned, ...unpinned] as c (c.id)}
            {@render row(c)}
          {/each}
        {/if}
      {:else if conversations.length === 0}
        <div class="empty">
          <div class="empty-big">No threads yet.</div>
          <div class="empty-sm">Start one to begin.</div>
        </div>
      {:else}
        {#if pinned.length > 0}
          <button class="sec-hd" onclick={() => (pinnedExpanded = !pinnedExpanded)}>
            <span class="rail-label">Pinned</span>
            <span class="sec-cnt">{pinnedExpanded ? '▾' : '▸'} {pinned.length}</span>
          </button>
          {#if pinnedExpanded}
            {#each pinned as c (c.id)}
              {@render row(c)}
            {/each}
          {/if}
        {/if}

        {#each BUCKET_ORDER as bucket}
          {#if grouped[bucket].length > 0}
            <button class="sec-hd" onclick={() => toggleBucket(bucket)}>
              <span class="rail-label">{BUCKET_LABELS[bucket]}</span>
              <span class="sec-cnt">{expanded[bucket] ? '▾' : '▸'} {grouped[bucket].length}</span>
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
    <!-- One footer, not three stacked widgets. Drafts, the channel state and
         the throughput meter are all "what is going on outside this thread",
         so they share a block, a rhythm and a single top border. -->
    <div class="rail-foot">
      <DraftsPanel />
      <div class="rail-label">Channels</div>
      {#if whatsappThread?.phoneNumber && whatsappThread.messages.length > 0}
        <button
          class="channel-row"
          class:active={activeConversationId === whatsappThread.id}
          onclick={onWhatsAppSelect}
          title={truncate(whatsappThread.messages[whatsappThread.messages.length - 1]?.content, 60)}
        >
          <span class="channel-name">whatsapp</span>
          <span class="channel-state"><span class="channel-dot"></span>linked</span>
        </button>
      {:else}
        <div class="channel-row static">
          <span class="channel-name">whatsapp</span>
          <span class="channel-state idle">idle</span>
        </div>
      {/if}
      <ThroughputMeter />
    </div>
  </div>
{/if}

{#snippet row(c: ConversationItem)}
  {#if renamingId === c.id}
    <div class="thread-row rename-row">
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="rename-input"
        bind:value={renameDraft}
        use:focusSelect
        onkeydown={(e) => {
          if (e.key === 'Enter') commitRename();
          else if (e.key === 'Escape') cancelRename();
        }}
        onblur={commitRename}
        aria-label="Rename conversation"
      />
    </div>
  {:else}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="thread-row"
      class:active={activeConversationId === c.id}
      onclick={() => selectConv(c.id)}
      onkeydown={(e) => {
        if (e.key === 'Enter') selectConv(c.id);
      }}
      role="button"
      tabindex="0"
    >
      <div class="tr-top">
        <span class="tr-idx">{rowIndex.get(c.id) ?? '··'}</span>
        {#if liveSet.has(c.id)}
          <span class="tr-live" title="JKAI is working on this" aria-label="Live job"></span>
        {/if}
        <span class="tr-title" class:untitled={!c.title?.trim()}>{rowTitle(c)}</span>
        {#if c.pinned}<span class="tr-flag" title="Pinned" aria-hidden="true">◆</span>{/if}
        {#if c.shareVisibility && c.shareVisibility !== 'private'}
          <span
            class="tr-flag"
            title={`Shared · ${c.shareVisibility === 'public' ? 'anyone with the link' : 'signed-in users'}`}
            aria-hidden="true">↗</span
          >
        {/if}
      </div>
      {#if metaChunks(c).length > 0}
        <div class="tr-meta">
          {#each metaChunks(c) as chunk, i (i)}
            {#if i > 0}<span class="tr-sep" aria-hidden="true">/</span>{/if}
            <span>{chunk}</span>
          {/each}
        </div>
      {/if}

      <!-- Hover actions (each button stops propagation so the row isn't selected) -->
      <div class="actions">
        {#if confirmingDeleteId === c.id}
          <button class="act danger" onclick={(e) => confirmDelete(e, c)} title="Confirm delete" aria-label="Confirm delete">✓</button>
          <button class="act" onclick={cancelDelete} title="Cancel" aria-label="Cancel delete">✕</button>
        {:else}
          <button class="act" onclick={(e) => togglePin(e, c)} title={c.pinned ? 'Unpin' : 'Pin'} aria-label={c.pinned ? 'Unpin' : 'Pin'}>◆</button>
          <button class="act" onclick={(e) => startRename(e, c)} title="Rename" aria-label="Rename">/</button>
          <button class="act" onclick={(e) => share(e, c)} title="Share" aria-label="Share">↗</button>
          <button class="act danger" onclick={(e) => askDelete(e, c)} title="Delete" aria-label="Delete">✕</button>
        {/if}
      </div>
    </div>
  {/if}
{/snippet}

<style>
  /* ---- 236px thread rail ---- */
  .sb {
    width: 236px;
    flex: none;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    border-right: 1px solid var(--divider);
    background: var(--bg-section);
  }

  .rail-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    color: var(--text-ghost);
  }

  .sb-hd {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    border-bottom: 1px solid var(--divider);
    flex: none;
  }
  .sb-hd-btns {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .collapse-btn {
    width: 20px;
    height: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    padding: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-ghost);
    cursor: pointer;
    transition: color 0.2s ease-out;
  }
  .collapse-btn:hover {
    color: var(--accent);
  }
  .new-btn {
    width: 20px;
    height: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: var(--radius-sharp);
    font-family: var(--font-mono);
    font-size: var(--fs-nav);
    font-weight: 500;
    line-height: 1;
    cursor: pointer;
    transition: background 0.2s ease-out;
  }
  .new-btn:hover {
    background: var(--accent-hover);
  }

  .search {
    position: relative;
    padding: 6px 6px 0;
    flex: none;
  }
  .search input {
    width: 100%;
    padding: 6px 22px 6px 8px;
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp);
    background: transparent;
    font-family: var(--font-mono);
    font-size: var(--fs-body);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-primary);
  }
  .search input::placeholder {
    color: var(--text-ghost);
  }
  .search input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .search-clear {
    position: absolute;
    right: 12px;
    top: 50%;
    transform: translateY(-25%);
    border: none;
    background: none;
    padding: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    cursor: pointer;
  }
  .search-clear:hover {
    color: var(--accent);
  }

  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 6px;
  }

  .sec-hd {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 9px 4px 4px;
    background: none;
    border: none;
    cursor: pointer;
  }
  .sec-cnt {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.08em;
    color: var(--text-ghost);
  }

  /* row */
  .thread-row {
    position: relative;
    display: block;
    width: 100%;
    text-align: left;
    padding: 9px 10px;
    margin-bottom: 2px;
    border: 1px solid transparent;
    border-radius: var(--radius-sharp);
    background: transparent;
    cursor: pointer;
    transition: background 0.2s ease-out, border-color 0.2s ease-out;
  }
  .thread-row:hover {
    background: var(--accent-tint-04);
  }
  .thread-row.active {
    border-color: var(--accent-tint-25);
    background: rgba(196, 87, 10, 0.1);
  }
  .thread-row:focus-visible {
    outline: none;
    border-color: var(--accent);
  }

  .tr-top {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .tr-idx {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    color: var(--text-ghost);
    flex: none;
  }
  .tr-title {
    flex: 1;
    min-width: 0;
    font-family: var(--font-body);
    font-size: var(--fs-label);
    font-weight: 500;
    line-height: 1.3;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  /* A borrowed first line is standing in for a title, so it reads a shade
     quieter than one the titler actually chose. */
  .tr-title.untitled {
    font-weight: 400;
    color: var(--text-muted);
  }
  .tr-flag {
    flex: none;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--accent);
    opacity: 0.8;
  }
  .tr-live {
    width: 5px;
    height: 5px;
    flex: none;
    border-radius: var(--radius-pill);
    background: var(--accent);
    animation: rail-pulse 1.5s ease-in-out infinite;
  }
  @keyframes rail-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.35;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .tr-live {
      animation: none;
    }
  }

  .tr-meta {
    display: flex;
    align-items: baseline;
    gap: 4px;
    margin-top: 5px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-ghost);
    white-space: nowrap;
    overflow: hidden;
  }
  .tr-sep {
    opacity: 0.4;
  }

  /* hover action cluster */
  .actions {
    position: absolute;
    right: 6px;
    top: 5px;
    display: flex;
    gap: 1px;
    background: var(--surface-elevated);
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp);
    padding: 1px;
    opacity: 0;
    transition: opacity 0.2s ease-out;
  }
  .thread-row:hover .actions,
  .thread-row:focus-within .actions {
    opacity: 1;
  }
  .act {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 18px;
    border: none;
    background: none;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    cursor: pointer;
    transition: color 0.2s ease-out, background 0.2s ease-out;
  }
  .act:hover {
    background: var(--accent-tint-08);
    color: var(--accent);
  }
  .act.danger:hover {
    background: var(--error-bg);
    color: var(--error);
  }

  /* rename */
  .rename-row {
    padding: 6px 10px;
  }
  .rename-input {
    width: 100%;
    padding: 5px 7px;
    border: 1px solid var(--accent);
    border-radius: var(--radius-sharp);
    background: var(--bg);
    font-family: var(--font-body);
    font-size: var(--fs-body);
    color: var(--text-primary);
  }
  .rename-input:focus {
    outline: none;
  }

  /* empty state */
  .empty {
    padding: 26px 12px;
    text-align: center;
  }
  .empty-big {
    font-family: var(--font-body);
    font-size: var(--fs-label);
    color: var(--text-muted);
  }
  .empty-sm {
    font-family: var(--font-body);
    font-size: var(--fs-label);
    color: var(--text-ghost);
    margin-top: 3px;
  }

  /* One footer block: drafts, channel state, throughput. */
  .rail-foot {
    flex: none;
    border-top: 1px solid var(--divider);
    padding: 10px 12px;
    background: var(--bg-section);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  /* DraftsPanel brings its own padding and rule; inside the footer it is one
     line among several, so strip them. */
  .rail-foot :global(.drafts-panel) {
    padding: 0;
    border-top: none;
  }
  .channel-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
    transition: color 0.2s ease-out;
  }
  .channel-row.static {
    cursor: default;
  }
  .channel-row:not(.static):hover .channel-name {
    color: var(--text-primary);
  }
  .channel-row.active .channel-name {
    color: var(--accent);
  }
  .channel-state {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--accent);
  }
  .channel-state.idle {
    color: var(--text-ghost);
  }
  .channel-dot {
    width: 5px;
    height: 5px;
    border-radius: var(--radius-pill);
    background: var(--accent);
  }

  /* ---- collapsed rail ---- */
  .rail {
    width: 44px;
    flex: none;
    height: 100%;
    border-right: 1px solid var(--divider);
    background: var(--bg-section);
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 10px 0;
    gap: 8px;
  }
  .rbtn {
    width: 20px;
    height: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp);
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-muted);
    background: none;
    cursor: pointer;
    transition: background 0.2s ease-out, color 0.2s ease-out, border-color 0.2s ease-out;
  }
  .rbtn:hover {
    color: var(--accent);
    border-color: var(--accent-tint-35);
  }
  .rbtn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
    font-size: var(--fs-nav);
  }
  .rbtn.primary:hover {
    background: var(--accent-hover);
    color: #fff;
  }
  .rail-sep {
    width: 20px;
    height: 1px;
    background: var(--divider);
    margin: 2px 0;
  }
  .rail-dots {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    overflow: hidden;
  }
  .cdot {
    width: 7px;
    height: 7px;
    border-radius: var(--radius-pill);
    background: var(--card-border);
    border: none;
    padding: 0;
    cursor: pointer;
    transition: background 0.2s ease-out;
  }
  .cdot:hover {
    background: var(--text-muted);
  }
  .cdot.active {
    background: var(--accent);
  }
  .cdot.live {
    background: var(--accent);
    animation: rail-pulse 1.5s ease-in-out infinite;
  }
  .rail-spacer {
    flex: 1;
  }
</style>
