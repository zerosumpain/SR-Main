<script lang="ts">
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
    thinking?: { proposal?: string; critique?: string; revision?: string | null };
    showThinking?: boolean;
  } = $props();

  let isUser = $derived(role === 'user');
  let thinkingOpen = $state(false);
  let hasThinking = $derived(showThinking && thinking && (thinking.proposal || thinking.critique));
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
        <span>{thinkingOpen ? '▼' : '▶'}</span>
        <span>Thinking steps</span>
      </button>

      {#if thinkingOpen}
        <div class="mt-2 space-y-2">
          {#if thinking?.proposal}
            <div class="rounded p-2 text-[11px]" style="background: rgba(0,0,0,0.05);">
              <div class="font-medium mb-1" style="color: var(--text-ghost); font-family: var(--font-mono);">1. PROPOSAL</div>
              <pre class="whitespace-pre-wrap break-words" style="color: var(--text-secondary); font-family: var(--font-mono); font-size: 10px; line-height: 1.5;">{thinking.proposal}</pre>
            </div>
          {/if}
          {#if thinking?.critique}
            <div class="rounded p-2 text-[11px]" style="background: rgba(0,0,0,0.05);">
              <div class="font-medium mb-1" style="color: var(--text-ghost); font-family: var(--font-mono);">2. CRITIQUE</div>
              <pre class="whitespace-pre-wrap break-words" style="color: var(--text-secondary); font-family: var(--font-mono); font-size: 10px; line-height: 1.5;">{thinking.critique}</pre>
            </div>
          {/if}
          {#if thinking?.revision}
            <div class="rounded p-2 text-[11px]" style="background: rgba(0,0,0,0.05);">
              <div class="font-medium mb-1" style="color: var(--text-ghost); font-family: var(--font-mono);">3. REVISION</div>
              <pre class="whitespace-pre-wrap break-words" style="color: var(--text-secondary); font-family: var(--font-mono); font-size: 10px; line-height: 1.5;">{thinking.revision}</pre>
            </div>
          {/if}
        </div>
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
