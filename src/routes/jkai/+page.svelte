<script lang="ts">
  import ConversationSidebar from '$lib/components/jkai/ConversationSidebar.svelte';
  import ShareConversationModal from '$lib/components/jkai/ShareConversationModal.svelte';
  import ChatArea from '$lib/components/jkai/ChatArea.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import type { ModelContext } from '$lib/server/models/types';
  import { onMount } from 'svelte';

  let { data } = $props();

  let conversationList = $state(data.conversations);
  let metrics = $state(data.metrics);
  let whatsappThread = $state(data.whatsappThread);
  let activeConversationId = $state<string | null>(null);
  let activeMessages = $state<any[]>([]);
  let activeConversation = $state<{ modelProvider?: string; modelId?: string } | null>(null);
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
        activeBuild = data.activeBuild || null;
      }
    } catch {
      activeMessages = [];
      activeConversation = null;
      activeModelCaps = null;
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

<div class="flex flex-col" style="background: var(--bg); height: 100dvh; min-height: 100vh;">
  <PageHeader title="JKAI">
    {#snippet before()}
      <button
        onclick={() => { sidebarOpen = !sidebarOpen; }}
        class="sm:hidden px-1.5 py-1 rounded transition-colors"
        style="color: var(--text-secondary);"
        title="Conversations"
        aria-label="Toggle conversations"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M3 5h14M3 10h14M3 15h14" />
        </svg>
      </button>
    {/snippet}
    {#snippet meta()}
      <a
        href="https://hermes.strangeramblings.com/"
        target="_blank"
        rel="noopener"
        class="hermes-admin-link"
        title="Hermes app — sessions, skills, providers, MCP, chat"
      >
        Hermes ↗
      </a>
    {/snippet}
  </PageHeader>

  <!-- Main area -->
  <div class="flex flex-1 min-h-0 relative">
    <!-- Desktop sidebar -->
    <div class="hidden sm:flex">
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
        {metrics}
        spendByPeriod={data.spendByPeriod}
      />
    </div>

    <!-- Mobile sidebar overlay -->
    {#if sidebarOpen}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="sm:hidden fixed inset-0 z-40"
        onclick={() => { sidebarOpen = false; }}
      >
        <div class="absolute inset-0" style="background: rgba(0,0,0,0.4);"></div>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="absolute left-0 top-0 bottom-0 flex"
          style="background: var(--bg); width: min(85vw, 18rem);"
          onclick={(e) => e.stopPropagation()}
        >
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
            collapsed={false}
            onToggleCollapse={() => { sidebarOpen = false; }}
            {liveConversationIds}
            {metrics}
            spendByPeriod={data.spendByPeriod}
          />
        </div>
      </div>
    {/if}

    <!-- Chat area -->
    <div class="flex-1 min-w-0">
      <ChatArea
        conversationId={activeConversationId}
        initialMessages={activeMessages}
        conversation={activeConversation}
        modelCapabilities={activeModelCaps}
        defaultGlmModelId={data.defaultChatModel.modelId}
        altOpenRouterModel={data.chatAltOpenRouterModel}
        messageCount={activeMessages.length}
        approvalUi={data.approvalUi}
        hermesEnabled={data.hermesEnabled}
        {activeBuild}
        onmodelchange={(ctx: ModelContext) => {
          activeConversation = {
            ...(activeConversation ?? {}),
            modelProvider: ctx.provider,
            modelId: ctx.modelId,
          };
        }}
      />
    </div>
  </div>
</div>

{#if shareModalConv}
  <ShareConversationModal
    conversation={shareModalConv}
    onClose={() => (shareModalConv = null)}
    onUpdate={handleShareUpdate}
  />
{/if}

<style>
  .hermes-admin-link {
    font-family: var(--font-mono);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-secondary);
    padding: 4px 8px;
    border: 1px solid var(--card-border);
    border-radius: var(--radius-sharp);
    transition: color 0.15s, border-color 0.15s;
    white-space: nowrap;
  }
  .hermes-admin-link:hover {
    color: var(--accent);
    border-color: var(--accent);
  }
</style>
