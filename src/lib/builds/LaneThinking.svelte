<script lang="ts">
  let { content }: { content: string } = $props();
  let open = $state(false);

  const headline = $derived(
    content.split('\n').find((l) => l.trim().length > 0) ?? 'Thinking…',
  );
</script>

<div class="lane-thinking">
  <button class="row-link" onclick={() => (open = !open)} type="button">
    <span class="status-dot" data-status="pending"></span>
    <span class="lbl">{open ? '−' : '+'} thinking</span>
    <span class="head">{headline.slice(0, 100)}{headline.length > 100 ? '…' : ''}</span>
  </button>
  {#if open}
    <pre>{content}</pre>
  {/if}
</div>

<style>
  .lane-thinking {
    margin: 0.4rem 0;
  }
  .lbl {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--accent);
    margin: 0 6px;
  }
  .head {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 11px;
    text-transform: none;
    letter-spacing: 0;
  }
  pre {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-muted);
    margin: 0.3rem 0 0;
    padding: 8px 10px;
    background: var(--bg-section);
    border: 1px solid var(--card-border);
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>
