<script lang="ts">
  import ConversationSidebar from '$lib/components/jkai/ConversationSidebar.svelte';
  import MetricsStrip from '$lib/components/jkai/MetricsStrip.svelte';
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

  const INTEL_CONTEXT_STORAGE_KEY = 'jkai.useIntelContext';
  const LAST_VISIT_STORAGE_KEY = 'jkai.lastVisit';
  const LAST_CONV_STORAGE_KEY = 'jkai.lastConversationId';
  const RESUME_WINDOW_MS = 2 * 60 * 60 * 1000;
  let useIntelContext = $state(true);

  onMount(() => {
    try {
      const stored = localStorage.getItem(INTEL_CONTEXT_STORAGE_KEY);
      if (stored === 'false') useIntelContext = false;
    } catch {
      // localStorage unavailable (private mode / SSR hydration race) — fall back to default.
    }

    let resumed = false;
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
    if (!resumed) {
      createConversation();
    }

    try {
      localStorage.setItem(LAST_VISIT_STORAGE_KEY, String(Date.now()));
    } catch {
      // ignore
    }
  });

  function rememberConversation(id: string) {
    try {
      localStorage.setItem(LAST_CONV_STORAGE_KEY, id);
    } catch {
      // ignore
    }
  }

  function toggleIntelContext(next: boolean) {
    useIntelContext = next;
    try {
      localStorage.setItem(INTEL_CONTEXT_STORAGE_KEY, String(next));
    } catch {
      // swallow — state remains in-memory for this session.
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

  async function selectWhatsApp() {
    if (!whatsappThread?.phoneNumber) return;

    try {
      const res = await fetch('/api/jkai/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'whatsapp-continuation',
          whatsappPhoneNumber: whatsappThread.phoneNumber,
          title: 'WhatsApp continuation',
        }),
      });
      if (res.ok) {
        const conv = await res.json();
        conversationList = [
          { ...conv, messageCount: 0, lastMessage: null },
          ...conversationList,
        ];
        activeConversationId = conv.id;
        rememberConversation(conv.id);
        sidebarOpen = false;
        const detailRes = await fetch(`/api/jkai/conversations/${conv.id}`);
        if (detailRes.ok) {
          const detail = await detailRes.json();
          activeMessages = detail.messages || [];
        }
      }
    } catch (err) {
      console.error('Failed to create WhatsApp continuation:', err);
    }
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
      <div class="flex items-center gap-3">
        <MetricsStrip {metrics} totalSpendUsd={data.totalSpendUsd} />
        <a
          href="https://homeserv.tail668b8c.ts.net:8443/"
          target="_blank"
          rel="noopener"
          class="hermes-admin-link"
          title="Hermes app — sessions, skills, providers, MCP, chat"
        >
          Hermes ↗
        </a>
      </div>
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
        collapsed={false}
        onToggleCollapse={() => {}}
        {useIntelContext}
        onToggleIntelContext={toggleIntelContext}
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
            collapsed={false}
            onToggleCollapse={() => { sidebarOpen = false; }}
            {useIntelContext}
            onToggleIntelContext={toggleIntelContext}
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
        {useIntelContext}
        {activeBuild}
        onmodelchange={(ctx: ModelContext) => {
          if (activeConversation) {
            activeConversation = {
              ...activeConversation,
              modelProvider: ctx.provider,
              modelId: ctx.modelId,
            };
          }
        }}
      />
    </div>
  </div>
</div>

<style>
  .hermes-admin-link {
    font-family: var(--font-mono);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-secondary);
    padding: 4px 8px;
    border: 1px solid var(--card-border);
    border-radius: 3px;
    transition: color 0.15s, border-color 0.15s;
    white-space: nowrap;
  }
  .hermes-admin-link:hover {
    color: var(--accent);
    border-color: var(--accent);
  }
</style>
