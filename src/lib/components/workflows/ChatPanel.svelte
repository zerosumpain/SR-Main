<script lang="ts">
  import ChatMessage from './ChatMessage.svelte';
  import { goto } from '$app/navigation';
  import type { OrchestratorThinking } from '$lib/workflows/orchestrator/types';

  let {
    workflowId,
    onWorkflowGenerated,
    currentNodes = [],
    currentEdges = [],
  }: {
    workflowId: string | null;
    onWorkflowGenerated: (workflow: any) => void;
    currentNodes?: any[];
    currentEdges?: any[];
  } = $props();

  interface Message {
    id: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    metadata?: { workflowGenerated?: boolean };
    thinking?: OrchestratorThinking;
  }

  let messages = $state<Message[]>([]);
  let input = $state('');
  let loading = $state(false);
  let showThinking = $state(false);
  let chatContainer: HTMLDivElement;

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

    const MAX_RETRIES = 2;
    let attempt = 0;

    while (attempt <= MAX_RETRIES) {
      try {
        if (attempt > 0) {
          // Show retry message
          const retryMsg: Message = {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: `Connection issue — retrying (attempt ${attempt + 1}/${MAX_RETRIES + 1})...`,
          };
          messages = [...messages, retryMsg];
          scrollToBottom();
        }

        const hasExistingNodes = currentNodes.length > 0;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 120000); // 2 min timeout

        const res = await fetch('/api/workflows/orchestrator/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: text,
            workflowId,
            mode: hasExistingNodes ? 'modify' : 'generate',
            currentNodes: hasExistingNodes ? currentNodes : undefined,
            currentEdges: hasExistingNodes ? currentEdges : undefined,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || `Server error (${res.status})`);
        }

        const assistantMsg: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: data.message || data.error || 'Something went wrong.',
          metadata: { workflowGenerated: !!data.workflow },
          thinking: data.thinking || undefined,
        };
        messages = [...messages, assistantMsg];

        if (data.redirectTo) {
          goto(data.redirectTo);
        } else if (data.workflow) {
          onWorkflowGenerated(data.workflow);
        }
        break; // Success — exit retry loop

      } catch (err) {
        attempt++;
        if (attempt > MAX_RETRIES) {
          const isTimeout = err instanceof DOMException && err.name === 'AbortError';
          const errorMsg: Message = {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: isTimeout
              ? 'The orchestrator timed out — the AI is taking too long to respond. Try a simpler request or try again later.'
              : `Failed to connect to the orchestrator after ${MAX_RETRIES + 1} attempts. Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
          };
          messages = [...messages, errorMsg];
        }
        // Brief pause before retry
        if (attempt <= MAX_RETRIES) {
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }

    loading = false;
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
        Describe what you want to automate
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
          Tell me what you'd like to automate and I'll design a workflow for you.
        </p>
      </div>
    {:else}
      {#each messages as msg (msg.id)}
        <ChatMessage
          role={msg.role}
          content={msg.content}
          metadata={msg.metadata}
          thinking={msg.thinking}
          {showThinking}
        />
      {/each}
    {/if}

    {#if loading}
      <div class="flex justify-start mb-3">
        <div
          class="rounded-lg px-3 py-2 text-sm border"
          style="background: var(--card-bg); border-color: var(--card-border); color: var(--text-ghost);"
        >
          <span class="animate-pulse">Thinking...</span>
        </div>
      </div>
    {/if}
  </div>

  <div class="p-3 border-t" style="border-color: var(--card-border);">
    <div class="flex gap-2">
      <textarea
        bind:value={input}
        onkeydown={handleKeydown}
        placeholder="Describe your workflow..."
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
