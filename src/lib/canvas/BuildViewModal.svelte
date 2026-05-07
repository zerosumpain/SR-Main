<script lang="ts">
  /**
   * Full-screen overlay for BuildViewNode. Renders the same iframe at viewport
   * size so the user can interact with the in-progress app comfortably.
   * Esc closes; clicking the dimmed backdrop closes; Close button closes.
   */
  import { onMount, onDestroy } from 'svelte';

  let {
    src,
    buildId,
    inputData,
    onClose,
  }: {
    src: string;
    buildId: string;
    inputData?: unknown;
    onClose: () => void;
  } = $props();

  let iframe = $state<HTMLIFrameElement | undefined>(undefined);

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }

  onMount(() => {
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
  });
  onDestroy(() => {
    document.removeEventListener('keydown', onKey);
    document.body.style.overflow = '';
  });

  $effect(() => {
    if (inputData !== undefined && iframe) {
      const post = () => {
        try { iframe?.contentWindow?.postMessage(inputData, '*'); } catch { /* swallow */ }
      };
      setTimeout(post, 350);
    }
  });

  function reload(): void {
    if (iframe) {
      const u = src.includes('?') ? `${src}&_r=${Date.now()}` : `${src}?_r=${Date.now()}`;
      iframe.src = u;
    }
  }
</script>

<div
  class="bvm-backdrop"
  role="dialog"
  aria-modal="true"
  aria-label="Build preview"
  onclick={(e) => { if (e.target === e.currentTarget) onClose(); }}
>
  <div class="bvm-shell">
    <header class="bvm-bar">
      <span class="bvm-label">BUILD VIEW</span>
      <code class="bvm-id">{buildId.slice(0, 8)}</code>
      <span class="bvm-spacer"></span>
      <a class="bvm-link" href={src} target="_blank" rel="noreferrer" title="Open in new tab">↗ open in tab</a>
      <button class="bvm-btn" type="button" onclick={reload} title="Reload">⟳ reload</button>
      <button class="bvm-btn bvm-close" type="button" onclick={onClose} title="Close (Esc)">✕ close</button>
    </header>
    <div class="bvm-frame">
      <iframe
        bind:this={iframe}
        title="Build preview (full)"
        src={src}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      ></iframe>
    </div>
  </div>
</div>

<style>
  .bvm-backdrop {
    position: fixed;
    inset: 0;
    z-index: 9000;
    background: color-mix(in srgb, #000 70%, transparent);
    display: flex;
    align-items: stretch;
    justify-content: stretch;
    padding: 1.5rem;
    box-sizing: border-box;
  }
  .bvm-shell {
    flex: 1;
    display: flex;
    flex-direction: column;
    background: var(--bg, #ede4d4);
    border: 2px solid var(--text-primary, #1f1c18);
    box-shadow: 0 16px 48px color-mix(in srgb, #000 50%, transparent);
    min-height: 0;
  }
  .bvm-bar {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid var(--card-border);
    flex-shrink: 0;
  }
  .bvm-label {
    font-family: var(--font-mono);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.2em;
    color: var(--text-primary);
  }
  .bvm-id {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-muted);
  }
  .bvm-spacer { flex: 1; }
  .bvm-link {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--accent);
    text-decoration: none;
  }
  .bvm-link:hover { text-decoration: underline; }
  .bvm-btn {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    padding: 5px 11px;
    border: 1px solid var(--text-primary);
    background: var(--bg);
    color: var(--text-primary);
    cursor: pointer;
  }
  .bvm-btn:hover { background: var(--accent); color: var(--bg); border-color: var(--accent); }
  .bvm-close { color: var(--status-error, #c0392b); border-color: var(--status-error, #c0392b); }
  .bvm-close:hover { background: var(--status-error, #c0392b); color: var(--bg); }
  .bvm-frame {
    flex: 1;
    min-height: 0;
    background: #fff;
    position: relative;
  }
  .bvm-frame iframe {
    width: 100%;
    height: 100%;
    border: 0;
    display: block;
  }
</style>
