<script lang="ts">
  import ConversationSidebar from '$lib/components/jkai/ConversationSidebar.svelte';
  import ShareConversationModal from '$lib/components/jkai/ShareConversationModal.svelte';
  import ChatArea from '$lib/components/jkai/ChatArea.svelte';
  import BriefingCard from '$lib/components/jkai/BriefingCard.svelte';
  import KnowledgeGraphRail from '$lib/components/jkai/KnowledgeGraphRail.svelte';
  import type { ModelContext } from '$lib/server/models/types';
  import { onMount } from 'svelte';
  import { hub, setLiveRuns, closeGraphSheet } from '$lib/jkai/hub-bus.svelte';

  let { data } = $props();

  let conversationList = $state(data.conversations);
  let whatsappThread = $state(data.whatsappThread);
  let activeConversationId = $state<string | null>(null);
  let activeMessages = $state<any[]>([]);
  let activeConversation = $state<{ modelProvider?: string; modelId?: string } | null>(null);
  let activeContextLength = $state<number | null>(null);
  // The knowledge-graph rail collapses behind a header toggle below 1280px.
  let graphRailOpen = $state(true);
  let activeModelCaps = $state<{ image: boolean; audio: boolean; video: boolean; pdf: boolean; documentText: boolean } | null>(null);
  let activeBuild = $state<{ id: string; status: string } | null>(null);
  let sidebarOpen = $state(false);
  // Desktop sidebar collapsed to an icon rail (persisted across visits).
  let sidebarCollapsed = $state(false);
  const SIDEBAR_COLLAPSED_KEY = 'jkai.sidebarCollapsed';
  function toggleSidebarCollapsed() {
    sidebarCollapsed = !sidebarCollapsed;
    try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? '1' : '0'); } catch { /* ignore */ }
  }
  // Conversation IDs the orchestrator currently has a running job for.
  // Polled every 10 s; the ConversationSidebar renders a pulsing dot next
  // to each. Updated whenever the user returns to the page so the UI
  // reflects work that continued in the background.
  let liveConversationIds = $state<string[]>([]);

  const LAST_VISIT_STORAGE_KEY = 'jkai.lastVisit';
  const LAST_CONV_STORAGE_KEY = 'jkai.lastConversationId';
  const RESUME_WINDOW_MS = 2 * 60 * 60 * 1000;

  onMount(() => {
    try { sidebarCollapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'; } catch { /* ignore */ }
    let resumed = false;
    // 1) Deep-link from a WhatsApp escalation: ?c=<convId>. If it matches a
    // known conversation we open it; otherwise we fall through to the
    // localStorage-based resume so the URL doesn't strand the user.
    try {
      const params = new URLSearchParams(window.location.search);
      const deepLinkId = params.get('c');
      if (deepLinkId && conversationList.some((c) => c.id === deepLinkId)) {
        selectConversation(deepLinkId);
        resumed = true;
      }
    } catch {
      // ignore URL parse failures
    }
    if (!resumed) {
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
    const sendPresence = () => {
      if (document.visibilityState !== 'visible') return;
      const convId = activeConversationId;
      if (!convId) return;
      void fetch('/api/workflows/orchestrator/chat/presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId: convId }),
        keepalive: true,
      }).catch(() => { /* ignore — next beat retries */ });
    };

    const tick = () => { void refreshLive(); sendPresence(); };
    tick();
    const liveTimer = setInterval(tick, 10_000);
    // Beat immediately on return-to-tab so presence is fresh the moment the
    // user comes back, rather than up to 10s stale.
    const onVisibility = () => { if (document.visibilityState === 'visible') sendPresence(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(liveTimer);
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

  async function selectConversation(id: string) {
    activeConversationId = id;
    rememberConversation(id);
    sidebarOpen = false;
    try {
      const res = await fetch(`/api/jkai/conversations/${id}`);
      if (res.ok) {
        const data = await res.json();
        activeMessages = data.messages || [];
        activeConversation = data.conversation || null;
        activeModelCaps = data.modelCapabilities || null;
        activeContextLength = data.modelContextLength ?? null;
        activeBuild = data.activeBuild || null;
      }
    } catch {
      activeMessages = [];
      activeConversation = null;
      activeModelCaps = null;
      activeContextLength = null;
      activeBuild = null;
    }
  }

  async function createConversation() {
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
        activeConversationId = conv.id;
        rememberConversation(conv.id);
        activeConversation = conv;
        activeMessages = [];
        sidebarOpen = false;
      }
    } catch (err) {
      console.error('Failed to create conversation:', err);
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
      if (activeConversationId === id) {
        activeConversationId = null;
        activeMessages = [];
      }
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
</script>

<svelte:head>
  <title>JKAI — Chat</title>
</svelte:head>

<div class="thread-shell">
  <!-- Thread rail (236px). Below 1100px it becomes a slide-over. -->
  <div class="rail-slot" class:open={sidebarOpen}>
    <ConversationSidebar
      conversations={conversationList}
      {whatsappThread}
      {activeConversationId}
      onSelect={selectConversation}
      onNew={createConversation}
      onWhatsAppSelect={selectWhatsApp}
      onDelete={deleteConversation}
      onRename={renameConversation}
      onTogglePin={togglePinConversation}
      onShare={openShare}
      collapsed={sidebarCollapsed}
      onToggleCollapse={toggleSidebarCollapsed}
      {liveConversationIds}
    />
  </div>
  {#if sidebarOpen}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="rail-scrim" onclick={() => (sidebarOpen = false)}></div>
  {/if}

  <!-- Conversation column -->
  <div class="chat-slot">
    {#if data.freshBriefing}
      <div class="briefing-slot">
        <BriefingCard briefing={data.freshBriefing} />
      </div>
    {/if}
    <ChatArea
      conversationId={activeConversationId}
      initialMessages={activeMessages}
      conversation={activeConversation}
      modelContextLength={activeContextLength}
      modelCapabilities={activeModelCaps}
      defaultChatModelId={data.defaultChatModel.modelId}
      altOpenRouterModel={data.chatAltOpenRouterModel}
      messageCount={activeMessages.length}
      approvalUi={data.approvalUi}
      hermesEnabled={data.hermesEnabled}
      {activeBuild}
      onToggleThreadRail={() => (sidebarOpen = !sidebarOpen)}
      onToggleGraphRail={() => (graphRailOpen = !graphRailOpen)}
      {graphRailOpen}
      onmodelchange={(ctx: ModelContext) => {
        activeConversation = {
          ...(activeConversation ?? {}),
          modelProvider: ctx.provider,
          modelId: ctx.modelId,
        };
      }}
    />
  </div>

  <!-- Knowledge-graph rail (324px) / phone bottom sheet (2b) -->
  <div class="graph-slot" class:collapsed={!graphRailOpen} class:sheet-open={hub.graphSheet !== 'closed'}>
    <KnowledgeGraphRail
      conversationId={activeConversationId}
      threadCostUsd={hub.threadCostUsd}
      contextFraction={hub.contextFraction}
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

{#if shareModalConv}
  <ShareConversationModal
    conversation={shareModalConv}
    onClose={() => (shareModalConv = null)}
    onUpdate={handleShareUpdate}
  />
{/if}

<style>
  /* Three columns: 236px rail · conversation · 324px graph. Only the message
     list and the two rails' inner lists scroll. */
  .thread-shell {
    position: relative;
    display: flex;
    flex: 1;
    min-height: 0;
    background: var(--bg);
  }
  .rail-slot {
    flex: none;
    display: flex;
    min-height: 0;
  }
  .chat-slot {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .briefing-slot {
    flex: none;
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
  .rail-scrim,
  .sheet-scrim {
    display: none;
  }

  /* ≥1280: both rails. 1100–1280: graph rail collapses behind the header
     toggle unless explicitly reopened. */
  @media (max-width: 1279px) {
    .graph-slot:not(.sheet-open) {
      display: none;
    }
  }

  /* 800–1100: the thread rail becomes a slide-over. */
  @media (max-width: 1099px) {
    .rail-slot {
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      z-index: 30;
      transform: translateX(-100%);
      transition: transform 0.2s ease-out;
      background: var(--bg);
    }
    .rail-slot.open {
      transform: none;
    }
    .rail-scrim {
      display: block;
      position: absolute;
      inset: 0;
      z-index: 20;
      background: rgba(26, 16, 8, 0.35);
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
    .briefing-slot {
      padding: 10px 16px 0;
    }
  }
</style>
