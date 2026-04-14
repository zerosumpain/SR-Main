<script lang="ts">
  import ConversationSidebar from '$lib/components/jkai/ConversationSidebar.svelte';
  import MetricsStrip from '$lib/components/jkai/MetricsStrip.svelte';
  import ChatArea from '$lib/components/jkai/ChatArea.svelte';

  let { data } = $props();

  let conversationList = $state(data.conversations);
  let metrics = $state(data.metrics);
  let whatsappThread = $state(data.whatsappThread);
  let activeConversationId = $state<string | null>(null);
  let activeMessages = $state<any[]>([]);
  let sidebarCollapsed = $state(false);

  async function selectConversation(id: string) {
    activeConversationId = id;
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
      }
    } catch (err) {
      console.error('Failed to create conversation:', err);
    }
  }

  async function selectWhatsApp() {
    if (!whatsappThread?.phoneNumber) return;

    // Create a whatsapp-continuation conversation
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
        // Load merged messages
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
  <div class="px-4 py-3 border-b flex items-center justify-between flex-shrink-0" style="border-color: var(--card-border);">
    <div class="flex items-center gap-6">
      <h1 class="display text-[24px]" style="color: var(--text-primary);">JKAI</h1>
      <nav class="flex items-center gap-4">
        <a href="/jkai/builds" class="text-xs uppercase tracking-wider transition-colors" style="color: var(--text-secondary);">
          Builds
        </a>
        <a href="/jkai/prompts" class="text-xs uppercase tracking-wider transition-colors" style="color: var(--text-secondary);">
          Prompts
        </a>
      </nav>
    </div>
    <MetricsStrip {metrics} />
  </div>

  <!-- Main area: sidebar + chat -->
  <div class="flex flex-1 min-h-0">
    <ConversationSidebar
      conversations={conversationList}
      {whatsappThread}
      {activeConversationId}
      onSelect={selectConversation}
      onNew={createConversation}
      onWhatsAppSelect={selectWhatsApp}
      onDelete={deleteConversation}
      collapsed={sidebarCollapsed}
      onToggleCollapse={() => { sidebarCollapsed = !sidebarCollapsed; }}
    />

    <div class="flex-1 min-w-0">
      <ChatArea
        conversationId={activeConversationId}
        initialMessages={activeMessages}
      />
    </div>
  </div>
</div>
