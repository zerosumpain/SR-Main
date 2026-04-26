<script lang="ts">
  import type { FileChange } from './parse-actions';

  let { changes }: { changes: FileChange[] } = $props();
  let openKey = $state<string | null>(null);

  function key(c: FileChange, i: number) {
    return `${i}:${c.path}:${c.iter}`;
  }
</script>

<section class="nm-sec">
  <header class="nm-sec-hd">
    <span class="sr-label-tight">Files</span>
  </header>
  {#if changes.length === 0}
    <p class="dim">No file edits yet.</p>
  {:else}
    <ul class="rows">
      {#each changes as c, i (key(c, i))}
        <li>
          <button
            class="row-link"
            onclick={() => (openKey = openKey === key(c, i) ? null : key(c, i))}
            type="button"
          >
            <span class="status-dot" data-status="completed"></span>
            <code>{c.path}</code>
            <span class="dim">iter {c.iter} · {c.action}</span>
          </button>
          {#if openKey === key(c, i)}
            <pre>{c.preview}</pre>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .rows {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  code {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-primary);
    margin: 0 6px;
  }
  .dim {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  pre {
    margin: 4px 0;
    padding: 8px 10px;
    background: var(--code-bg);
    color: var(--code-text);
    font-family: var(--font-mono);
    font-size: 11px;
    white-space: pre-wrap;
    word-break: break-word;
    border: 1px solid var(--card-border);
  }
</style>
