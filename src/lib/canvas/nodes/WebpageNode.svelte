<script lang="ts" module>
  export type WebpageConfig = {
    url: string;
    mode: 'direct' | 'proxied' | null;
    lastLoadedAt?: string;
    size: { w: number; h: number };
  };
  export type WebpageOutput = 'currentUrl' | 'selectedText' | 'extractedText';
</script>

<script lang="ts">
  type Props = {
    nodeId: string;
    config: WebpageConfig;
    onConfigChange: (patch: Partial<WebpageConfig>) => void;
    onOutput?: (handleId: WebpageOutput, value: string) => void;
  };

  let { nodeId, config, onConfigChange, onOutput }: Props = $props();

  let urlDraft = $state(config.url ?? '');
  let iframeEl: HTMLIFrameElement | undefined = $state();
  let fullscreen = $state(false);
  let statusText = $state('');
  let statusVisible = $state(false);
  let statusTimer: ReturnType<typeof setTimeout> | null = null;

  function showStatus(text: string) {
    statusText = text;
    statusVisible = true;
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => (statusVisible = false), 2000);
  }

  function isValidUrl(s: string): boolean {
    try {
      const u = new URL(s);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  }

  function load() {
    const target = urlDraft.trim();
    if (!target) return;
    if (!isValidUrl(target)) {
      showStatus('Invalid URL — must start with http(s)://');
      return;
    }
    // Direct-iframe only in C2. Proxy escalation lands in D4.
    onConfigChange({ url: target, mode: 'direct', lastLoadedAt: new Date().toISOString() });
  }

  function reload() {
    try {
      iframeEl?.contentWindow?.location.reload();
    } catch {
      if (config.url) onConfigChange({ url: config.url, mode: 'direct' });
    }
  }

  function toggleFullscreen() {
    fullscreen = !fullscreen;
  }

  $effect(() => {
    if (!iframeEl) return;
    function onLoad() {
      showStatus('Loaded · direct');
      if (config.url) onOutput?.('currentUrl', config.url);
    }
    iframeEl.addEventListener('load', onLoad);
    return () => iframeEl?.removeEventListener('load', onLoad);
  });

  $effect(() => {
    function onMsg(e: MessageEvent) {
      if (!iframeEl || e.source !== iframeEl.contentWindow) return;
      const data = e.data;
      if (data && typeof data === 'object') {
        if (data.type === 'webframe-selection' && typeof data.text === 'string') {
          onOutput?.('selectedText', data.text);
        }
      }
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  });

  $effect(() => {
    return () => {
      if (statusTimer) clearTimeout(statusTimer);
    };
  });

  // Re-sync draft when upstream config.url changes (e.g. set by upstream node in Phase E).
  $effect(() => {
    urlDraft = config.url ?? '';
  });
</script>

<div class="webpage-node" class:fullscreen>
  <div class="webpage-header" onpointerdown={(e) => e.stopPropagation()}>
    <button class="webpage-btn" onclick={reload} title="Reload" disabled={!config.url}>↻</button>
    <input
      class="webpage-url-bar"
      type="text"
      bind:value={urlDraft}
      onkeydown={(e) => e.key === 'Enter' && load()}
      placeholder="https://…"
      aria-label="URL"
    />
    <button class="webpage-btn" onclick={load} title="Load URL">Go</button>
    {#if config.url}
      <a class="webpage-btn" href={config.url} target="_blank" rel="noopener" title="Open in new tab">↗</a>
    {/if}
    <button class="webpage-btn" onclick={toggleFullscreen} title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
      {fullscreen ? '✕' : '⤢'}
    </button>
    {#if config.mode === 'proxied'}
      <span class="webpage-badge" title="Page is served through homeserv's webframe proxy">proxied</span>
    {/if}
  </div>

  <div class="webpage-viewport">
    {#if config.url}
      <iframe
        bind:this={iframeEl}
        src={config.url}
        sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        title="Webpage node {nodeId}"
      ></iframe>
    {:else}
      <div class="webpage-empty">Enter a URL above to load a page.</div>
    {/if}
  </div>

  {#if statusVisible}
    <div class="webpage-status">{statusText}</div>
  {/if}
</div>

<style>
  .webpage-node {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    background: var(--bg-2, #1a1a1a);
    border-radius: 6px;
    overflow: hidden;
    position: relative;
  }
  .webpage-node.fullscreen {
    position: fixed;
    inset: 20px;
    z-index: 900;
    border: 1px solid var(--border, #2a2a2a);
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45);
  }
  .webpage-header {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 6px;
    background: var(--bg-3, #252525);
    border-bottom: 1px solid var(--border, #2a2a2a);
    font-size: 12px;
    flex: 0 0 auto;
  }
  .webpage-url-bar {
    flex: 1;
    background: transparent;
    border: none;
    color: var(--fg, #e0e0e0);
    font: inherit;
    font-size: 12px;
    outline: none;
    padding: 2px 4px;
  }
  .webpage-btn {
    background: transparent;
    border: none;
    color: var(--fg-2, #a0a0a0);
    cursor: pointer;
    padding: 2px 6px;
    font: inherit;
    font-size: 12px;
    border-radius: 3px;
    text-decoration: none;
    display: inline-flex;
    align-items: center;
  }
  .webpage-btn:hover:not(:disabled) {
    background: var(--bg-4, #2e2e2e);
    color: var(--fg, #e0e0e0);
  }
  .webpage-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .webpage-badge {
    background: var(--accent-dim, #3a5074);
    color: var(--fg, #e0e0e0);
    font-size: 10px;
    padding: 1px 6px;
    border-radius: 8px;
    margin-left: 4px;
  }
  .webpage-viewport {
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
    background: #fff;
  }
  .webpage-viewport iframe {
    width: 100%;
    height: 100%;
    border: none;
    display: block;
  }
  .webpage-empty {
    padding: 24px;
    color: var(--fg-2, #a0a0a0);
    text-align: center;
    font-size: 12px;
  }
  .webpage-status {
    position: absolute;
    bottom: 4px;
    right: 4px;
    background: var(--bg-3, #252525);
    color: var(--fg-2, #a0a0a0);
    padding: 2px 6px;
    font-size: 11px;
    border-radius: 3px;
    pointer-events: none;
  }
</style>
