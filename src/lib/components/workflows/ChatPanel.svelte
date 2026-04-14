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

    const progressId = crypto.randomUUID();
    messages = [...messages, { id: progressId, role: 'assistant' as const, content: 'Starting...' }];
    scrollToBottom();

    try {
      // Phase 1: POST to start the job (returns immediately with jobId)
      const hasExistingNodes = currentNodes.length > 0;
      const postRes = await fetch('/api/workflows/orchestrator/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          workflowId,
          mode: hasExistingNodes ? 'modify' : 'generate',
          currentNodes: hasExistingNodes ? currentNodes : undefined,
          currentEdges: hasExistingNodes ? currentEdges : undefined,
        }),
      });

      if (!postRes.ok) {
        const err = await postRes.json().catch(() => ({ error: `HTTP ${postRes.status}` }));
        throw new Error(err.error || `Server error (${postRes.status})`);
      }

      const { jobId } = await postRes.json();
      if (!jobId) throw new Error('No job ID returned');

      messages = messages.map(m =>
        m.id === progressId ? { ...m, content: 'Thinking...' } : m,
      );
      scrollToBottom();

      // Phase 2: GET SSE stream to receive progress + result
      const evtSource = new EventSource(`/api/workflows/orchestrator/chat?jobId=${jobId}`);

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          evtSource.close();
          reject(new Error('Orchestrator timed out after 3 minutes'));
        }, 180000);

        evtSource.onmessage = (e) => {
          let event: Record<string, any>;
          try { event = JSON.parse(e.data); } catch { return; }

          if (event.type === 'progress') {
            messages = messages.map(m =>
              m.id === progressId ? { ...m, content: event.message || 'Working...' } : m,
            );
            scrollToBottom();
          } else if (event.type === 'done') {
            clearTimeout(timeout);
            evtSource.close();

            const finalMsg: Message = {
              id: progressId,
              role: 'assistant',
              content: event.message || event.error || 'Something went wrong.',
              metadata: { workflowGenerated: !!event.workflow },
              thinking: event.thinking || undefined,
            };
            messages = messages.map(m => m.id === progressId ? finalMsg : m);

            if (event.redirectTo) goto(event.redirectTo);
            else if (event.workflow) onWorkflowGenerated(event.workflow);

            resolve();
          }
        };

        evtSource.onerror = () => {
          clearTimeout(timeout);
          evtSource.close();
          reject(new Error('Lost connection to orchestrator — it may still be working. Refresh the page to check.'));
        };
      });
    } catch (err) {
      messages = messages.map(m => m.id === progressId ? {
        ...m,
        content: `Orchestrator error: ${err instanceof Error ? err.message : 'Unknown error'}`,
      } : m);
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
