<script lang="ts">
  import ThreadLibrary from '$lib/components/jkai/ThreadLibrary.svelte';
  import ConversationTabs from '$lib/components/jkai/ConversationTabs.svelte';
  import ShareConversationModal from '$lib/components/jkai/ShareConversationModal.svelte';
  import ChatArea from '$lib/components/jkai/ChatArea.svelte';
  import BriefingCard from '$lib/components/jkai/BriefingCard.svelte';
  import ContextRail from '$lib/components/jkai/ContextRail.svelte';
  import type { ModelContext } from '$lib/server/models/types';
  import { onMount, untrack } from 'svelte';
  import { hub, setLiveRuns, closeGraphSheet } from '$lib/jkai/hub-bus.svelte';
  import { forgetQueued } from '$lib/jkai/queued-sends.svelte';
  import {
    openTabs,
    openTab,
    closeTab,
    activateTab,
    cycleTab,
    forgetTab,
    setTabActivity,
    restoreTabs,
    readStoredTabs,
    hasTab,
    MAX_TABS,
    type TabView,
  } from '$lib/jkai/open-tabs.svelte';

  let { data } = $props();

  let conversationList = $state(data.conversations);
  let conversationsHasMore = $state(untrack(() => data.conversationsHasMore === true));
  let conversationsLoadingMore = $state(false);
  let conversationCursor = $state(untrack(() => data.conversationCursor));
  let whatsappThread = $state(data.whatsappThread);
  // The knowledge-graph rail collapses behind a header toggle below 1280px.
  let graphRailOpen = $state(true);
  // The old permanent left rail has become a centred library. Open work lives
  // in the tab strip; the archive only takes screen space while it is in use.
  let libraryOpen = $state(false);
  // Conversation IDs the orchestrator currently has a running job for.
  // Polled every 10 s; the library and tab strip render live state. Updated
  // whenever the user returns so work continued in the background is visible.
  let liveConversationIds = $state<string[]>([]);

  /**
   * Everything one mounted chat pane needs. Fetched once, when the tab opens,
   * and then LEFT ALONE: `ChatArea` maps `initialMessages` into its own live
   * transcript inside an effect, so rewriting this array would wipe out
   * whatever the pane has streamed since.
   */
  interface PaneData {
    messages: any[];
    conversation: {
      modelProvider?: string;
      modelId?: string;
      thinkingLevel?: string | null;
      /** Whether the owner CHOSE this model rather than inheriting the site
       *  default. What makes the rest of the session follow it. */
      modelPinnedByUser?: boolean;
    } | null;
    modelCaps: { image: boolean; audio: boolean; video: boolean; pdf: boolean; documentText: boolean } | null;
    contextLength: number | null;
    /** Whether the pinned model takes a reasoning instruction — gates the
     *  composer's thinking chip. */
    supportsThinking: boolean;
    activeBuild: { id: string; status: string } | null;
    hasOlderMessages: boolean;
    messageCursor: { before: string; beforeId: string } | null;
  }
  let panes = $state<Record<string, PaneData>>({});
  // Threads whose history is in flight. A plain Set: nothing reactive reads it,
  // and making it $state would subscribe the loader to its own writes.
  const loadingPanes = new Set<string>();

  const activeId = $derived(openTabs.activeId);

  const LAST_VISIT_STORAGE_KEY = 'jkai.lastVisit';
  const LAST_CONV_STORAGE_KEY = 'jkai.lastConversationId';
  const RESUME_WINDOW_MS = 2 * 60 * 60 * 1000;

  /** Named the same way the rail names a row, so strip and rail never disagree. */
  function titleFor(id: string): string {
    const c = conversationList.find((x) => x.id === id);
    if (!c) return 'thread';
    if (c.title?.trim()) return c.title.trim();
    const first = c.lastMessage?.trim().split('\n')[0];
    return first || 'new thread';
  }

  /**
   * Tab labels are resolved here rather than stored in the tab list, so a rename
   * in the rail reaches the strip without a second copy to keep in step.
   */
  const tabViews = $derived<TabView[]>(
    openTabs.items.map((t) => {
      const full = titleFor(t.id);
      const note =
        t.activity === 'running' ? ' — working'
        : t.activity === 'reply' ? ' — replied while you were away'
        : t.activity === 'error' ? ' — that turn failed'
        : '';
      return {
        id: t.id,
        label: full.length > 34 ? `${full.slice(0, 33)}…` : full,
        activity: t.activity,
        title: `${full}${note}`,
      };
    }),
  );

  onMount(() => {
    let resumed = false;
    /**
     * `?new=1` forces a fresh conversation, skipping BOTH resume paths below.
     *
     * The Intel dashboard hands over a prompt loaded with what the graph knows.
     * Without this it landed in whatever thread happened to be open — so a
     * question about two entities arrived halfway through an unrelated
     * conversation and inherited its context, which is exactly the thing that
     * makes the answer wrong.
     */
    let forceNew = false;
    try {
      forceNew = new URLSearchParams(window.location.search).get('new') === '1';
    } catch {
      // ignore URL parse failures
    }

    // 1) Deep-link from a WhatsApp escalation: ?c=<convId>. If it matches a
    // known conversation we open it; otherwise we fall through to the
    // localStorage-based resume so the URL doesn't strand the user.
    let deepLinkId: string | null = null;
    try {
      const params = new URLSearchParams(window.location.search);
      const id = params.get('c');
      if (!forceNew && id && conversationList.some((c) => c.id === id)) deepLinkId = id;
    } catch {
      // ignore URL parse failures
    }

    // 2) The tab set from the last visit. Restoring the whole working set is
    // the point of having tabs — coming back to one of three open threads is
    // the same as not having them. Ids for threads that have since been
    // deleted are dropped rather than restored as tabs that 404 on open.
    if (!forceNew) {
      const stored = readStoredTabs();
      const live = stored.ids.filter((id) => conversationList.some((c) => c.id === id));
      if (live.length > 0) {
        // A deep link is a destination, not a suggestion — a WhatsApp escalation
        // that landed you on somebody else's thread because the strip happened to
        // be full would be worse than dropping the oldest restored tab. So it
        // gets a slot reserved before the saved set is trimmed to fit.
        const needsRoom = deepLinkId !== null && !live.includes(deepLinkId);
        const room = needsRoom ? MAX_TABS - 1 : MAX_TABS;
        restoreTabs(live.slice(0, room), deepLinkId ?? stored.activeId);
        for (const tab of openTabs.items) void loadPane(tab.id);
        if (deepLinkId && !hasTab(deepLinkId)) selectConversation(deepLinkId);
        resumed = true;
      }
    }

    if (!resumed && deepLinkId) {
      selectConversation(deepLinkId);
      resumed = true;
    }

    // 3) Single-thread resume, for a visit that predates any saved tab set.
    if (!resumed && !forceNew) {
      try {
        const lastVisitStr = localStorage.getItem(LAST_VISIT_STORAGE_KEY);
        const lastConvId = localStorage.getItem(LAST_CONV_STORAGE_KEY);
        const lastVisit = lastVisitStr ? Number(lastVisitStr) : 0;
        const withinWindow = Number.isFinite(lastVisit) && Date.now() - lastVisit < RESUME_WINDOW_MS;
        if (withinWindow && lastConvId && conversationList.some((c) => c.id === lastConvId)) {
          selectConversation(lastConvId);
          resumed = true;
        }
      } catch {
        // localStorage unavailable — fall through to creating a fresh conversation.
      }
    }
    if (!resumed) {
      createConversation();
    }

    // `q` was consumed by the server load and seeded into the composer. Strip it
    // for the same reason `new` is stripped: left in place, a refresh would
    // silently re-seed the box over whatever the user had started typing.
    if (data.pendingQuestion) {
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete('q');
        history.replaceState(history.state, '', url);
      } catch {
        // ignore
      }
    }

    // Drop `new` from the URL once it has been acted on. Left in place, a
    // refresh would create yet another empty conversation every time.
    if (forceNew) {
      try {
        const url = new URL(window.location.href);
        url.searchParams.delete('new');
        history.replaceState(history.state, '', url);
      } catch {
        // ignore
      }
    }

    try {
      localStorage.setItem(LAST_VISIT_STORAGE_KEY, String(Date.now()));
    } catch {
      // ignore
    }

    const refreshLive = async () => {
      try {
        const res = await fetch('/api/workflows/orchestrator/chat/active');
        if (!res.ok) return;
        const data = await res.json() as { jobs: Array<{ conversationId: string; jobId: string }> };
        liveConversationIds = data.jobs.map((j) => j.conversationId);
        // Keep the header's `● N RUNS` chunk honest between navigations.
        setLiveRuns(liveConversationIds.length);
      } catch {
        // ignore — next tick will retry
      }
    };

    // Presence heartbeat: while this tab is visible and viewing a conversation,
    // tell the server we're actively watching. wa-escalation uses this to
    // suppress WhatsApp pings while we're here — and, because we stop beating
    // when the tab is hidden/closed, to detect when we've navigated away.
    //
    // Presence follows the tab on screen, not every open tab: a thread mounted
    // in the background is still one the user is not reading, so escalating it
    // to WhatsApp is the right call.
    const sendPresence = () => {
      if (document.visibilityState !== 'visible') return;
      const convId = openTabs.activeId;
      if (!convId) return;
      void fetch('/api/workflows/orchestrator/chat/presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: convId }),
        keepalive: true,
      }).catch(() => { /* ignore — next beat retries */ });
    };

    let liveTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleTick = () => {
      if (liveTimer !== null) clearTimeout(liveTimer);
      liveTimer = null;
      if (document.visibilityState !== 'visible') return;
      liveTimer = setTimeout(async () => {
        liveTimer = null;
        await refreshLive();
        sendPresence();
        scheduleTick();
      }, 10_000);
    };
    const tickNow = () => {
      void refreshLive();
      sendPresence();
      scheduleTick();
    };
    tickNow();
    // Refresh both activity and presence immediately on return-to-tab. Hidden
    // JKAI tabs now have no recurring timer and make no active-job requests.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') tickNow();
      else if (liveTimer !== null) {
        clearTimeout(liveTimer);
        liveTimer = null;
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      if (liveTimer !== null) clearTimeout(liveTimer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  });

  function rememberConversation(id: string) {
    try {
      localStorage.setItem(LAST_CONV_STORAGE_KEY, id);
    } catch {
      // ignore
    }
  }

  /**
   * Fetch a thread's history once, for the pane that is about to render it.
   *
   * The pane is only created when the history is in hand. Mounting an empty one
   * first and filling it afterwards would reassign `initialMessages`, and the
   * effect in ChatArea that maps that prop into its live transcript would wipe
   * anything the user had already sent in the meantime.
   */
  async function loadPane(id: string): Promise<void> {
    if (panes[id] || loadingPanes.has(id)) return;
    loadingPanes.add(id);
    try {
      const res = await fetch(`/api/jkai/conversations/${id}`);
      if (!res.ok) {
        // Render it anyway: an empty thread with a working composer beats a
        // permanently blank column, and the history returns on the next open.
        panes[id] = { messages: [], conversation: null, modelCaps: null, contextLength: null, supportsThinking: false, activeBuild: null, hasOlderMessages: false, messageCursor: null };
        return;
      }
      const body = await res.json();
      panes[id] = {
        messages: body.messages || [],
        conversation: body.conversation || null,
        modelCaps: body.modelCapabilities || null,
        contextLength: body.modelContextLength ?? null,
        supportsThinking: body.modelSupportsThinking === true,
        activeBuild: body.activeBuild || null,
        hasOlderMessages: body.hasOlderMessages === true,
        messageCursor: body.messageCursor ?? null,
      };
    } catch {
      panes[id] = { messages: [], conversation: null, modelCaps: null, contextLength: null, supportsThinking: false, activeBuild: null, hasOlderMessages: false, messageCursor: null };
    } finally {
      loadingPanes.delete(id);
    }
  }

  /** Open a thread in a tab, loading it if this is the first time. */
  function selectConversation(id: string) {
    libraryOpen = false;
    if (!openTab(id)) return;
    rememberConversation(id);
    void loadPane(id);
  }

  async function createConversation() {
    if (openTabs.items.length >= MAX_TABS) {
      openTabs.limitHit = true;
      return;
    }
    try {
      const res = await fetch('/api/jkai/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'web' }),
      });
      if (res.ok) {
        const conv = await res.json();
        conversationList = [
          { ...conv, messageCount: 0, lastMessage: null },
          ...conversationList,
        ];
        // A new thread has nothing to fetch — seed the pane directly so it
        // renders without a round trip.
        panes[conv.id] = {
          messages: [],
          conversation: conv,
          modelCaps: null,
          contextLength: null,
          supportsThinking: conv.modelSupportsThinking === true,
          activeBuild: null,
          hasOlderMessages: false,
          messageCursor: null,
        };
        openTab(conv.id);
        rememberConversation(conv.id);
        libraryOpen = false;
      }
    } catch (err) {
      console.error('Failed to create conversation:', err);
    }
  }

  async function loadMoreConversations() {
    if (!conversationsHasMore || !conversationCursor || conversationsLoadingMore) return;
    conversationsLoadingMore = true;
    try {
      const query = new URLSearchParams({
        limit: '80',
        before: conversationCursor.before,
        beforeId: conversationCursor.beforeId,
        beforePinned: conversationCursor.pinned ? '1' : '0',
      });
      const res = await fetch(`/api/jkai/conversations?${query}`);
      if (!res.ok) return;
      const page = await res.json() as {
        items?: typeof conversationList;
        hasMore?: boolean;
        cursor?: typeof conversationCursor;
      };
      const items = page.items ?? [];
      const known = new Set(conversationList.map((conversation) => conversation.id));
      conversationList = [
        ...conversationList,
        ...items.filter((conversation) => !known.has(conversation.id)),
      ];
      conversationsHasMore = page.hasMore === true;
      conversationCursor = page.cursor ?? null;
    } catch (err) {
      console.error('Failed to load more conversations:', err);
    } finally {
      conversationsLoadingMore = false;
    }
  }

  // The WhatsApp thread IS a real conversation (source 'whatsapp') whose full
  // history lives in orchestrator_chats. Open it directly so the continuation
  // carries the WhatsApp history (visible + as model context); typing on web
  // appends to the same unified thread. (Formerly this spun up a separate,
  // empty 'whatsapp-continuation' conversation.)
  function selectWhatsApp() {
    if (!whatsappThread?.id) return;
    selectConversation(whatsappThread.id);
  }

  async function deleteConversation(id: string) {
    try {
      await fetch(`/api/jkai/conversations/${id}`, { method: 'DELETE' });
      conversationList = conversationList.filter((c) => c.id !== id);
      forgetTab(id);
      forgetQueued(id);
      delete panes[id];
    } catch (err) {
      console.error('Failed to delete conversation:', err);
    }
  }

  async function renameConversation(id: string, title: string) {
    const next = title.trim();
    // Optimistic: apply locally, then persist. Empty title clears back to null.
    conversationList = conversationList.map((c) =>
      c.id === id ? { ...c, title: next || null } : c,
    );
    try {
      await fetch(`/api/jkai/conversations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: next }),
      });
    } catch (err) {
      console.error('Failed to rename conversation:', err);
    }
  }

  // --- Conversation sharing ---
  type ShareConv = { id: string; title: string | null; shareToken?: string | null; shareVisibility?: string | null };
  let shareModalConv = $state<ShareConv | null>(null);
  function openShare(c: ShareConv) {
    shareModalConv = { id: c.id, title: c.title, shareToken: c.shareToken, shareVisibility: c.shareVisibility };
  }
  function handleShareUpdate(id: string, visibility: string, shareToken: string | null) {
    conversationList = conversationList.map((c) =>
      c.id === id ? { ...c, shareVisibility: visibility, shareToken } : c,
    );
    if (shareModalConv?.id === id) {
      shareModalConv = { ...shareModalConv, shareVisibility: visibility, shareToken };
    }
  }

  async function togglePinConversation(id: string, pinned: boolean) {
    // Optimistic: flip locally + re-sort pinned-first, then persist.
    conversationList = conversationList
      .map((c) => (c.id === id ? { ...c, pinned } : c))
      .slice()
      .sort((a, b) => {
        if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
    try {
      await fetch(`/api/jkai/conversations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned }),
      });
    } catch (err) {
      console.error('Failed to (un)pin conversation:', err);
    }
  }

  /**
   * A pane reporting that it has started or stopped working.
   *
   * `reply` is only ever set on a tab the user is not looking at — that badge
   * exists to say "something landed elsewhere", so stamping it on the thread in
   * front of them would be noise.
   */
  function handleBusyChange(id: string, busy: boolean, ok: boolean) {
    if (busy) {
      setTabActivity(id, 'running');
      return;
    }
    if (!ok) {
      setTabActivity(id, 'error');
      return;
    }
    setTabActivity(id, id === openTabs.activeId ? 'idle' : 'reply');
  }

  function handleModelChange(id: string, ctx: ModelContext, supportsThinking?: boolean) {
    const pane = panes[id];
    if (!pane) return;
    pane.conversation = {
      ...(pane.conversation ?? {}),
      modelProvider: ctx.provider,
      modelId: ctx.modelId,
      // The switch only reaches here on a PATCH that succeeded, and that PATCH
      // is what pins the session. Recording it locally keeps the composer's
      // no-op guard honest — otherwise re-picking the same model would fire a
      // second, pointless PATCH every time.
      modelPinnedByUser: true,
    };
    // Undefined means the switch reported nothing (an older response shape) —
    // leave the chip as it was rather than guessing it away.
    if (supportsThinking !== undefined) pane.supportsThinking = supportsThinking;
  }
</script>

<svelte:head>
  <title>JKAI — Chat</title>
</svelte:head>

<div class="thread-shell">
  <!-- Conversation column -->
  <div class="chat-slot">
    <!--
      The strip comes FIRST, before the briefing. It is chrome and belongs
      against the bottom of the hub header; the briefing is content in the
      conversation column. The other way round, a briefing pushed the tab bar
      down by its whole height — and, worse, by 12px even when there was no
      card to see, because BriefingCard renders nothing once dismissed while
      the slot kept its padding.
    -->
    <ConversationTabs
      tabs={tabViews}
      activeId={activeId}
      canOpenMore={openTabs.items.length < MAX_TABS}
      limitHit={openTabs.limitHit}
      onOpenLibrary={() => (libraryOpen = true)}
      onToggleGraph={() => (graphRailOpen = !graphRailOpen)}
      graphOpen={graphRailOpen}
      onActivate={activateTab}
      onClose={closeTab}
      onNew={createConversation}
      onCycle={cycleTab}
    />

    {#if data.freshBriefing}
      <div class="briefing-slot">
        <BriefingCard briefing={data.freshBriefing} />
      </div>
    {/if}

    <!--
      One mounted pane per open tab, hidden rather than destroyed when it is not
      the one on screen. That is what makes several threads run at once: a pane
      owns its chat stream, composer draft, tool cards and progress bubble for
      its whole life, so a running turn cannot follow the user into another
      thread — which is exactly what used to happen, because `chatStream` was
      closed only by an explicit cancel.
    -->
    {#each openTabs.items as tab (tab.id)}
      {@const pane = panes[tab.id]}
      {#if pane}
        <div class="pane" class:on-screen={tab.id === activeId}>
          <ChatArea
            conversationId={tab.id}
            initialMessages={pane.messages}
            initialDraft={tab.id === activeId ? data.pendingQuestion : ''}
            autoSend={tab.id === activeId && data.pendingSend}
            conversation={pane.conversation}
            modelContextLength={pane.contextLength}
            modelSupportsThinking={pane.supportsThinking}
            modelCapabilities={pane.modelCaps}
            defaultChatModelId={data.defaultChatModel.modelId}
            altOpenRouterModel={data.chatAltOpenRouterModel}
            messageCount={pane.messages.length}
            approvalUi={data.approvalUi}
            activeBuild={pane.activeBuild}
            initialHasOlderMessages={pane.hasOlderMessages}
            initialMessageCursor={pane.messageCursor}
            active={tab.id === activeId}
            dailyAlerts={data.dailyAlerts}
            recentThreads={conversationList}
            onselectthread={selectConversation}
            onopenlibrary={() => (libraryOpen = true)}
            onbusychange={(busy, ok) => handleBusyChange(tab.id, busy, ok)}
            onmodelchange={(ctx: ModelContext, supportsThinking?: boolean) =>
              handleModelChange(tab.id, ctx, supportsThinking)}
          />
        </div>
      {/if}
    {/each}

    {#if activeId && !panes[activeId]}
      <p class="pane-loading">Opening thread…</p>
    {/if}
  </div>

  <!-- Contextual workspace / phone bottom sheet. -->
  <div class="graph-slot" class:collapsed={!graphRailOpen} class:sheet-open={hub.graphSheet !== 'closed'}>
    <!-- The inspector reads the thread ledger straight off the hub bus now, so
         the page no longer relays two of its numbers as props. -->
    <ContextRail
      conversationId={activeId}
      sheetDetent={hub.graphSheet}
      onCloseSheet={closeGraphSheet}
    />
  </div>
  {#if hub.graphSheet !== 'closed'}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="sheet-scrim" onclick={closeGraphSheet}></div>
  {/if}
</div>

{#if libraryOpen}
  <ThreadLibrary
    conversations={conversationList}
    {whatsappThread}
    activeConversationId={activeId}
    onSelect={selectConversation}
    onWhatsAppSelect={selectWhatsApp}
    onDelete={deleteConversation}
    onRename={renameConversation}
    onTogglePin={togglePinConversation}
    onShare={openShare}
    onNew={createConversation}
    onClose={() => (libraryOpen = false)}
    {liveConversationIds}
    openTabIds={openTabs.items.map((t) => t.id)}
    hasMore={conversationsHasMore}
    loadingMore={conversationsLoadingMore}
    onLoadMore={loadMoreConversations}
  />
{/if}

{#if shareModalConv}
  <ShareConversationModal
    conversation={shareModalConv}
    onClose={() => (shareModalConv = null)}
    onUpdate={handleShareUpdate}
  />
{/if}

<style>
  /* Two columns: the conversation and its contextual workspace. The thread
     archive is a modal library now, so reading width no longer pays for it. */
  .thread-shell {
    position: relative;
    display: flex;
    flex: 1;
    min-height: 0;
    background: var(--bg);
  }
  .chat-slot {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  /* Background panes stay mounted and keep streaming; `display: none` is the
     whole of their cost. It also hides their composer, so a keystroke can only
     ever reach the thread on screen. */
  .pane {
    display: none;
    flex: 1;
    min-height: 0;
    min-width: 0;
  }
  .pane.on-screen {
    display: flex;
    flex-direction: column;
  }
  .pane-loading {
    flex: 1;
    margin: 0;
    padding: 24px 20px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: var(--tracking-label);
    color: var(--text-muted);
  }
  /* Padded only when it actually holds a card. `BriefingCard` renders nothing
     once dismissed — and starts dismissed, to avoid an SSR flash — so an
     unconditional padding put a 12px band of background under the hub header on
     every load of a day that had a briefing. `:has` failing open costs nothing:
     the fallback is no padding, which is the state we want anyway.

     `:global(*)` is load-bearing, not decoration. Written `:has(> *)`, Svelte
     scopes the inner `*` too, finds nothing in this component's own markup that
     could match it — the only child is a COMPONENT, whose root carries a
     different hash — and prunes the whole rule as unused. It compiles away to
     nothing and a briefing then sits flush against the tab strip. That is a
     `css_unused_selector` warning, not an error, so nothing in the gate stops
     it. */
  .briefing-slot {
    flex: none;
  }
  .briefing-slot:has(> :global(*)) {
    padding: 12px 20px 0;
  }
  .graph-slot {
    flex: none;
    display: flex;
    min-height: 0;
  }
  .graph-slot.collapsed {
    display: none;
  }
  .sheet-scrim {
    display: none;
  }

  /* Below 1280px the context workspace collapses behind its strip control. */
  @media (max-width: 1279px) {
    .graph-slot:not(.sheet-open) {
      display: none;
    }
  }

  /* <800: the graph rail is a bottom sheet over the thread (2b). */
  @media (max-width: 799px) {
    .graph-slot.sheet-open {
      display: flex;
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      top: 0;
      z-index: 40;
      pointer-events: none;
    }
    .sheet-scrim {
      display: block;
      position: absolute;
      inset: 0;
      z-index: 35;
      background: rgba(26, 16, 8, 0.2);
    }
    .briefing-slot:has(> :global(*)) {
      padding: 10px 16px 0;
    }
  }
</style>
