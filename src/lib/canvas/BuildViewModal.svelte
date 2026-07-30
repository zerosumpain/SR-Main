<script lang="ts">
  /**
   * Full-screen overlay for BuildViewNode. Renders the iframe at the full
   * viewport size with a single floating control cluster in the bottom-right
   * (reload + open-in-tab + collapse). No header bar, no padding — gives
   * the in-progress app the most room possible.
   *
   * Esc collapses; clicking the floating ✕ collapses.
   */
  import { onMount, onDestroy } from 'svelte';
  import { portal } from './portal';

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

<div class="bvm-fs" use:portal role="dialog" aria-modal="true" aria-label="Build preview">
  <iframe
    bind:this={iframe}
    title="Build preview (full)"
    src={src}
    sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
  ></iframe>

  <!-- Floating control cluster, bottom-right. Tab order: reload, open, collapse. -->
  <div class="bvm-fab">
    <code class="bvm-id" title="Build id">{buildId.slice(0, 8)}</code>
    <a class="bvm-iconlink" href={src} target="_blank" rel="noreferrer" title="Open in new tab">↗</a>
    <button class="bvm-iconbtn" type="button" onclick={reload} title="Reload" aria-label="Reload">⟳</button>
    <button
      class="bvm-iconbtn bvm-collapse"
      type="button"
      onclick={onClose}
      title="Collapse (Esc)"
      aria-label="Collapse"
    >▾ collapse</button>
  </div>
</div>

<style>
  .bvm-fs {
    position: fixed;
    inset: 0;
    z-index: 9000;
    background: var(--bg, #ede4d4);
    display: block; /* iframe fills via 100vw/100vh */
  }
  .bvm-fs iframe {
    width: 100vw;
    height: 100vh;
    border: 0;
    display: block;
  }
  .bvm-fab {
    position: fixed;
    right: 16px;
    bottom: 16px;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 6px 8px;
    border: 1px solid var(--text-primary, #1f1c18);
    background: var(--bg, #ede4d4);
    z-index: 9001;
  }
  .bvm-id {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    padding-right: 4px;
    border-right: 1px dashed var(--card-border);
  }
  .bvm-iconlink,
  .bvm-iconbtn {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    line-height: 1;
    padding: 5px 9px;
    border: 1px solid var(--text-primary);
    background: var(--bg);
    color: var(--text-primary);
    cursor: pointer;
    text-decoration: none;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .bvm-iconlink:hover,
  .bvm-iconbtn:hover {
    background: var(--accent);
    color: var(--bg);
    border-color: var(--accent);
  }
  .bvm-collapse {
    color: var(--status-error, #c0392b);
    border-color: var(--status-error, #c0392b);
  }
  .bvm-collapse:hover {
    background: var(--status-error, #c0392b);
    color: var(--bg);
  }
</style>
