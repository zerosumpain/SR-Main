<script lang="ts">
  import ThinkingTimeline from './ThinkingTimeline.svelte';
  import type { OrchestratorThinking } from '$lib/workflows/orchestrator/types';

  let {
    role,
    content,
    metadata,
    thinking,
    showThinking = false,
  }: {
    role: 'user' | 'assistant' | 'system';
    content: string;
    metadata?: { workflowGenerated?: boolean };
    thinking?: OrchestratorThinking;
    showThinking?: boolean;
  } = $props();

  let isUser = $derived(role === 'user');
  let thinkingOpen = $state(false);
  let hasThinking = $derived(showThinking && thinking && thinking.steps && thinking.steps.length > 0);
</script>

<div class="flex {isUser ? 'justify-end' : 'justify-start'} mb-3">
  <div
    class="max-w-[85%] rounded-lg px-3 py-2 text-sm"
    style="
      background: {isUser ? 'var(--accent)' : 'var(--card-bg)'};
      color: {isUser ? 'white' : 'var(--text-primary)'};
      border: {isUser ? 'none' : '1px solid var(--card-border)'};
    "
  >
    <p class="whitespace-pre-wrap">{content}</p>

    {#if hasThinking}
      <button
        onclick={() => { thinkingOpen = !thinkingOpen; }}
        class="mt-2 text-[10px] uppercase tracking-wider flex items-center gap-1"
        style="color: var(--text-ghost);"
      >
        <span>{thinkingOpen ? '\u25BC' : '\u25B6'}</span>
        <span>Thinking ({thinking!.steps.length} steps)</span>
      </button>

      {#if thinkingOpen}
        <ThinkingTimeline thinking={thinking!} />
      {/if}
    {/if}

    {#if metadata?.workflowGenerated}
      <div
        class="mt-2 pt-2 border-t text-[11px] flex items-center gap-1"
        style="border-color: var(--card-border); color: var(--text-ghost);"
      >
        <span>Workflow generated</span>
      </div>
    {/if}
  </div>
</div>
