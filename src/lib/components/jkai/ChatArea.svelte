<script lang="ts">
  import ChatMessage from '$lib/components/workflows/ChatMessage.svelte';
  import Artifact from '$lib/components/jkai/artifacts/Artifact.svelte';
  import type { Artifact as ArtifactT } from '$lib/workflows/site-tools/artifact-types';
  import { isArtifact } from '$lib/workflows/site-tools/artifact-types';
  import type { OrchestratorThinking } from '$lib/workflows/orchestrator/types';
  import PromoteToolBanner from '$lib/components/jkai/PromoteToolBanner.svelte';
  import { parsePromoteMarkers, stripPromoteMarkers } from '$lib/jkai/promote-marker';
  import ChatModelToggle from '$lib/components/jkai/ChatModelToggle.svelte';
  import JsonBlock from '$lib/components/jkai/JsonBlock.svelte';
  import type { ModelContext } from '$lib/server/models/types';

  let {
    conversationId,
    initialMessages = [],
    conversation = null,
    defaultGlmModelId,
    altOpenRouterModel = null,
    messageCount = 0,
    onmodelchange,
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
    conversation?: { modelProvider?: string; modelId?: string } | null;
    defaultGlmModelId: string;
    altOpenRouterModel?: ModelContext | null;
    messageCount?: number;
    onmodelchange?: (ctx: ModelContext) => void;
  } = $props();

  interface ToolStep {
    id?: string;
    tool: string;
    args: Record<string, unknown>;
    result?: unknown;
    status: 'running' | 'done' | 'error';
    expanded?: boolean;
    ephemeral?: {
      handlerCode: string;
      parameters: unknown;
      proposedName?: string;
      proposedDescription?: string;
    };
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

  function artifactsForMessage(m: Message): ArtifactT[] {
    if (!m.toolSteps) return [];
    const out: ArtifactT[] = [];
    for (const step of m.toolSteps) {
      const r = step.result as { data?: { artifact?: unknown } } | undefined;
      if (r?.data?.artifact && isArtifact(r.data.artifact)) {
        out.push(r.data.artifact);
      }
    }
    return out;
  }

  function promoteMarkersForMessage(m: Message) {
    if (m.role !== 'assistant') return [];
    return parsePromoteMarkers(m.content);
  }

  let messages = $state<Message[]>([]);
  let input = $state('');
  let loading = $state(false);
  let showThinking = $state(false);
  let showToolDrawer = $state(false);
  let expandedTools = $state<Set<number>>(new Set());
  let currentJobId = $state<string | null>(null);
  let chatContainer: HTMLDivElement;
  let eventSource: EventSource | null = null;
  let jobEventSource: EventSource | null = null;

  // Aggregate all tool calls across every assistant message in the conversation.
  // Each entry keeps a reference to which message it belongs to.
  let allToolCalls = $derived.by(() => {
    const out: Array<{ messageId: string; messageIndex: number; step: ToolStep }> = [];
    messages.forEach((m, idx) => {
      if (m.toolSteps && m.toolSteps.length > 0) {
        for (const step of m.toolSteps) {
          out.push({ messageId: m.id, messageIndex: idx, step });
        }
      }
    });
    return out;
  });

  function toggleDrawerItem(i: number) {
    const next = new Set(expandedTools);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    expandedTools = next;
  }

  // Sync messages when initialMessages or conversationId changes
  $effect(() => {
    messages = initialMessages.map((m) => {
      const meta = m.metadata as { toolSteps?: ToolStep[]; source?: string } | undefined;
      return {
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        metadata: m.metadata,
        // Prefer metadata.source (e.g. 'status_update') over the wrapper source
        source: meta?.source ?? m.source,
        // Hydrate tool steps from stored metadata so the drawer persists across reloads
        toolSteps: meta?.toolSteps,
      };
    });
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

        const newMsg: Message = {
          id: crypto.randomUUID(),
          role: data.role || 'assistant',
          content: data.content,
          source: data.source || 'followup',
        };

        // Status updates are mid-conversation — insert just before the active
        // progress bubble so the user sees them in the right chronological
        // position (before the final answer). Everything else appends.
        if (data.source === 'status_update') {
          const progressIdx = messages.findIndex((m) => m.isProgress);
          if (progressIdx >= 0) {
            messages = [
              ...messages.slice(0, progressIdx),
              newMsg,
              ...messages.slice(progressIdx),
            ];
          } else {
            messages = [...messages, newMsg];
          }
        } else {
          messages = [...messages, newMsg];
        }
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
    if (jobEventSource) {
      jobEventSource.close();
      jobEventSource = null;
    }
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
      status_update: 'Status update',
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

      // Subscribe to live token + tool events via SSE.
      await new Promise<void>((resolve) => {
        let accumulatedContent = '';
        let finished = false;
        const TIMEOUT = 300000;

        const cleanup = () => {
          if (jobEventSource) {
            jobEventSource.close();
            jobEventSource = null;
          }
          if (timeoutHandle) clearTimeout(timeoutHandle);
        };

        const finalize = () => {
          if (finished) return;
          finished = true;
          cleanup();
          resolve();
        };

        const timeoutHandle = setTimeout(() => {
          if (finished) return;
          messages = messages.map((m) =>
            m.id === progressId
              ? { ...m, isProgress: false, content: 'Still working... check back shortly.' }
              : m,
          );
          finalize();
        }, TIMEOUT);

        const es = new EventSource(`/api/workflows/orchestrator/chat/stream?jobId=${jobId}`);
        jobEventSource = es;

        es.onmessage = (event) => {
          let data: any;
          try { data = JSON.parse(event.data); } catch { return; }

          if (data.type === 'connected') return;

          if (data.type === 'token') {
            accumulatedContent += data.delta;
            messages = messages.map((m) =>
              m.id === progressId ? { ...m, content: accumulatedContent } : m,
            );
            scrollToBottom();
            return;
          }

          if (data.type === 'tool_start') {
            const newStep: ToolStep = {
              tool: data.tool,
              args: data.args || {},
              status: 'running',
            };
            messages = messages.map((m) => {
              if (m.id !== progressId) return m;
              return { ...m, toolSteps: [...(m.toolSteps ?? []), newStep] };
            });
            scrollToBottom();
            return;
          }

          if (data.type === 'tool_result') {
            messages = messages.map((m) => {
              if (m.id !== progressId || !m.toolSteps) return m;
              // Find the most recent running step for this tool name and finalise it
              const idx = (() => {
                for (let i = m.toolSteps.length - 1; i >= 0; i--) {
                  if (m.toolSteps[i].tool === data.tool && m.toolSteps[i].status === 'running') return i;
                }
                return -1;
              })();
              if (idx < 0) return m;
              const next = m.toolSteps.slice();
              next[idx] = { ...next[idx], result: data.result, status: data.status };
              return { ...m, toolSteps: next };
            });
            scrollToBottom();
            return;
          }

          if (data.type === 'status') {
            // Mid-task working note — same UX as `/api/jkai/events` status_update
            const newMsg: Message = {
              id: crypto.randomUUID(),
              role: 'assistant',
              content: data.text,
              source: 'status_update',
            };
            const progressIdx = messages.findIndex((m) => m.isProgress);
            if (progressIdx >= 0) {
              messages = [
                ...messages.slice(0, progressIdx),
                newMsg,
                ...messages.slice(progressIdx),
              ];
            } else {
              messages = [...messages, newMsg];
            }
            scrollToBottom();
            return;
          }

          if (data.type === 'done') {
            const result = (data.result || {}) as {
              message?: string;
              error?: string;
              workflow?: unknown;
              thinking?: OrchestratorThinking;
            };
            const prior = messages.find((m) => m.id === progressId);
            // Authoritative final content from persisted responseText. Fall
            // back to streamed tokens if absent (shouldn't happen).
            const finalContent = result.message || result.error || accumulatedContent || 'No response.';
            const finalMsg: Message = {
              id: progressId,
              role: 'assistant',
              content: finalContent,
              metadata: { workflowGenerated: !!result.workflow },
              thinking: result.thinking || undefined,
              isProgress: false,
              source: 'web',
              toolSteps: prior?.toolSteps,
            };
            messages = messages.map((m) => (m.id === progressId ? finalMsg : m));
            scrollToBottom();
            finalize();
            return;
          }

          if (data.type === 'error') {
            messages = messages.map((m) =>
              m.id === progressId
                ? { ...m, isProgress: false, content: `Error: ${data.message ?? 'Unknown error'}` }
                : m,
            );
            scrollToBottom();
            finalize();
            return;
          }
        };

        es.onerror = () => {
          // Browser may auto-reconnect; if the stream really died, the
          // server-side timeout will fire and we'll show the fallback message.
        };
      });
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

<div class="flex flex-col h-full relative">
  <!-- Chat header -->
  <div class="px-3 sm:px-4 py-2 border-b flex items-center justify-between gap-2" style="border-color: var(--card-border);">
    <div class="flex items-center gap-2 min-w-0">
      <p class="text-[11px] hidden sm:block" style="color: var(--text-ghost);">
        {#if !conversationId}
          Select or start a conversation
        {:else}
          Chat with the orchestrator — ask anything, build workflows, control your home
        {/if}
      </p>
      {#if conversationId && conversation?.modelId}
        <ChatModelToggle
          {conversationId}
          modelProvider={(conversation.modelProvider ?? 'zai') as 'zai' | 'openrouter'}
          modelId={conversation.modelId}
          {messageCount}
          {altOpenRouterModel}
          {defaultGlmModelId}
          onChanged={(ctx) => onmodelchange?.(ctx)}
        />
      {/if}
    </div>
    {#if conversationId}
      <div class="flex items-center gap-2 shrink-0">
        {#if allToolCalls.length > 0}
          <button
            onclick={() => { showToolDrawer = !showToolDrawer; }}
            class="text-[10px] px-2 py-1 rounded border transition-colors"
            style="border-color: {showToolDrawer ? 'var(--accent)' : 'var(--card-border)'}; color: {showToolDrawer ? 'var(--accent)' : 'var(--text-ghost)'};"
            title="View all tool calls in this conversation"
          >
            Tool calls ({allToolCalls.length})
          </button>
        {/if}
        <button
          onclick={() => { showThinking = !showThinking; }}
          class="text-[10px] px-2 py-1 rounded border transition-colors"
          style="border-color: {showThinking ? 'var(--accent)' : 'var(--card-border)'}; color: {showThinking ? 'var(--accent)' : 'var(--text-ghost)'};"
        >
          {showThinking ? 'Hide' : 'Show'} thinking
        </button>
      </div>
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
                    {#if step.tool === 'status_update'}
                      <!-- Status updates render inline as plain prose -->
                      <div class="ml-0 px-2 py-2 rounded text-[12px] leading-relaxed" style="background: color-mix(in srgb, var(--accent) 8%, transparent); color: var(--text-primary); border-left: 2px solid var(--accent);">
                        <div class="text-[9px] uppercase tracking-wider mb-1" style="color: var(--accent);">Status update</div>
                        {(step.result as { message?: string })?.message ?? ''}
                      </div>
                    {:else}
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
                          <div class="ml-5 mt-1 mb-2 overflow-x-auto">
                            <JsonBlock data={step.result} />
                          </div>
                        {/if}
                      </div>
                    {/if}
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
          {:else if msg.source === 'status_update'}
            <!-- Mid-task working note — stylistically distinct from a real reply -->
            <div class="flex justify-start mb-3">
              <div
                class="max-w-[85%] pl-3 py-1 text-[12px] italic leading-relaxed"
                style="color: var(--text-secondary); border-left: 2px solid color-mix(in srgb, var(--accent) 50%, transparent);"
              >
                <div class="text-[9px] not-italic uppercase tracking-wider mb-0.5" style="color: var(--accent); opacity: 0.85;">
                  Working...
                </div>
                {msg.content}
              </div>
            </div>
          {:else}
            {#if msg.role === 'assistant'}
              {#each artifactsForMessage(msg) as artifact, i (i)}
                <Artifact {artifact} />
              {/each}
              {#each promoteMarkersForMessage(msg) as marker (marker.toolCallId)}
                <PromoteToolBanner messageId={msg.id} {marker} />
              {/each}
            {/if}
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
                content={msg.role === 'assistant' ? stripPromoteMarkers(msg.content) : msg.content}
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

  <!-- Tool call drawer -->
  {#if showToolDrawer && conversationId}
    <!-- Backdrop (click to close) -->
    <button
      class="absolute inset-0 z-20 cursor-default"
      style="background: rgba(0, 0, 0, 0.3);"
      onclick={() => { showToolDrawer = false; }}
      aria-label="Close tool call drawer"
    ></button>
    <!-- Drawer -->
    <aside
      class="absolute top-0 right-0 h-full z-30 flex flex-col border-l shadow-xl"
      style="width: min(420px, 90vw); background: var(--bg); border-color: var(--card-border);"
    >
      <div class="px-4 py-3 border-b flex items-center justify-between" style="border-color: var(--card-border);">
        <div>
          <div class="text-[11px] uppercase tracking-wider" style="color: var(--accent);">Tool calls</div>
          <div class="text-[10px]" style="color: var(--text-ghost);">{allToolCalls.length} total in this conversation</div>
        </div>
        <button
          onclick={() => { showToolDrawer = false; }}
          class="text-[14px] w-6 h-6 rounded hover:opacity-80"
          style="color: var(--text-ghost);"
          aria-label="Close"
        >&times;</button>
      </div>
      <div class="flex-1 overflow-y-auto px-3 py-2 space-y-1">
        {#each allToolCalls as entry, i (i)}
          <div class="rounded border" style="border-color: var(--card-border);">
            <button
              class="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:opacity-80"
              onclick={() => toggleDrawerItem(i)}
            >
              <span class="text-[9px] font-mono shrink-0 w-5 text-right" style="color: var(--text-ghost);">#{i + 1}</span>
              <span class="text-[10px] shrink-0" style="color: {entry.step.status === 'error' ? '#ef4444' : entry.step.status === 'running' ? 'var(--accent)' : 'var(--text-ghost)'};">
                {#if entry.step.status === 'running'}&#9679;
                {:else if entry.step.status === 'error'}&#10007;
                {:else}&#10003;
                {/if}
              </span>
              <span class="text-[11px] flex-1 truncate" style="color: var(--text-primary); font-family: var(--font-mono);">
                {friendlyToolName(entry.step.tool)}
              </span>
              <span class="text-[9px] shrink-0" style="color: var(--text-ghost);">
                {expandedTools.has(i) ? '-' : '+'}
              </span>
            </button>
            {#if expandedTools.has(i)}
              <div class="px-2 pb-2 space-y-2">
                {#if Object.keys(entry.step.args).length > 0}
                  <div>
                    <div class="text-[9px] uppercase tracking-wider mb-1" style="color: var(--text-ghost);">Args</div>
                    <JsonBlock data={entry.step.args} />
                  </div>
                {/if}
                {#if entry.step.result !== undefined}
                  <div>
                    <div class="text-[9px] uppercase tracking-wider mb-1" style="color: var(--text-ghost);">Result</div>
                    <JsonBlock data={entry.step.result} />
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        {/each}
        {#if allToolCalls.length === 0}
          <div class="text-[11px] text-center py-8" style="color: var(--text-ghost);">
            No tool calls yet.
          </div>
        {/if}
      </div>
    </aside>
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
