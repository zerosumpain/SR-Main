<script lang="ts">
  import type { ToolEntry } from './feed';

  let { tool }: { tool: ToolEntry } = $props();
  let open = $state(false);

  const status = $derived(
    tool.status === 'running'
      ? 'running'
      : tool.status === 'error'
        ? 'failed'
        : 'completed',
  );
  const summary = $derived(tool.argsRaw.replace(/\s+/g, ' ').slice(0, 100));
</script>

<div class="tool" class:open>
  <button class="row-link" onclick={() => (open = !open)} type="button">
    <span class="status-dot" data-status={status}></span>
    <code class="name">{tool.name}</code>
    <span class="dim">{summary}{tool.argsRaw.length > 100 ? '…' : ''}</span>
  </button>
  {#if open}
    <pre class="args">{tool.argsRaw}</pre>
    {#if tool.result}
      <pre class="result">{tool.result}</pre>
    {/if}
  {/if}
</div>

<style>
  .tool {
    border-left: 2px solid var(--card-border);
    padding: 2px 0 2px 8px;
  }
  .tool.open {
    border-left-color: var(--accent);
  }
  .name {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--accent);
    margin: 0 6px;
  }
  .dim {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 11px;
  }
  pre {
    font-family: var(--font-mono);
    font-size: 11px;
    margin: 4px 0;
    padding: 8px 10px;
    background: var(--code-bg);
    color: var(--code-text);
    border: 1px solid var(--card-border);
    white-space: pre-wrap;
    word-break: break-word;
  }
  pre.result {
    color: var(--text-primary);
    background: var(--bg-section);
  }
</style>
