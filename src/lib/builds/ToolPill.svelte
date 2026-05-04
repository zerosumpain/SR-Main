<script lang="ts">
  import type { ToolEntry } from './feed';

  let { tool }: { tool: ToolEntry } = $props();

  // Auto-expand while a tool is streaming so the user sees the code being
  // written in real time. Initial value is taken once at mount; the user
  // can collapse manually after, and we keep their choice from then on.
  let open = $state(tool.status === 'running');

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
  <button
    class="tool-trigger"
    onclick={() => (open = !open)}
    type="button"
    aria-expanded={open}
    title={open ? 'Hide command' : 'Click to see the full command and output'}
  >
    <span class="caret">{open ? '▾' : '▸'}</span>
    <span class="status-dot" data-status={status}></span>
    <code class="name">{tool.name}</code>
    <span class="dim">{summary}{tool.argsRaw.length > 100 ? '…' : ''}</span>
    <span class="cue">{open ? 'hide' : 'view command'}</span>
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
  .tool-trigger {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    background: transparent;
    border: none;
    padding: 4px 6px;
    cursor: pointer;
    text-align: left;
    border-radius: 2px;
    transition: background 0.12s ease;
  }
  .tool-trigger:hover {
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }
  .tool.open .tool-trigger {
    background: color-mix(in srgb, var(--accent) 5%, transparent);
  }
  .caret {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--accent);
    width: 12px;
    flex-shrink: 0;
  }
  .name {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--accent);
    margin: 0 4px;
    flex-shrink: 0;
  }
  .dim {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    flex: 1;
  }
  .cue {
    font-family: var(--font-mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-ghost);
    border: 1px solid var(--card-border);
    padding: 2px 6px;
    flex-shrink: 0;
  }
  .tool-trigger:hover .cue {
    color: var(--accent);
    border-color: var(--accent);
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
