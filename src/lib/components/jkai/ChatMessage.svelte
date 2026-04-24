<script lang="ts">
  import { Marked } from 'marked';
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

  const marked = new Marked({ gfm: true, breaks: true });

  let renderedContent = $derived(
    role === 'assistant' ? marked.parse(content) as string : ''
  );

  let isUser = $derived(role === 'user');
  let thinkingOpen = $state(true);
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
    {#if isUser}
      <p class="whitespace-pre-wrap">{content}</p>
    {:else}
      <div class="chat-markdown">{@html renderedContent}</div>
    {/if}

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

<style>
  .chat-markdown :global(p) {
    margin: 0 0 0.5em;
  }
  .chat-markdown :global(p:last-child) {
    margin-bottom: 0;
  }
  .chat-markdown :global(strong) {
    font-weight: 600;
  }
  .chat-markdown :global(em) {
    font-style: italic;
  }
  .chat-markdown :global(code) {
    font-family: var(--font-mono);
    font-size: 0.85em;
    background: rgba(0, 0, 0, 0.1);
    padding: 0.1em 0.35em;
    border-radius: 3px;
  }
  .chat-markdown :global(pre) {
    margin: 0.5em 0;
    padding: 0.6em 0.8em;
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.15);
    overflow-x: auto;
    font-size: 0.8em;
  }
  .chat-markdown :global(pre code) {
    background: none;
    padding: 0;
    font-size: inherit;
  }
  .chat-markdown :global(ul),
  .chat-markdown :global(ol) {
    margin: 0.3em 0;
    padding-left: 1.4em;
  }
  .chat-markdown :global(li) {
    margin: 0.15em 0;
  }
  .chat-markdown :global(h1),
  .chat-markdown :global(h2),
  .chat-markdown :global(h3) {
    font-weight: 600;
    margin: 0.5em 0 0.25em;
  }
  .chat-markdown :global(h1) { font-size: 1.1em; }
  .chat-markdown :global(h2) { font-size: 1.05em; }
  .chat-markdown :global(h3) { font-size: 1em; }
  .chat-markdown :global(blockquote) {
    border-left: 3px solid var(--card-border);
    padding-left: 0.8em;
    margin: 0.4em 0;
    color: var(--text-secondary);
  }
  .chat-markdown :global(a) {
    color: var(--accent);
    text-decoration: underline;
  }
  .chat-markdown :global(hr) {
    border: none;
    border-top: 1px solid var(--card-border);
    margin: 0.5em 0;
  }
</style>
