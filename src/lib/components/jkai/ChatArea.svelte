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

  interface Message {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    metadata?: { workflowGenerated?: boolean };
    thinking?: OrchestratorThinking;
    isProgress?: boolean;
    progressSteps?: string[];
    source?: string;
  }

  let messages = $state<Message[]>([]);
  let input = $state('');
  let loading = $state(false);
  let showThinking = $state(false);
  let currentJobId = $state<string | null>(null);
  let chatContainer: HTMLDivElement;

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

  async function cancelJob() {
    if (!currentJobId) return;
    try {
      await fetch(`/api/workflows/orchestrator/chat?jobId=${currentJobId}`, { method: 'DELETE' });
    } catch { /* ignore */ }
  }

  function formatProgress(raw: string): string {
    const trimmed = raw.replace(/\n$/, '').trim();
    const toolMatch = trimmed.match(/^(\w+):\s*(.+)/);
    if (toolMatch) {
      const [, tool, args] = toolMatch;
      const labels: Record<string, string> = {
        search_nodes: 'Searching',
        use_node: 'Adding node',
        create_node: 'Creating node',
        connect_nodes: 'Connecting',
        ask_user: 'Asking',
        finalize_workflow: 'Finalizing',
      };
      const label = labels[tool] || tool;
      try {
        const parsed = JSON.parse(args.replace(/\.{3}$/, ''));
        if (parsed.query) return `${label}: "${parsed.query}"`;
        if (parsed.label) return `${label}: ${parsed.label}`;
        if (parsed.name) return `${label}: ${parsed.name}`;
        if (parsed.sourceId) return `${label}: ${parsed.sourceId} → ${parsed.targetId}`;
      } catch {
        const queryMatch = args.match(/"query"\s*:\s*"([^"]+)"/);
        if (queryMatch) return `${label}: "${queryMatch[1]}"`;
        const labelMatch = args.match(/"label"\s*:\s*"([^"]+)"/);
        if (labelMatch) return `${label}: ${labelMatch[1]}`;
        const nameMatch = args.match(/"name"\s*:\s*"([^"]+)"/);
        if (nameMatch) return `${label}: ${nameMatch[1]}`;
      }
      return label;
    }
    return trimmed.replace(/\.\.\.\n?$/, '');
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
    messages = [...messages, {
      id: progressId,
      role: 'assistant',
      content: 'Thinking...',
      isProgress: true,
      progressSteps: [],
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

      while (!done && Date.now() - startTime < TIMEOUT) {
        await new Promise((r) => setTimeout(r, 1500));

        try {
          const pollRes = await fetch(`/api/workflows/orchestrator/chat?jobId=${jobId}`);
          if (!pollRes.ok) continue;

          const data = await pollRes.json();

          if (data.progress && data.progress.length > lastProgress) {
            const steps = data.progress.map(formatProgress);
            const latestStep = steps[steps.length - 1];
            messages = messages.map((m) =>
              m.id === progressId ? { ...m, content: latestStep, progressSteps: steps } : m,
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
        {#each messages as msg (msg.id)}
          {#if msg.isProgress}
            <div class="mb-3 rounded-lg border overflow-hidden" style="border-color: var(--accent); background: var(--card-bg);">
              <div class="px-3 py-2 flex items-center gap-2" style="background: color-mix(in srgb, var(--accent) 10%, transparent);">
                <span class="w-2 h-2 rounded-full animate-pulse" style="background: var(--accent);"></span>
                <span class="text-[11px] uppercase tracking-wider font-medium" style="color: var(--accent);">
                  {msg.progressSteps && msg.progressSteps.length > 0 ? 'Working' : 'Thinking'}
                </span>
                <button
                  onclick={cancelJob}
                  class="ml-auto text-[10px] px-2 py-0.5 rounded border transition-colors"
                  style="border-color: var(--card-border); color: var(--text-ghost);"
                >
                  Cancel
                </button>
              </div>
              {#if msg.progressSteps && msg.progressSteps.length > 0}
                <div class="px-3 py-2 space-y-1">
                  {#each msg.progressSteps as step, i}
                    <div class="flex items-center gap-2">
                      <span class="text-[10px] shrink-0" style="color: {i === msg.progressSteps.length - 1 ? 'var(--accent)' : 'var(--text-ghost)'};">
                        {i === msg.progressSteps.length - 1 ? '>' : '\u2713'}
                      </span>
                      <span
                        class="text-[11px]"
                        style="color: {i === msg.progressSteps.length - 1 ? 'var(--text-primary)' : 'var(--text-ghost)'}; font-family: var(--font-mono);"
                      >
                        {step}
                      </span>
                    </div>
                  {/each}
                </div>
              {:else}
                <div class="px-3 py-2">
                  <span class="text-[11px] animate-pulse" style="color: var(--text-ghost); font-family: var(--font-mono);">
                    {msg.content}
                  </span>
                </div>
              {/if}
            </div>
          {:else}
            <div class="relative">
              {#if msg.source === 'whatsapp'}
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
