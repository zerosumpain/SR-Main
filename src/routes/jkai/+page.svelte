<script lang="ts">
  import ConversationSidebar from '$lib/components/jkai/ConversationSidebar.svelte';
  import MetricsStrip from '$lib/components/jkai/MetricsStrip.svelte';
  import ChatArea from '$lib/components/jkai/ChatArea.svelte';
  import { page } from '$app/state';

  let { data } = $props();

  function isActive(href: string): boolean {
    return page.url.pathname === href || page.url.pathname.startsWith(`${href}/`);
  }

  let conversationList = $state(data.conversations);
  let metrics = $state(data.metrics);
  let whatsappThread = $state(data.whatsappThread);
  let activeConversationId = $state<string | null>(null);
  let activeMessages = $state<any[]>([]);
  let sidebarOpen = $state(false);

  async function selectConversation(id: string) {
    activeConversationId = id;
    sidebarOpen = false;
    try {
      const res = await fetch(`/api/jkai/conversations/${id}`);
      if (res.ok) {
        const data = await res.json();
        activeMessages = data.messages || [];
      }
    } catch {
      activeMessages = [];
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

<div class="flex flex-col h-screen" style="background: var(--bg);">
  <!-- Header -->
  <div class="px-3 sm:px-4 py-3 border-b flex items-center justify-between flex-shrink-0 gap-4" style="border-color: var(--card-border);">
    <div class="flex items-center gap-3 sm:gap-5 min-w-0">
      <!-- Mobile sidebar toggle -->
      <button
        onclick={() => { sidebarOpen = !sidebarOpen; }}
        class="sm:hidden px-1.5 py-1 rounded transition-colors"
        style="color: var(--text-secondary);"
        title="Conversations"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M3 5h14M3 10h14M3 15h14" />
        </svg>
      </button>

      <a href="/" class="flex items-center gap-1 transition-colors" style="color: var(--text-secondary);" title="Back to home">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10 12L6 8l4-4" />
        </svg>
      </a>

      <h1 class="display text-[20px] sm:text-[24px]" style="color: var(--text-primary);">JKAI</h1>

      <!-- Metrics: hidden on mobile -->
      <div class="hidden md:block">
        <MetricsStrip {metrics} />
      </div>
    </div>

    <!-- Primary sub-nav — top-right, matches site nav placement -->
    <nav class="flex items-center gap-1 sm:gap-2 flex-wrap justify-end" aria-label="JKAI sections">
      <a href="/jkai/builds" class="nav-link" data-index="01" aria-current={isActive('/jkai/builds') ? 'page' : undefined}>Builds</a>
      <a href="/jkai/prompts" class="nav-link" data-index="02" aria-current={isActive('/jkai/prompts') ? 'page' : undefined}>Prompts</a>
      <a href="/jkai/workflows" class="nav-link" data-index="03" aria-current={isActive('/jkai/workflows') ? 'page' : undefined}>Workflows</a>
      <a href="/jkai/channels" class="nav-link" data-index="04" aria-current={isActive('/jkai/channels') ? 'page' : undefined}>Channels</a>
    </nav>
  </div>

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
          class="absolute left-0 top-0 bottom-0 w-72 flex"
          style="background: var(--bg);"
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
          />
        </div>
      </div>
    {/if}

    <!-- Chat area -->
    <div class="flex-1 min-w-0">
      <ChatArea
        conversationId={activeConversationId}
        initialMessages={activeMessages}
      />
    </div>
  </div>
</div>
