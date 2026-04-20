<script lang="ts">
  interface ConversationItem {
    id: string;
    title: string | null;
    source: string;
    updatedAt: string | Date;
    lastMessage: string | null;
    messageCount: number;
    costUsd?: string | number | null;
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
    useIntelContext = true,
    onToggleIntelContext,
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
    useIntelContext?: boolean;
    onToggleIntelContext?: (next: boolean) => void;
  } = $props();

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

  // Group conversations into buckets (order preserved from the incoming list,
  // which is already updatedAt desc).
  let grouped = $derived.by(() => {
    const g: Record<Bucket, ConversationItem[]> = {
      today: [], yesterday: [], last_week: [], older: [],
    };
    for (const c of conversations) g[getBucket(c.updatedAt)].push(c);
    return g;
  });

  // Only today is expanded by default
  let expanded = $state<Record<Bucket, boolean>>({
    today: true, yesterday: false, last_week: false, older: false,
  });

  function toggleBucket(b: Bucket) {
    expanded = { ...expanded, [b]: !expanded[b] };
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
    return text.length > len ? text.slice(0, len) + '...' : text;
  }

  function confirmAndDelete(e: MouseEvent | KeyboardEvent, conv: ConversationItem) {
    e.stopPropagation();
    const label = conv.title || truncate(conv.lastMessage, 40) || 'this conversation';
    if (confirm(`Delete "${label}"? This cannot be undone.`)) {
      onDelete(conv.id);
    }
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
    class="w-full sm:w-64 flex-shrink-0 border-r flex flex-col h-full"
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

      <!-- Bucketed conversations -->
      {#each BUCKET_ORDER as bucket}
        {#if grouped[bucket].length > 0}
          <div>
            <button
              onclick={() => toggleBucket(bucket)}
              class="w-full flex items-center justify-between px-3 py-2 transition-colors hover:opacity-80"
              style="background: color-mix(in srgb, var(--card-border) 25%, transparent);"
            >
              <span class="flex items-center gap-1.5">
                <span class="text-[9px] w-2 inline-block" style="color: var(--text-ghost);">
                  {expanded[bucket] ? '▾' : '▸'}
                </span>
                <span class="text-[10px] uppercase tracking-wider font-medium" style="color: var(--text-secondary);">
                  {BUCKET_LABELS[bucket]}
                </span>
              </span>
              <span class="text-[10px]" style="color: var(--text-ghost); font-family: var(--font-mono);">
                {grouped[bucket].length}
              </span>
            </button>

            {#if expanded[bucket]}
              {#each grouped[bucket] as conv (conv.id)}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                  onclick={() => onSelect(conv.id)}
                  onkeydown={(e) => { if (e.key === 'Enter') onSelect(conv.id); }}
                  role="button"
                  tabindex="0"
                  class="w-full text-left px-3 py-2.5 border-b transition-colors group cursor-pointer"
                  style="border-color: var(--card-border); background: {activeConversationId === conv.id ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'transparent'};"
                >
                  <div class="flex items-center justify-between mb-0.5 gap-2">
                    <span
                      class="text-xs font-medium line-clamp-1 flex-1"
                      style="color: {activeConversationId === conv.id ? 'var(--accent)' : 'var(--text-primary)'};"
                    >
                      {conv.title || 'New conversation'}
                    </span>
                    <span class="text-[10px] shrink-0" style="color: var(--text-ghost); font-family: var(--font-mono);">
                      {relativeTime(conv.updatedAt)}
                    </span>
                    <button
                      onclick={(e) => confirmAndDelete(e, conv)}
                      onkeydown={(e) => { if (e.key === 'Enter') confirmAndDelete(e, conv); }}
                      class="text-[18px] leading-none w-7 h-7 flex items-center justify-center rounded shrink-0 transition-opacity hover:opacity-100 hover:bg-black/10"
                      style="color: var(--text-ghost); opacity: 0.6;"
                      title="Delete conversation"
                      aria-label="Delete conversation"
                    >
                      &times;
                    </button>
                  </div>
                  <p class="text-[11px] line-clamp-1" style="color: var(--text-ghost);">
                    {truncate(conv.lastMessage, 40)}
                  </p>
                  {#if Number(conv.costUsd ?? 0) > 0}
                    <div class="text-[10px] mt-0.5" style="color: var(--text-ghost); font-family: var(--font-mono);">
                      ${Number(conv.costUsd).toFixed(4)}
                    </div>
                  {/if}
                </div>
              {/each}
            {/if}
          </div>
        {/if}
      {/each}
    </div>

    <!-- Footer actions -->
    <div class="px-3 py-3 border-t space-y-2" style="border-color: var(--card-border);">
      <div
        class="flex items-center gap-2 w-full px-3 py-2 rounded-lg border"
        style="border-color: var(--card-border);"
      >
        <a
          href="/jkai/intel"
          class="flex items-center gap-2 flex-1 min-w-0 text-xs font-medium hover:opacity-80 transition-opacity"
          style="color: var(--accent);"
        >
          <span>🔷</span> Intel Dashboard
        </a>
        <button
          type="button"
          role="switch"
          aria-checked={useIntelContext}
          aria-label="Use intel knowledge in chat replies"
          title={useIntelContext ? 'Chat uses intel knowledge — click to turn off' : 'Chat ignores intel knowledge — click to turn on'}
          onclick={() => onToggleIntelContext?.(!useIntelContext)}
          class="relative inline-flex items-center w-9 h-5 shrink-0 rounded-full transition-colors"
          style="background: {useIntelContext ? 'var(--accent)' : 'var(--card-border)'};"
        >
          <span
            class="inline-block w-3.5 h-3.5 rounded-full bg-white shadow transition-transform"
            style="transform: translateX({useIntelContext ? '18px' : '3px'});"
          ></span>
        </button>
      </div>
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
