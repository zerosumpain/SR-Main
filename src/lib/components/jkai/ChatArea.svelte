<script lang="ts">
  import ChatMessage from '$lib/components/workflows/ChatMessage.svelte';
  import type { OrchestratorThinking } from '$lib/workflows/orchestrator/types';

  let {
    conversationId,
    initialMessages = [],
  }: {
    conversationId: string | null;
    initialMessages?: Array<{
      id: string;
      role: string;
      content: string;
      metadata?: any;
      source?: string;
      createdAt?: string;
    }>;
  } = $props();

  interface ToolStep {
    tool: string;
    args: Record<string, unknown>;
    result?: unknown;
    status: 'running' | 'done' | 'error';
    expanded?: boolean;
  }

  interface Message {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    metadata?: { workflowGenerated?: boolean };
    thinking?: OrchestratorThinking;
    isProgress?: boolean;
    progressSteps?: string[];
    toolSteps?: ToolStep[];
    source?: string;
  }

  let messages = $state<Message[]>([]);
  let input = $state('');
  let loading = $state(false);
  let showThinking = $state(false);
  let currentJobId = $state<string | null>(null);
  let chatContainer: HTMLDivElement;
  let eventSource: EventSource | null = null;

  // Sync messages when initialMessages or conversationId changes
  $effect(() => {
    messages = initialMessages.map((m) => ({
      id: m.id,
      role: m.role as 'user' | 'assistant',
      content: m.content,
      metadata: m.metadata,
      source: m.source,
    }));
    scrollToBottom();
  });

  // SSE connection for real-time follow-up messages
  $effect(() => {
    // Clean up previous connection
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }

    if (!conversationId) return;

    const es = new EventSource(`/api/jkai/events?conversationId=${conversationId}`);
    eventSource = es;

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'connected') return; // ignore connection ack

        // Append follow-up message to the conversation
        const newMsg: Message = {
          id: crypto.randomUUID(),
          role: data.role || 'assistant',
          content: data.content,
          source: data.source || 'followup',
        };
        messages = [...messages, newMsg];
        scrollToBottom();
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {
      // EventSource auto-reconnects, no action needed
    };

    return () => {
      es.close();
      eventSource = null;
    };
  });

  async function cancelJob() {
    if (!currentJobId) return;
    try {
      await fetch(`/api/workflows/orchestrator/chat?jobId=${currentJobId}`, { method: 'DELETE' });
    } catch { /* ignore */ }
  }

  function formatToolArgs(args: Record<string, unknown>): string {
    const parts = Object.entries(args).map(([k, v]) => {
      const val = typeof v === 'string' ? v : JSON.stringify(v);
      return `${k}=${val}`;
    });
    return parts.join(', ');
  }

  function friendlyToolName(name: string): string {
    const labels: Record<string, string> = {
      activate_toolset: 'Loading toolset',
      ha_query_state: 'Querying device',
      ha_call_service: 'Controlling device',
      ha_fire_event: 'Firing event',
      ha_get_history: 'Getting history',
      ha_render_template: 'Running template',
      reverse_geocode: 'Geocoding',
      jkai_help: 'Checking capabilities',
      list_custom_tools: 'Listing tools',
      create_tool: 'Creating tool',
    };
    return labels[name] || name.replace(/_/g, ' ');
  }

  function toggleStepExpanded(stepIndex: number) {
    messages = messages.map((m) => {
      if (!m.isProgress || !m.toolSteps) return m;
      const steps = m.toolSteps.map((s, i) =>
        i === stepIndex ? { ...s, expanded: !s.expanded } : s,
      );
      return { ...m, toolSteps: steps };
    });
  }

  async function send() {
    const text = input.trim();
    if (!text || loading || !conversationId) return;

    input = '';
    loading = true;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      source: 'web',
    };
    messages = [...messages, userMsg];
    scrollToBottom();

    const progressId = crypto.randomUUID();
    // Start with a subtle typing indicator — no progress box yet
    messages = [...messages, {
      id: progressId,
      role: 'assistant',
      content: '',
      isProgress: true,
      progressSteps: [],
      toolSteps: [],
    }];
    scrollToBottom();

    try {
      const postRes = await fetch('/api/workflows/orchestrator/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          conversationId,
        }),
      });

      const postData = await postRes.json().catch(() => null);

      if (!postRes.ok) {
        throw new Error(postData?.error || `Server error (${postRes.status})`);
      }

      const jobId = postData?.jobId;
      if (!jobId) throw new Error('No job ID returned');
      currentJobId = jobId;

      let done = false;
      let lastProgress = 0;
      const startTime = Date.now();
      const TIMEOUT = 300000;
      let pollInterval = 500;
      const MAX_POLL_INTERVAL = 3000;

      while (!done && Date.now() - startTime < TIMEOUT) {
        await new Promise((r) => setTimeout(r, pollInterval));
        pollInterval = Math.min(pollInterval * 1.3, MAX_POLL_INTERVAL);

        try {
          const pollRes = await fetch(`/api/workflows/orchestrator/chat?jobId=${jobId}`);
          if (!pollRes.ok) continue;

          const data = await pollRes.json();

          // Update tool steps from server
          if (data.toolSteps && data.toolSteps.length > 0) {
            messages = messages.map((m) =>
              m.id === progressId ? { ...m, toolSteps: data.toolSteps } : m,
            );
            scrollToBottom();
          }

          if (data.progress && data.progress.length > lastProgress) {
            const steps = data.progress as string[];
            messages = messages.map((m) =>
              m.id === progressId ? { ...m, progressSteps: steps } : m,
            );
            lastProgress = data.progress.length;
            scrollToBottom();
          }

          if (data.status === 'cancelled') {
            done = true;
            messages = messages.map((m) =>
              m.id === progressId ? { ...m, isProgress: false, content: 'Job cancelled.' } : m,
            );
          } else if (data.status === 'done' || data.status === 'error') {
            done = true;
            const result = data.result || {};

            const finalMsg: Message = {
              id: progressId,
              role: 'assistant',
              content: result.message || result.error || data.error || 'No response.',
              metadata: { workflowGenerated: !!result.workflow },
              thinking: result.thinking || undefined,
              isProgress: false,
              source: 'web',
            };
            messages = messages.map((m) => (m.id === progressId ? finalMsg : m));
          }
        } catch {
          // Network error — keep polling
        }
      }

      if (!done) {
        messages = messages.map((m) =>
          m.id === progressId
            ? { ...m, isProgress: false, content: 'Still working... check back shortly.' }
            : m,
        );
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      messages = messages.map((m) =>
        m.id === progressId ? { ...m, isProgress: false, content: `Error: ${errMsg}` } : m,
      );
    }

    loading = false;
    currentJobId = null;
    scrollToBottom();
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      chatContainer?.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
    });
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }
</script>

<div class="flex flex-col h-full">
  <!-- Chat header -->
  <div class="px-3 sm:px-4 py-2 border-b flex items-center justify-between" style="border-color: var(--card-border);">
    <p class="text-[11px] hidden sm:block" style="color: var(--text-ghost);">
      {#if !conversationId}
        Select or start a conversation
      {:else}
        Chat with the orchestrator — ask anything, build workflows, control your home
      {/if}
    </p>
    {#if conversationId}
      <button
        onclick={() => { showThinking = !showThinking; }}
        class="text-[10px] px-2 py-1 rounded border transition-colors shrink-0"
        style="border-color: {showThinking ? 'var(--accent)' : 'var(--card-border)'}; color: {showThinking ? 'var(--accent)' : 'var(--text-ghost)'};"
      >
        {showThinking ? 'Hide' : 'Show'} thinking
      </button>
    {/if}
  </div>

  <!-- Messages -->
  <div bind:this={chatContainer} class="flex-1 overflow-y-auto p-3 sm:p-4">
    {#if !conversationId}
      <div class="flex items-center justify-center h-full">
        <p class="text-sm" style="color: var(--text-ghost);">
          Start a new conversation or select one from the sidebar.
        </p>
      </div>
    {:else if messages.length === 0}
      <div class="flex items-center justify-center h-full">
        <div class="text-center max-w-md">
          <p class="text-sm mb-2" style="color: var(--text-ghost);">
            Ask me anything — control your smart home, check health data, manage blog posts, start builds, or create workflows.
          </p>
        </div>
      </div>
    {:else}
      <div class="max-w-3xl mx-auto">
        {#each messages as msg, msgIndex (msg.id)}
          {#if msg.isProgress}
            {#if msg.toolSteps && msg.toolSteps.length > 0}
              <!-- Tool progress box — only shown when tools are actually being used -->
              <div class="mb-3 rounded-lg border overflow-hidden" style="border-color: var(--accent); background: var(--card-bg);">
                <div class="px-3 py-2 flex items-center gap-2" style="background: color-mix(in srgb, var(--accent) 10%, transparent);">
                  <span class="w-2 h-2 rounded-full animate-pulse" style="background: var(--accent);"></span>
                  <span class="text-[11px] uppercase tracking-wider font-medium" style="color: var(--accent);">
                    Working
                  </span>
                  <button
                    onclick={cancelJob}
                    class="ml-auto text-[10px] px-2 py-0.5 rounded border transition-colors"
                    style="border-color: var(--card-border); color: var(--text-ghost);"
                  >
                    Cancel
                  </button>
                </div>
                <div class="px-3 py-2 space-y-1">
                  {#each msg.toolSteps as step, stepIndex}
                    <div>
                      <button
                        class="flex items-center gap-2 w-full text-left group"
                        onclick={() => toggleStepExpanded(stepIndex)}
                      >
                        <span class="text-[10px] shrink-0 w-3 text-center" style="color: {step.status === 'running' ? 'var(--accent)' : step.status === 'error' ? '#ef4444' : 'var(--text-ghost)'};">
                          {#if step.status === 'running'}
                            <span class="inline-block animate-pulse">&#9679;</span>
                          {:else if step.status === 'error'}
                            &#10007;
                          {:else}
                            &#10003;
                          {/if}
                        </span>
                        <span
                          class="text-[11px] flex-1"
                          style="color: {step.status === 'running' ? 'var(--text-primary)' : 'var(--text-ghost)'}; font-family: var(--font-mono);"
                        >
                          {friendlyToolName(step.tool)}{#if Object.keys(step.args).length > 0}: {formatToolArgs(step.args)}{/if}
                        </span>
                        {#if step.result !== undefined}
                          <span class="text-[9px] opacity-0 group-hover:opacity-100 transition-opacity" style="color: var(--text-ghost);">
                            {step.expanded ? 'collapse' : 'expand'}
                          </span>
                        {/if}
                      </button>
                      {#if step.expanded && step.result !== undefined}
                        <div class="ml-5 mt-1 mb-2 px-2 py-1.5 rounded text-[10px] overflow-x-auto" style="background: color-mix(in srgb, var(--card-border) 30%, transparent); font-family: var(--font-mono); color: var(--text-ghost);">
                          <pre class="whitespace-pre-wrap break-words">{JSON.stringify(step.result, null, 2)}</pre>
                        </div>
                      {/if}
                    </div>
                  {/each}
                </div>
              </div>
            {:else}
              <!-- Subtle typing indicator — no tools yet -->
              <div class="mb-3 flex items-center gap-1 px-1 py-2">
                <span class="typing-dot" style="background: var(--text-ghost);"></span>
                <span class="typing-dot" style="background: var(--text-ghost); animation-delay: 0.15s;"></span>
                <span class="typing-dot" style="background: var(--text-ghost); animation-delay: 0.3s;"></span>
              </div>
            {/if}
          {:else}
            <div class="relative">
              {#if msg.source === 'followup'}
                <span
                  class="absolute -left-6 top-2 text-[9px] px-1 py-0.5 rounded"
                  style="background: color-mix(in srgb, var(--accent) 15%, transparent); color: var(--accent);"
                  title="Async follow-up"
                >
                  FU
                </span>
              {:else if msg.source === 'whatsapp'}
                <span
                  class="absolute -left-6 top-2 text-[9px] px-1 py-0.5 rounded"
                  style="background: rgba(37, 211, 102, 0.15); color: #25d366;"
                  title="From WhatsApp"
                >
                  WA
                </span>
              {/if}
              <ChatMessage
                role={msg.role}
                content={msg.content}
                metadata={msg.metadata}
                thinking={msg.thinking}
                {showThinking}
              />
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  </div>

  <!-- Input -->
  {#if conversationId}
    <div class="p-3 sm:p-4 border-t" style="border-color: var(--card-border);">
      <div class="max-w-3xl mx-auto flex gap-2">
        <textarea
          bind:value={input}
          onkeydown={handleKeydown}
          placeholder="Ask anything..."
          disabled={loading}
          class="flex-1 px-3 sm:px-4 py-2.5 sm:py-3 rounded-lg text-sm border resize-none"
          style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary); min-height: 44px; max-height: 160px;"
          rows="1"
        ></textarea>
        <button
          onclick={send}
          disabled={loading || !input.trim()}
          class="px-3 sm:px-4 py-2.5 sm:py-3 rounded-lg text-sm font-medium transition-colors self-end"
          style="background: var(--accent); color: white; opacity: {loading || !input.trim() ? 0.5 : 1};"
        >
          Send
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .typing-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    display: inline-block;
    animation: typing-bounce 1.2s ease-in-out infinite;
    opacity: 0.5;
  }

  @keyframes typing-bounce {
    0%, 60%, 100% { transform: translateY(0); opacity: 0.3; }
    30% { transform: translateY(-4px); opacity: 0.7; }
  }
</style>
