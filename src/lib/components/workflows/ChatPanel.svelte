<script lang="ts">
  import ChatMessage from './ChatMessage.svelte';

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
  }

  let messages = $state<Message[]>([]);
  let input = $state('');
  let loading = $state(false);
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

    try {
      const hasExistingNodes = currentNodes.length > 0;
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
      });

      const data = await res.json();

      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.message || data.error || 'Something went wrong.',
        metadata: { workflowGenerated: !!data.workflow },
      };
      messages = [...messages, assistantMsg];

      if (data.workflow) {
        onWorkflowGenerated(data.workflow);
      }
    } catch (err) {
      const errorMsg: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'Failed to connect to the orchestrator. Please try again.',
      };
      messages = [...messages, errorMsg];
    } finally {
      loading = false;
      scrollToBottom();
    }
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
  <div class="px-4 py-3 border-b" style="border-color: var(--card-border);">
    <h3 class="text-sm font-medium" style="color: var(--text-primary);">Orchestrator</h3>
    <p class="text-[11px] mt-0.5" style="color: var(--text-ghost);">
      Describe what you want to automate
    </p>
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
