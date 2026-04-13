<script lang="ts">
  let {
    role,
    content,
    metadata,
  }: {
    role: 'user' | 'assistant' | 'system';
    content: string;
    metadata?: { workflowGenerated?: boolean };
  } = $props();

  let isUser = $derived(role === 'user');
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
    {#if metadata?.workflowGenerated}
      <div
        class="mt-2 pt-2 border-t text-[11px] flex items-center gap-1"
        style="border-color: {isUser ? 'rgba(255,255,255,0.2)' : 'var(--card-border)'}; color: {isUser ? 'rgba(255,255,255,0.7)' : 'var(--text-ghost)'};"
      >
        <span>Workflow generated</span>
      </div>
    {/if}
  </div>
</div>
