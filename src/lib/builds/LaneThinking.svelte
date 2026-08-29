<script lang="ts">
  let { content }: { content: string } = $props();
  let open = $state(false);

  const headline = $derived(
    content.split('\n').find((l) => l.trim().length > 0) ?? 'Thinking…',
  );
</script>

<div class="lane-thinking">
  <button
    class="thinking-trigger"
    onclick={() => (open = !open)}
    type="button"
    aria-expanded={open}
    title={open ? 'Hide thinking' : 'Click to expand the model’s reasoning'}
  >
    <span class="caret">{open ? '▾' : '▸'}</span>
    <span class="status-dot" data-status="pending"></span>
    <span class="lbl">thinking</span>
    <span class="head">{headline.slice(0, 100)}{headline.length > 100 ? '…' : ''}</span>
    <span class="cue">{open ? 'collapse' : 'expand'}</span>
  </button>
  {#if open}
    <pre>{content}</pre>
  {/if}
</div>

<style>
  .lane-thinking {
    margin: 0.4rem 0;
  }
  .thinking-trigger {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    background: transparent;
    border: none;
    padding: 4px 6px;
    cursor: pointer;
    text-align: left;
    border-radius: 2px;
    transition: background 0.12s ease;
  }
  .thinking-trigger:hover {
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }
  .caret {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--accent);
    width: 12px;
    flex-shrink: 0;
  }
  .lbl {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--accent);
    margin: 0 6px;
    flex-shrink: 0;
  }
  .head {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    text-transform: none;
    letter-spacing: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    flex: 1;
  }
  .cue {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-ghost);
    border: 1px solid var(--card-border);
    padding: 2px 6px;
    flex-shrink: 0;
  }
  .thinking-trigger:hover .cue {
    color: var(--accent);
    border-color: var(--accent);
  }
  pre {
    font-family: var(--font-code);
    font-size: var(--fs-label);
    color: var(--text-muted);
    margin: 0.3rem 0 0;
    padding: 8px 10px;
    background: var(--bg-section);
    border: 1px solid var(--card-border);
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>
