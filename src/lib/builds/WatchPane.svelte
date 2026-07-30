<script lang="ts">
  import { onMount } from 'svelte';
  import TinkerEditor from './TinkerEditor.svelte';

  let {
    buildId,
    mode = 'watch',
    status = 'running',
  }: {
    buildId: string;
    mode?: 'watch' | 'tinker';
    status?: string;
  } = $props();

  type FileEntry = { path: string; size: number; mtime: number };

  let files = $state<FileEntry[]>([]);
  let openPath = $state<string | null>(null);
  let openContent = $state('');
  let loadingTree = $state(false);
  let loadingFile = $state(false);
  let error = $state<string | null>(null);

  async function refresh() {
    loadingTree = true;
    error = null;
    try {
      const r = await fetch(`/api/jkai/builds/${buildId}/files`);
      const body = await r.json();
      files = body.files ?? [];
      if (body.error) error = body.error;
    } catch (e) {
      error = (e as Error).message;
    } finally {
      loadingTree = false;
    }
  }

  async function openFile(p: string) {
    openPath = p;
    loadingFile = true;
    try {
      const r = await fetch(`/api/jkai/builds/${buildId}/files/${encodeURI(p)}`);
      const body = await r.json();
      openContent = body.content ?? '';
    } catch (e) {
      openContent = `Error: ${(e as Error).message}`;
    } finally {
      loadingFile = false;
    }
  }

  onMount(() => {
    refresh();
  });
</script>

<section class="nm-sec watch">
  <header class="nm-sec-hd">
    <span class="sr-label-tight">{mode === 'tinker' ? 'Sandbox files (tinker)' : 'Sandbox files (read-only)'}</span>
    <button class="row-link" onclick={refresh} type="button">↻ refresh</button>
  </header>
  {#if error}
    <p class="err">{error}</p>
  {/if}
  <div class="split">
    <ul class="tree">
      {#if loadingTree}
        <li class="dim">loading…</li>
      {:else if files.length === 0}
        <li class="dim">No files yet.</li>
      {:else}
        {#each files as f (f.path)}
          <li>
            <button
              class="row-link tree-row"
              class:active={openPath === f.path}
              onclick={() => openFile(f.path)}
              type="button"
            >
              <code>{f.path}</code>
            </button>
          </li>
        {/each}
      {/if}
    </ul>
    <div class="viewer-wrap">
      {#if mode === 'tinker' && openPath}
        {#key openPath}
          <TinkerEditor
            buildId={buildId}
            path={openPath}
            status={status}
            content={openContent}
            onSaved={refresh}
          />
        {/key}
      {:else}
        <pre class="viewer">{loadingFile ? 'loading…' : openContent || (openPath ? '' : 'Select a file to view its contents.')}</pre>
      {/if}
    </div>
  </div>
</section>

<style>
  .watch :global(.row-link) {
    margin-left: auto;
  }
  .split {
    display: grid;
    grid-template-columns: 280px 1fr;
    gap: 12px;
    min-height: 320px;
  }
  .tree {
    list-style: none;
    padding: 8px;
    margin: 0;
    max-height: 60vh;
    overflow-y: auto;
    border: 1px solid var(--card-border);
    background: var(--bg);
  }
  .tree li {
    margin: 0;
  }
  .tree-row {
    display: block;
    width: 100%;
    text-align: left;
    padding: 2px 0;
  }
  code {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-primary);
  }
  .tree-row.active code {
    color: var(--accent);
  }
  .viewer-wrap {
    min-width: 0;
  }
  .viewer {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    padding: 10px 12px;
    background: var(--code-bg);
    color: var(--code-text);
    border: 1px solid var(--card-border);
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 60vh;
    overflow: auto;
    margin: 0;
  }
  .dim {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: var(--fs-label);
  }
  .err {
    color: var(--status-error);
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    margin: 0 0 0.5rem;
  }
</style>
