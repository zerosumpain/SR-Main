<script lang="ts">
  import type { RagCollection } from '$lib/db/schema';

  type SelFile = { id: string; name: string; mimeType: string };

  let { files, onClose, onCreated }: {
    files: SelFile[];
    onClose: () => void;
    onCreated: (c: RagCollection) => void;
  } = $props();

  // Client-side hint only — the server is authoritative on what it can index.
  function indexable(f: SelFile): boolean {
    const m = (f.mimeType || '').toLowerCase();
    const ext = (f.name.split('.').pop() ?? '').toLowerCase();
    if (m.startsWith('audio/') || m.startsWith('video/') || m.startsWith('image/')) return false;
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'mp4', 'webm', 'mov', 'mp3', 'wav', 'ogg', 'm4a', 'zip'].includes(ext)) return false;
    return true;
  }

  const usable = $derived(files.filter(indexable));
  const skipped = $derived(files.filter((f) => !indexable(f)));

  let name = $state(defaultName());
  let busy = $state(false);
  let error = $state<string | null>(null);

  function defaultName(): string {
    if (!files.length) return 'Documents';
    const base = (files[0].name.split('/').pop() ?? files[0].name).replace(/\.[^.]+$/, '');
    return files.length === 1 ? base : `${base} +${files.length - 1}`;
  }

  async function build() {
    if (busy || !usable.length) return;
    busy = true;
    error = null;
    try {
      const res = await fetch('/api/files/rag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileIds: usable.map((f) => f.id), name: name.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `create failed (${res.status})`);
      onCreated(data.collection as RagCollection);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      busy = false;
    }
  }

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && !busy && onClose()} />

<div class="im-backdrop" use:portal onclick={() => !busy && onClose()} role="presentation">
  <div class="im-modal" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Interact using model">
    <header class="im-hdr">
      <span class="im-kicker">Interact using model</span>
      <h2 class="im-title">Build a knowledge base</h2>
      <p class="im-sub">Index the selected files so you can chat with them. The index is embedded with a quality model and stored persistently.</p>
    </header>

    <div class="im-body">
      <label class="im-label" for="im-name">Name</label>
      <input id="im-name" class="im-input" type="text" bind:value={name} maxlength="80" disabled={busy} />

      <div class="im-files">
        <div class="im-files-hd">
          <span class="im-count">{usable.length} file{usable.length === 1 ? '' : 's'} to index</span>
        </div>
        <ul class="im-list">
          {#each usable as f}
            <li class="im-file"><span class="im-dot im-ok"></span>{f.name.split('/').pop()}</li>
          {/each}
          {#each skipped as f}
            <li class="im-file im-skip"><span class="im-dot"></span>{f.name.split('/').pop()} <em>— not text, skipped</em></li>
          {/each}
        </ul>
      </div>

      {#if !usable.length}
        <p class="im-warn">None of the selected files contain indexable text. Pick documents like PDF, Word, Markdown, CSV, code or plain text.</p>
      {/if}
      {#if error}
        <p class="im-warn">{error}</p>
      {/if}
    </div>

    <footer class="im-foot">
      <button type="button" class="im-cancel" onclick={onClose} disabled={busy}>Cancel</button>
      <button type="button" class="im-build" onclick={build} disabled={busy || !usable.length}>
        {busy ? 'Building…' : 'Build & open chat'}
      </button>
    </footer>
  </div>
</div>

<style>
  .im-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1001;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    background: color-mix(in srgb, var(--text-primary) 45%, transparent);
    backdrop-filter: blur(2px);
  }
  .im-modal {
    width: min(460px, 100%);
    max-height: 88vh;
    display: flex;
    flex-direction: column;
    background: var(--surface-elevated);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md, 4px);
    overflow: hidden;
  }
  .im-hdr {
    padding: 18px 20px 14px;
    border-bottom: 1px solid var(--line-strong);
  }
  .im-kicker {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--accent);
  }
  .im-title {
    font-family: var(--font-display);
    font-size: 21px;
    line-height: 1.15;
    color: var(--text-primary);
    margin: 4px 0 6px;
  }
  .im-sub {
    font-family: var(--font-body);
    font-size: var(--fs-label);
    line-height: 1.5;
    color: var(--text-secondary);
    margin: 0;
  }
  .im-body {
    padding: 16px 20px;
    overflow-y: auto;
  }
  .im-label {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-muted);
    margin-bottom: 5px;
  }
  .im-input {
    width: 100%;
    font-family: var(--font-body);
    font-size: var(--fs-nav);
    padding: 8px 10px;
    background: var(--bg);
    border: 1px solid var(--line-strong);
    color: var(--text-primary);
    border-radius: var(--radius-sharp, 2px);
  }
  .im-input:focus { outline: none; border-color: var(--accent); }
  .im-files { margin-top: 16px; }
  .im-files-hd {
    display: flex;
    justify-content: space-between;
    margin-bottom: 6px;
  }
  .im-count {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-muted);
  }
  .im-list {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 200px;
    overflow-y: auto;
    border: 1px solid var(--line-strong);
  }
  .im-file {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-secondary);
    border-bottom: 1px solid var(--divider, var(--card-border));
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .im-file:last-child { border-bottom: 0; }
  .im-skip { color: var(--text-ghost); }
  .im-skip em { font-style: normal; color: var(--text-ghost); }
  .im-dot {
    width: 6px;
    height: 6px;
    border-radius: 100px;
    background: var(--text-ghost);
    flex-shrink: 0;
  }
  .im-ok { background: var(--success, #2d7a3a); }
  .im-warn {
    margin: 12px 0 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.5;
    color: var(--error);
  }
  .im-foot {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 14px 20px;
    border-top: 1px solid var(--line-strong);
  }
  .im-cancel {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 8px 14px;
    background: var(--bg);
    border: 1px solid var(--line-strong);
    color: var(--text-secondary);
    cursor: pointer;
  }
  .im-cancel:disabled { opacity: 0.5; }
  .im-build {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 8px 16px;
    background: var(--accent);
    color: #fff;
    border: 1px solid var(--accent);
    cursor: pointer;
  }
  .im-build:disabled { opacity: 0.45; cursor: default; }
  .im-build:not(:disabled):hover { background: var(--accent-hover, var(--accent)); }
</style>
