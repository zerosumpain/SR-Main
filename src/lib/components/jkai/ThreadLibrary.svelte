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
    /** Search only — which surfaces the term hit. See `searchConversationList`. */
    matchedIn?: string[];
    /** Search only — a window of the message body around the hit. */
    matchExcerpt?: string | null;
    /** Search only — the capabilities whose names matched. */
    matchedTools?: string[];
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
    hasMore = false,
    loadingMore = false,
    onLoadMore,
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
    hasMore?: boolean;
    loadingMore?: boolean;
    onLoadMore?: () => void;
    liveConversationIds?: string[];
    openTabIds?: string[];
  } = $props();

  /** Below this the term matches most of the archive, which is not an answer. */
  const MIN_QUERY = 2;

  let query = $state('');
  let results = $state<ConversationItem[] | null>(null);
  let searching = $state(false);
  let searchFailed = $state(false);
  let searchInput: HTMLInputElement | undefined = $state();
  let renamingId = $state<string | null>(null);
  let renameDraft = $state('');
  let confirmingDeleteId = $state<string | null>(null);

  // Plain handles, never $state — a timer and a sequence counter that helpers
  // both read and clear are the read-own-write loop the svelte5-pitfalls skill
  // exists to prevent.
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  let searchSeq = 0;

  const liveSet = $derived(new Set(liveConversationIds));
  const openSet = $derived(new Set(openTabIds));
  const searchActive = $derived(query.trim().length >= MIN_QUERY);
  const loaded = $derived(conversations.filter((c) => c.source !== 'whatsapp'));

  const threads = $derived.by(() => {
    // A search is answered by the server over the WHOLE archive, so its result
    // set replaces the loaded pages rather than filtering them.
    if (searchActive) return (results ?? []).filter((c) => c.source !== 'whatsapp');
    return loaded.slice().sort((a, b) => {
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
    return () => {
      window.removeEventListener('keydown', onKey);
      if (searchTimer) clearTimeout(searchTimer);
    };
  });

  function onQueryInput(value: string) {
    query = value;
    if (searchTimer) clearTimeout(searchTimer);
    const term = value.trim();
    if (term.length < MIN_QUERY) {
      // Retire any answer still in flight, so a slow response cannot repopulate
      // a box that has just been emptied.
      searchSeq++;
      results = null;
      searching = false;
      searchFailed = false;
      return;
    }
    // Set before the debounce, not after it, so the count line reports activity
    // from the keystroke rather than 260ms into it.
    searching = true;
    searchTimer = setTimeout(() => runSearch(term), 260);
  }

  async function runSearch(term: string) {
    const seq = ++searchSeq;
    searching = true;
    searchFailed = false;
    try {
      const res = await fetch(`/api/jkai/conversations?q=${encodeURIComponent(term)}`);
      const body = res.ok ? await res.json() : null;
      // A slower earlier request must not overwrite a newer result set.
      if (seq !== searchSeq) return;
      if (!body) {
        searchFailed = true;
        results = [];
        return;
      }
      results = body.items ?? [];
    } catch {
      if (seq === searchSeq) {
        searchFailed = true;
        results = [];
      }
    } finally {
      if (seq === searchSeq) searching = false;
    }
  }

  function title(c: ConversationItem): string {
    if (c.title?.trim()) return c.title.trim();
    return c.lastMessage?.trim().split('\n')[0]?.slice(0, 72) || 'New thread';
  }

  function excerpt(c: ConversationItem): string {
    // Under search the window around the hit says why the thread is here; the
    // last message would usually not contain the term at all.
    if (searchActive && c.matchExcerpt) {
      const hit = c.matchExcerpt.replace(/\s+/g, ' ').trim();
      if (hit) return `…${hit.length > 108 ? `${hit.slice(0, 107)}…` : `${hit}…`}`;
    }
    const text = c.lastMessage?.replace(/\s+/g, ' ').trim();
    if (!text) return 'An empty thread, ready to use.';
    return text.length > 110 ? `${text.slice(0, 109)}…` : text;
  }

  /** Why this thread is in a result set, when the title does not already say so.
   *  A tool name is a literal identifier (`web_search`), so it is marked to opt
   *  out of the foot's uppercasing — `WEB_SEARCH` is not a thing you can call. */
  function matchBadges(c: ConversationItem): Array<{ label: string; literal: boolean }> {
    if (!searchActive) return [];
    const badges = (c.matchedTools ?? []).slice(0, 2).map((label) => ({ label, literal: true }));
    const where = c.matchedIn ?? [];
    if (where.includes('message') && !where.includes('title')) badges.push({ label: 'in messages', literal: false });
    if (where.includes('model')) badges.push({ label: shortModelLabel(c.modelId) || 'model', literal: false });
    return badges.slice(0, 3);
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
    if (c.messageCount > 0) result.push(`${c.messageCount} msg`);
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
      <label for="thread-search">Search every thread</label>
      <div class="search-wrap">
        <span aria-hidden="true">⌕</span>
        <input
          bind:this={searchInput}
          id="thread-search"
          type="search"
          placeholder="Titles, messages, capabilities, models — the whole archive"
          value={query}
          oninput={(event) => onQueryInput(event.currentTarget.value)}
        />
        <span class="result-count" aria-live="polite">
          {#if searching}Searching…
          {:else if searchFailed}Search failed
          {:else if searchActive}{threads.length} found
          {:else}{threads.length} / {loaded.length}{/if}
        </span>
      </div>
    </div>

    <div class="library-scroll">
      {#if whatsappThread?.phoneNumber && whatsappThread.messages.length > 0 && !searchActive}
        <button type="button" class="channel" class:current={activeConversationId === whatsappThread.id} onclick={onWhatsAppSelect}>
          <span class="live-dot"></span>
          <span><strong>WhatsApp continuation</strong><small>{whatsappThread.phoneNumber} · linked channel</small></span>
          <span class="channel-open">Open →</span>
        </button>
      {/if}

      {#if threads.length === 0}
        <div class="empty">
          {#if searching}
            <strong>Searching the archive…</strong>
            <span>Every thread, not just the ones already loaded.</span>
          {:else if searchFailed}
            <strong>The search could not be run.</strong>
            <span>The archive did not answer. Try again in a moment.</span>
          {:else if searchActive}
            <strong>Nothing matches “{query.trim()}”.</strong>
            <span>Titles, message bodies, capability names and models were all checked.</span>
          {:else}
            <strong>No threads yet.</strong>
            <span>Start a clean thread to begin.</span>
          {/if}
        </div>
      {:else}
        <div class="thread-grid">
          {#each threads as c (c.id)}
            <article class="thread-card" class:current={activeConversationId === c.id} class:running={liveSet.has(c.id)}>
              {#if renamingId === c.id}
                <form class="rename" onsubmit={(event) => { event.preventDefault(); commitRename(); }}>
                  <input bind:value={renameDraft} aria-label="Thread title" />
                  <button type="submit">Save</button>
                  <button type="button" onclick={() => (renamingId = null)}>Cancel</button>
                </form>
              {:else}
                <button type="button" class="thread-open" onclick={() => onSelect(c.id)}>
                  <span class="card-head">
                    {#if liveSet.has(c.id)}
                      <span class="state"><span class="pulse"></span><span class="vh">working</span></span>
                    {:else if openSet.has(c.id)}<span class="state">open</span>
                    {:else if c.pinned}<span class="state">pin</span>{/if}
                    <strong>{title(c)}</strong>
                    <span class="age">{age(c.updatedAt)}</span>
                  </span>
                  <span class="excerpt">{excerpt(c)}</span>
                </button>

                <div class="card-foot">
                  <span class="foot-meta">
                    {#if matchBadges(c).length > 0}
                      {#each matchBadges(c) as badge}<span class="match" class:literal={badge.literal}>{badge.label}</span>{/each}
                    {:else}{meta(c).join(' / ')}{/if}
                  </span>
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
              {/if}
            </article>
          {/each}
        </div>
        {#if hasMore && !searchActive}
          <button type="button" class="load-more" disabled={loadingMore} onclick={onLoadMore}>
            {loadingMore ? 'Loading…' : 'Load older threads'}
          </button>
        {/if}
      {/if}
    </div>

    <footer class="library-foot">
      <span>{searchActive ? 'Searching titles, messages, capabilities and models.' : 'Search, pin and manage the archive here.'}</span>
      <span>Open work stays in the strip behind this window.</span>
    </footer>
  </section>
</div>

<style>
  .library-layer { position:fixed; inset:0; z-index:120; display:grid; place-items:center; padding:24px; }
  .library-scrim { position:absolute; inset:0; width:100%; height:100%; border:0; background:rgba(26,16,8,.56); cursor:default; }
  .library { position:relative; width:min(1120px, 100%); height:min(780px, calc(100dvh - 48px)); display:flex; flex-direction:column; overflow:hidden; border:1px solid var(--text-primary); background:var(--bg); box-shadow:var(--elev-pop); }
  .library-head { display:flex; align-items:flex-end; justify-content:space-between; gap:24px; padding:20px 26px 16px; background:var(--text-primary); color:var(--bg); }
  .eyebrow { display:block; margin-bottom:6px; color:var(--accent-on-dark); font-family:var(--font-mono); font-size:var(--fs-label-xs); text-transform:uppercase; letter-spacing:var(--tracking-label-wide); }
  h1 { margin:0; font-family:var(--font-display); font-size:clamp(1.6rem, 3.4vw, 2.7rem); line-height:.95; text-transform:uppercase; letter-spacing:-.035em; }
  .head-actions { display:flex; align-items:center; gap:8px; }
  .new-thread, .close { height:38px; border:1px solid rgba(237,228,212,.28); background:transparent; color:var(--bg); font-family:var(--font-mono); cursor:pointer; }
  .new-thread { padding:0 14px; font-size:var(--fs-label); text-transform:uppercase; letter-spacing:.08em; }
  .new-thread:hover { border-color:var(--accent-on-dark); color:var(--accent-on-dark); }
  .close { width:38px; font-size:1.45rem; }
  .library-tools { padding:12px 26px; border-bottom:1px solid var(--line-strong); background:var(--surface-rail); }
  .library-tools label { display:block; margin-bottom:4px; color:var(--text-ghost); font-family:var(--font-mono); font-size:var(--fs-label-xs); text-transform:uppercase; letter-spacing:var(--tracking-label); }
  .search-wrap { display:flex; align-items:center; gap:10px; }
  .search-wrap > span:first-child { color:var(--accent); font-size:1.25rem; }
  .search-wrap input { flex:1; min-width:0; padding:6px 0; border:0; border-bottom:1px solid var(--line-strong); outline:0; background:transparent; color:var(--text-primary); font-family:var(--font-body); font-size:var(--fs-body-sm); }
  .search-wrap input:focus { border-bottom-color:var(--accent); }
  .result-count { flex:none; color:var(--text-ghost); font-family:var(--font-mono); font-size:var(--fs-label-xs); white-space:nowrap; }
  .library-scroll { flex:1; min-height:0; overflow:auto; padding:16px 26px 24px; }
  .channel { width:100%; display:flex; align-items:center; gap:12px; margin-bottom:14px; padding:10px 13px; border:1px solid var(--line-strong); background:var(--surface-sunken); color:var(--text-primary); text-align:left; cursor:pointer; }
  .channel.current { border-color:var(--accent); }
  .channel > span:nth-child(2) { display:flex; flex-direction:column; gap:2px; }
  .channel strong { font-size:var(--fs-body-sm); }
  .channel small { color:var(--text-muted); font-size:var(--fs-label-xs); }
  .channel-open { margin-left:auto; color:var(--accent); font-family:var(--font-mono); font-size:var(--fs-label-xs); text-transform:uppercase; }
  .live-dot, .pulse { width:7px; height:7px; border-radius:50%; background:var(--wa-green); }

  /* Four columns of three-row cards. The row this lost was the index strip: a
     decorative 01..81 counter and a state word on a line of their own, both of
     which fit beside the title. 12px is the sitewide floor, so the density has
     to come out of rows and padding — never out of type size. */
  .thread-grid { display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); border-top:1px solid var(--line-strong); border-left:1px solid var(--line-strong); }
  .thread-card { min-width:0; display:flex; flex-direction:column; min-height:76px; border-right:1px solid var(--line-strong); border-bottom:1px solid var(--line-strong); background:var(--bg); }
  .thread-card.current { box-shadow:inset 3px 0 var(--accent); background:var(--accent-tint-04); }
  .thread-card.running { box-shadow:inset 0 2px var(--accent); }
  .thread-open { flex:1; display:flex; flex-direction:column; align-items:stretch; gap:3px; min-width:0; padding:7px 10px 7px; border:0; background:transparent; color:var(--text-primary); text-align:left; cursor:pointer; }
  .thread-open:hover strong { color:var(--accent); }
  .card-head { display:flex; align-items:baseline; gap:6px; min-width:0; }
  .state { flex:none; display:flex; align-items:center; gap:4px; color:var(--accent); font-family:var(--font-mono); font-size:var(--fs-label-xs); text-transform:uppercase; letter-spacing:.06em; }
  .pulse { flex:none; align-self:center; background:var(--accent); animation:pulse 1.5s ease-in-out infinite; }
  .age { flex:none; margin-left:auto; color:var(--text-ghost); font-family:var(--font-mono); font-size:var(--fs-label-xs); text-transform:uppercase; letter-spacing:.06em; }
  .thread-open strong { flex:0 1 auto; min-width:0; overflow:hidden; color:var(--text-primary); font-size:var(--fs-label); line-height:1.3; text-overflow:ellipsis; white-space:nowrap; }
  .excerpt { overflow:hidden; color:var(--text-muted); font-size:var(--fs-label-xs); line-height:1.35; text-overflow:ellipsis; white-space:nowrap; }
  /* Screen-reader text for the working state, which is a dot on screen. */
  .vh { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
  /* Petrol, not the burnt orange: a match badge is ordinary data about the row,
     and the accent is reserved for state (working / pinned / current). */
  .match { flex:none; max-width:100%; overflow:hidden; text-overflow:ellipsis; padding:0 4px; border:1px solid color-mix(in srgb, var(--accent-ink) 34%, transparent); color:var(--accent-ink); font-family:var(--font-mono); font-size:var(--fs-label-xs); letter-spacing:.04em; }
  .match.literal { text-transform:none; letter-spacing:0; }

  /* Meta and actions share one grid cell and cross-fade: at 3 columns there is
     no room for both, and a permanently visible action row is what made the old
     card tall. Opacity keeps the buttons focusable for the keyboard. */
  .card-foot { display:grid; align-items:center; padding:5px 10px; border-top:1px solid var(--line-hair); color:var(--text-ghost); font-family:var(--font-mono); font-size:var(--fs-label-xs); text-transform:uppercase; }
  .card-foot > * { grid-area:1 / 1; min-width:0; }
  /* Under search the badges take this line rather than adding a fourth row —
     why a thread matched is worth more here than its model and cost. */
  .foot-meta { display:flex; align-items:center; gap:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .card-actions { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:7px; opacity:0; transition:opacity .12s ease; }
  .thread-card:hover .card-actions, .thread-card:focus-within .card-actions { opacity:1; }
  .thread-card:hover .foot-meta, .thread-card:focus-within .foot-meta { opacity:0; }
  .card-actions button { padding:0; border:0; background:transparent; color:var(--text-muted); font-family:var(--font-mono); font-size:var(--fs-label-xs); text-transform:uppercase; cursor:pointer; }
  .card-actions button:hover, .card-actions button.active { color:var(--accent); }
  .card-actions button.danger { color:var(--error); }
  .rename { flex:1; display:flex; align-content:flex-start; flex-wrap:wrap; gap:6px; padding:8px 10px; }
  .rename input { width:100%; padding:7px 9px; border:1px solid var(--accent); background:var(--surface-card); color:var(--text-primary); font-size:var(--fs-body-sm); }
  .rename button { padding:4px 8px; border:1px solid var(--line-strong); background:transparent; color:var(--text-muted); font-family:var(--font-mono); font-size:var(--fs-label-xs); text-transform:uppercase; cursor:pointer; }
  .load-more { display:block; margin:16px auto 0; padding:8px 13px; border:1px solid var(--line-strong); background:var(--surface-sunken); color:var(--text-primary); font-family:var(--font-mono); font-size:var(--fs-label-xs); text-transform:uppercase; letter-spacing:.08em; cursor:pointer; }
  .load-more:hover:not(:disabled) { border-color:var(--accent); color:var(--accent); }
  .load-more:disabled { opacity:.55; cursor:wait; }
  .empty { min-height:240px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px; padding:0 20px; border:1px solid var(--line-strong); color:var(--text-muted); text-align:center; }
  .empty strong { color:var(--text-primary); }
  .library-foot { display:flex; justify-content:space-between; gap:20px; padding:9px 26px; border-top:1px solid var(--line-strong); background:var(--surface-rail); color:var(--text-ghost); font-family:var(--font-mono); font-size:var(--fs-label-xs); text-transform:uppercase; letter-spacing:.06em; }
  @keyframes pulse { 50% { opacity:.35; } }
  @media (prefers-reduced-motion:reduce) { .pulse { animation:none; } .card-actions { transition:none; } }

  /* Without a hover to reveal them the actions must always be visible, so the
     foot becomes two stacked rows rather than a cross-fade. */
  @media (hover:none) {
    .card-foot { grid-template-rows:auto auto; row-gap:5px; }
    .card-foot > * { grid-area:auto; }
    .card-actions { opacity:1; justify-content:flex-start; }
    .thread-card:hover .foot-meta { opacity:1; }
  }
  @media (max-width:1100px) { .thread-grid { grid-template-columns:repeat(3, minmax(0,1fr)); } }
  @media (max-width:860px) { .thread-grid { grid-template-columns:repeat(2, minmax(0,1fr)); } }
  @media (max-width:720px) {
    .library-layer { padding:0; place-items:stretch; }
    .library { width:100%; height:100dvh; border:0; }
    .library-head { align-items:flex-start; padding:18px 16px 14px; }
    .new-thread { width:38px; padding:0; overflow:hidden; white-space:nowrap; }
    .new-thread span { display:inline-block; width:36px; }
    .library-tools, .library-scroll { padding-left:16px; padding-right:16px; }
    .thread-grid { grid-template-columns:minmax(0,1fr); }
    .library-foot { padding:8px 16px; }
    .library-foot span:last-child { display:none; }
  }
</style>
