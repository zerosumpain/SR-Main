<script lang="ts">
  interface ConversationItem {
    id: string;
    title: string | null;
    source: string;
    updatedAt: string;
    lastMessage: string | null;
    messageCount: number;
  }

  interface WhatsAppThread {
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
    collapsed = false,
    onToggleCollapse,
  }: {
    conversations: ConversationItem[];
    whatsappThread: WhatsAppThread | null;
    activeConversationId: string | null;
    onSelect: (id: string) => void;
    onNew: () => void;
    onWhatsAppSelect: () => void;
    onDelete: (id: string) => void;
    collapsed?: boolean;
    onToggleCollapse: () => void;
  } = $props();

  function relativeTime(iso: string): string {
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60000) return 'now';
    if (ms < 3600000) return `${Math.floor(ms / 60000)}m`;
    if (ms < 86400000) return `${Math.floor(ms / 3600000)}h`;
    return `${Math.floor(ms / 86400000)}d`;
  }

  function truncate(text: string | null, len: number): string {
    if (!text) return '';
    return text.length > len ? text.slice(0, len) + '...' : text;
  }
</script>

{#if collapsed}
  <button
    onclick={onToggleCollapse}
    class="px-2 py-4 border-r flex items-center"
    style="border-color: var(--card-border); color: var(--text-ghost);"
    title="Expand sidebar"
  >
    <span class="text-sm">&#9654;</span>
  </button>
{:else}
  <div
    class="w-64 flex-shrink-0 border-r flex flex-col h-full"
    style="border-color: var(--card-border);"
  >
    <!-- Header -->
    <div class="px-3 py-3 flex items-center justify-between border-b" style="border-color: var(--card-border);">
      <span class="text-xs uppercase tracking-wider font-medium" style="color: var(--text-secondary);">
        Conversations
      </span>
      <button
        onclick={onToggleCollapse}
        class="text-sm px-1"
        style="color: var(--text-ghost);"
        title="Collapse sidebar"
      >
        &#9664;
      </button>
    </div>

    <!-- Scrollable list -->
    <div class="flex-1 overflow-y-auto">
      <!-- WhatsApp thread indicator -->
      {#if whatsappThread?.phoneNumber && whatsappThread.messages.length > 0}
        <button
          onclick={onWhatsAppSelect}
          class="w-full text-left px-3 py-3 border-b transition-colors"
          style="border-color: var(--card-border); background: {activeConversationId === 'whatsapp' ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'transparent'};"
        >
          <div class="flex items-center gap-2 mb-1">
            <span class="text-[10px] px-1.5 py-0.5 rounded" style="background: rgba(37, 211, 102, 0.15); color: #25d366;">
              WA
            </span>
            <span class="text-xs font-medium" style="color: var(--text-primary);">
              WhatsApp thread
            </span>
          </div>
          <p class="text-[11px] line-clamp-1" style="color: var(--text-ghost);">
            {truncate(whatsappThread.messages[whatsappThread.messages.length - 1]?.content, 40)}
          </p>
        </button>
      {/if}

      <!-- Web conversations -->
      {#each conversations as conv (conv.id)}
        <button
          onclick={() => onSelect(conv.id)}
          class="w-full text-left px-3 py-2.5 border-b transition-colors group"
          style="border-color: var(--card-border); background: {activeConversationId === conv.id ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'transparent'};"
        >
          <div class="flex items-center justify-between mb-0.5">
            <span
              class="text-xs font-medium line-clamp-1 flex-1"
              style="color: {activeConversationId === conv.id ? 'var(--accent)' : 'var(--text-primary)'};"
            >
              {conv.title || 'New conversation'}
            </span>
            <span class="text-[10px] shrink-0 ml-2" style="color: var(--text-ghost); font-family: var(--font-mono);">
              {relativeTime(conv.updatedAt)}
            </span>
          </div>
          <div class="flex items-center justify-between">
            <p class="text-[11px] line-clamp-1 flex-1" style="color: var(--text-ghost);">
              {truncate(conv.lastMessage, 35)}
            </p>
            <button
              onclick={(e) => { e.stopPropagation(); onDelete(conv.id); }}
              class="text-[10px] px-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
              style="color: var(--text-ghost);"
              title="Delete conversation"
            >
              &times;
            </button>
          </div>
        </button>
      {/each}
    </div>

    <!-- New conversation button -->
    <div class="px-3 py-3 border-t" style="border-color: var(--card-border);">
      <button
        onclick={onNew}
        class="w-full px-3 py-2 rounded-lg text-xs font-medium transition-colors border"
        style="border-color: var(--card-border); color: var(--text-secondary);"
      >
        + New conversation
      </button>
    </div>
  </div>
{/if}
