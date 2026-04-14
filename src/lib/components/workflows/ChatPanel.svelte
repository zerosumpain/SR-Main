<script lang="ts">
  import ChatMessage from './ChatMessage.svelte';
  import HealingCard from './HealingCard.svelte';
  import { goto } from '$app/navigation';
  import type { OrchestratorThinking } from '$lib/workflows/orchestrator/types';

  let {
    workflowId,
    onWorkflowGenerated,
    currentNodes = [],
    currentEdges = [],
    healingStates = [],
    onHealingUndo = (_undoId: string) => {},
  }: {
    workflowId: string | null;
    onWorkflowGenerated: (workflow: any) => void;
    currentNodes?: any[];
    currentEdges?: any[];
    healingStates?: Array<{
      nodeId: string;
      nodeLabel: string;
      error: string;
      attempts: Array<any>;
      status: string;
      environmentAction?: string;
      alternative?: string;
      undoIds: string[];
    }>;
    onHealingUndo?: (undoId: string) => void;
  } = $props();

  interface Message {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    metadata?: { workflowGenerated?: boolean };
    thinking?: OrchestratorThinking;
    isProgress?: boolean;
    progressSteps?: string[];
  }

  let messages = $state<Message[]>([]);
  let input = $state('');
  let loading = $state(false);
  let showThinking = $state(false);
  let currentJobId = $state<string | null>(null);
  let chatContainer: HTMLDivElement;

  async function cancelJob() {
    if (!currentJobId) return;
    try {
      await fetch(`/api/workflows/orchestrator/chat?jobId=${currentJobId}`, { method: 'DELETE' });
    } catch { /* ignore */ }
  }

  // Load chat history when workflowId changes
  $effect(() => {
    if (workflowId) {
      loadHistory(workflowId);
    }
  });

  async function loadHistory(wfId: string) {
    try {
      const res = await fetch(`/api/workflows/orchestrator/chat/${wfId}`);
      if (res.ok) {
        messages = await res.json();
      }
    } catch {
      // Ignore — new workflow with no history
    }
  }

  function formatProgress(raw: string): string {
    const trimmed = raw.replace(/\n$/, '').trim();
    // Tool call format: "tool_name: {json}..."
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
      // Try to extract a meaningful summary from the JSON args
      try {
        const parsed = JSON.parse(args.replace(/\.{3}$/, ''));
        if (parsed.query) return `${label}: "${parsed.query}"`;
        if (parsed.label) return `${label}: ${parsed.label}`;
        if (parsed.name) return `${label}: ${parsed.name}`;
        if (parsed.sourceId) return `${label}: ${parsed.sourceId} → ${parsed.targetId}`;
      } catch {
        // Truncated JSON — extract what we can
        const queryMatch = args.match(/"query"\s*:\s*"([^"]+)"/);
        if (queryMatch) return `${label}: "${queryMatch[1]}"`;
        const labelMatch = args.match(/"label"\s*:\s*"([^"]+)"/);
        if (labelMatch) return `${label}: ${labelMatch[1]}`;
        const nameMatch = args.match(/"name"\s*:\s*"([^"]+)"/);
        if (nameMatch) return `${label}: ${nameMatch[1]}`;
      }
      return label;
    }
    // Plain progress text
    return trimmed.replace(/\.\.\.\n?$/, '');
  }

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    input = '';
    loading = true;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
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

    let resultWorkflowId: string | null = null;

    try {
      // Phase 1: POST to start the job
      // Default: general chat. Only use workflow modes when explicitly requested.
      const hasExistingNodes = currentNodes.length > 1; // >1 because trigger node is always present
      const postRes = await fetch('/api/workflows/orchestrator/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          workflowId,
          // No mode = general chat. Server handles workflow building only with explicit mode.
          currentNodes: hasExistingNodes ? currentNodes : undefined,
          currentEdges: hasExistingNodes ? currentEdges : undefined,
        }),
      });

      const postData = await postRes.json().catch(() => null);

      if (!postRes.ok) {
        throw new Error(postData?.error || `Server error (${postRes.status})`);
      }

      const jobId = postData?.jobId;
      if (!jobId) throw new Error(`No job ID returned`);
      currentJobId = jobId;

      // Phase 2: Poll for progress and result
      let done = false;
      let lastProgress = 0;
      const startTime = Date.now();
      const TIMEOUT = 300000; // 5 min

      while (!done && Date.now() - startTime < TIMEOUT) {
        await new Promise(r => setTimeout(r, 1500));

        try {
          const pollRes = await fetch(`/api/workflows/orchestrator/chat?jobId=${jobId}`);
          if (!pollRes.ok) continue;

          const data = await pollRes.json();

          // Update progress
          if (data.progress && data.progress.length > lastProgress) {
            const steps = data.progress.map(formatProgress);
            const latestStep = steps[steps.length - 1];
            messages = messages.map(m =>
              m.id === progressId ? { ...m, content: latestStep, progressSteps: steps } : m,
            );
            lastProgress = data.progress.length;
            scrollToBottom();
          }

          // Check if done
          if (data.status === 'cancelled') {
            done = true;
            messages = messages.map(m => m.id === progressId ? {
              ...m, isProgress: false, content: 'Job cancelled.',
            } : m);
          } else if (data.status === 'done' || data.status === 'error') {
            done = true;
            const result = data.result || {};
            resultWorkflowId = result.workflowId || null;

            const finalMsg: Message = {
              id: progressId,
              role: 'assistant',
              content: result.message || result.error || data.error || 'The orchestrator completed but returned no result.',
              metadata: { workflowGenerated: !!result.workflow },
              thinking: result.thinking || undefined,
              isProgress: false,
            };
            messages = messages.map(m => m.id === progressId ? finalMsg : m);

            if (result.redirectTo) goto(result.redirectTo);
            else if (result.workflow) onWorkflowGenerated(result.workflow);
          }
        } catch {
          // Network error on poll — keep trying
        }
      }

      if (!done) {
        // Timeout — but the job may still be running server-side
        if (resultWorkflowId || workflowId) {
          const wfId = resultWorkflowId || workflowId;
          messages = messages.map(m => m.id === progressId ? {
            ...m,
            isProgress: false,
            content: `Still working... redirecting to the workflow page.`,
          } : m);
          goto(`/workflows/${wfId}`);
        } else {
          messages = messages.map(m => m.id === progressId ? {
            ...m,
            isProgress: false,
            content: 'The orchestrator is still working. Check the workflows list in a moment.',
          } : m);
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('[orchestrator-chat]', errMsg);
      messages = messages.map(m => m.id === progressId ? {
        ...m,
        isProgress: false,
        content: `Error: ${errMsg}`,
      } : m);
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

<div
  class="h-full flex flex-col border-l"
  style="background: var(--bg); border-color: var(--card-border); width: 360px;"
>
  <div class="px-4 py-3 border-b flex items-start justify-between" style="border-color: var(--card-border);">
    <div>
      <h3 class="text-sm font-medium" style="color: var(--text-primary);">Orchestrator</h3>
      <p class="text-[11px] mt-0.5" style="color: var(--text-ghost);">
        Chat, ask questions, or build workflows
      </p>
    </div>
    <button
      onclick={() => { showThinking = !showThinking; }}
      class="text-[10px] px-2 py-1 rounded border transition-colors shrink-0"
      style="border-color: {showThinking ? 'var(--accent)' : 'var(--card-border)'}; color: {showThinking ? 'var(--accent)' : 'var(--text-ghost)'};"
      title="Toggle thinking steps"
    >
      {showThinking ? 'Hide' : 'Show'} thinking
    </button>
  </div>

  <div
    bind:this={chatContainer}
    class="flex-1 overflow-y-auto p-3"
  >
    {#if messages.length === 0}
      <div class="text-center py-8">
        <p class="text-sm" style="color: var(--text-ghost);">
          Ask me anything — control your smart home, check your health data, manage blog posts, or build workflows.
        </p>
      </div>
    {:else}
      {#each messages as msg (msg.id)}
        {#if msg.isProgress}
          <!-- Progress indicator (not a chat bubble) -->
          <div class="mb-3 rounded-lg border overflow-hidden" style="border-color: var(--accent); background: var(--card-bg);">
            <div class="px-3 py-2 flex items-center gap-2" style="background: color-mix(in srgb, var(--accent) 10%, transparent);">
              <span class="w-2 h-2 rounded-full animate-pulse" style="background: var(--accent);"></span>
              <span class="text-[11px] uppercase tracking-wider font-medium" style="color: var(--accent);">
                {msg.progressSteps && msg.progressSteps.length > 0 ? 'Working' : 'Thinking'}
              </span>
              <button
                onclick={cancelJob}
                class="ml-auto text-[10px] px-2 py-0.5 rounded border transition-colors nopan nodrag"
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
          <ChatMessage
            role={msg.role}
            content={msg.content}
            metadata={msg.metadata}
            thinking={msg.thinking}
            {showThinking}
          />
        {/if}
      {/each}
    {/if}

      {#each healingStates as hs (hs.nodeId)}
        <HealingCard
          nodeLabel={hs.nodeLabel}
          error={hs.error}
          attempts={hs.attempts}
          status={hs.status}
          environmentAction={hs.environmentAction}
          alternative={hs.alternative}
          undoIds={hs.undoIds}
          onUndo={onHealingUndo}
        />
      {/each}
  </div>

  <div class="p-3 border-t" style="border-color: var(--card-border);">
    <div class="flex gap-2">
      <textarea
        bind:value={input}
        onkeydown={handleKeydown}
        placeholder="Ask anything..."
        disabled={loading}
        class="flex-1 px-3 py-2 rounded-lg text-sm border resize-none"
        style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-primary); min-height: 40px; max-height: 120px;"
        rows="1"
      ></textarea>
      <button
        onclick={send}
        disabled={loading || !input.trim()}
        class="px-3 py-2 rounded-lg text-sm font-medium transition-colors self-end"
        style="background: var(--accent); color: white; opacity: {loading || !input.trim() ? 0.5 : 1};"
      >
        Send
      </button>
    </div>
  </div>
</div>
