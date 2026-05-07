<script lang="ts">
  /**
   * BuildViewNode — iframe view of the in-progress app served by the build's
   * sandbox. URL is /api/jkai/proxy/<buildId>/ (or /projects/<slug>/ once
   * published). Two modes:
   *   - active  → refreshes on SSE 'stage' events (dev-server restart) and
   *               on manual reload click.
   *   - passive → loads once and stays put (snapshot for the canvas).
   *
   * Click expand → opens BuildViewModal, a full-screen overlay with the same
   * iframe + close.
   *
   * If sendUpstream is on and `inputData` is set, the iframe receives it
   * via window.postMessage(data, '*') after each load. (Build apps that opt
   * in can listen for it.)
   */
  import { onDestroy } from 'svelte';
  import BuildViewModal from '../BuildViewModal.svelte';

  type ViewConfig = {
    buildId?: string;
    mode?: 'active' | 'passive';
    expandable?: boolean;
    sendUpstream?: boolean;
    exposeOutputs?: boolean;
  };

  let {
    nodeId,
    config,
    resolvedBuildId,
    inputData,
    onConfigChange,
  }: {
    nodeId: string;
    config: ViewConfig;
    resolvedBuildId: string | null;
    inputData?: unknown;
    onConfigChange: (patch: Partial<ViewConfig>) => void;
  } = $props();
  void onConfigChange;
  void nodeId;

  const buildId = $derived(
    String(config.buildId ?? '').trim() || resolvedBuildId || '',
  );
  const mode = $derived((config.mode ?? 'active') as 'active' | 'passive');
  const expandable = $derived(config.expandable !== false);
  const sendUpstream = $derived(config.sendUpstream === true);

  let snapshot = $state<{
    status: string;
    serveConfig: unknown;
    publishedSlug: string | null;
  } | null>(null);

  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let es: EventSource | null = null;
  let cacheBust = $state(0);
  let modalOpen = $state(false);
  let iframe = $state<HTMLIFrameElement | undefined>(undefined);

  const previewLink = $derived.by(() => {
    if (!buildId) return null;
    if (snapshot?.publishedSlug) return `/projects/${snapshot.publishedSlug}/`;
    if (snapshot?.serveConfig) return `/api/jkai/proxy/${buildId}/`;
    return null;
  });

  const iframeSrc = $derived.by(() => {
    if (!previewLink) return '';
    return cacheBust > 0 ? `${previewLink}?v=${cacheBust}` : previewLink;
  });

  async function fetchSnapshot(): Promise<void> {
    if (!buildId) { snapshot = null; return; }
    try {
      const r = await fetch(`/api/jkai/builds/${buildId}`);
      if (!r.ok) return;
      const data = await r.json();
      const next = {
        status: data.status,
        serveConfig: data.serveConfig ?? null,
        publishedSlug: data.publishedSlug ?? null,
      };
      // Detect a new preview becoming available — bump cacheBust so iframe loads.
      const prev = snapshot;
      snapshot = next;
      if (mode === 'active' && (
        (!prev?.serveConfig && next.serveConfig) ||
        (prev?.publishedSlug !== next.publishedSlug)
      )) {
        cacheBust = Date.now();
      }
    } catch { /* swallow */ }
  }

  function disconnect(): void {
    if (es) { try { es.close(); } catch { /* swallow */ } es = null; }
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function connect(): void {
    if (!buildId || mode !== 'active') return;
    disconnect();
    // Light SSE — only used to detect 'stage' transitions for refresh.
    es = new EventSource(`/api/jkai/builds/${buildId}/stream`);
    es.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data);
        if (payload.type === 'stage') {
          // Stage event signals dev-server restart or preview swap. Reload.
          cacheBust = Date.now();
          void fetchSnapshot();
        }
      } catch { /* swallow */ }
    };
    pollTimer = setInterval(fetchSnapshot, 8000);
  }

  let lastBuildId = '';
  let lastMode = mode;
  $effect(() => {
    if (buildId !== lastBuildId || mode !== lastMode) {
      lastBuildId = buildId;
      lastMode = mode;
      disconnect();
      void fetchSnapshot();
      if (mode === 'active') connect();
    }
  });

  // Forward upstream data into iframe via postMessage when it changes.
  let lastInput: string | null = null;
  $effect(() => {
    if (!sendUpstream || !iframe || !iframeSrc) return;
    const next = inputData === undefined ? null : (() => {
      try { return JSON.stringify(inputData); } catch { return null; }
    })();
    if (next === null || next === lastInput) return;
    lastInput = next;
    // Wait for iframe load before posting (and after every src change).
    const post = () => {
      try { iframe?.contentWindow?.postMessage(inputData, '*'); } catch { /* swallow */ }
    };
    // Small delay to let iframe finish loading the new src.
    setTimeout(post, 350);
  });

  onDestroy(() => disconnect());

  function manualRefresh(): void {
    cacheBust = Date.now();
    void fetchSnapshot();
  }
</script>

<div class="bvn-body">
  <header class="bvn-status">
    {#if !buildId}
      <span class="bvn-empty-hdr">No build attached — connect a Builder Pi or set a Build ID.</span>
    {:else if !previewLink}
      <span class="bvn-pill" data-status={snapshot?.status ?? 'pending'}>{snapshot?.status ?? '…'}</span>
      <span class="bvn-empty-hdr">Preview not ready — waiting for the build's dev server.</span>
    {:else}
      <span class="bvn-pill" data-status={snapshot?.status ?? 'pending'}>{snapshot?.status ?? '…'}</span>
      <span class="bvn-meta">{mode}</span>
      <a class="bvn-link" href={previewLink} target="_blank" rel="noreferrer" title="Open in new tab">↗ open</a>
      <button class="bvn-act" type="button" onclick={manualRefresh} title="Reload iframe">⟳ reload</button>
      {#if expandable}
        <button class="bvn-act" type="button" onclick={() => modalOpen = true} title="Expand to full-screen modal">⛶ expand</button>
      {/if}
    {/if}
  </header>

  <div class="bvn-frame">
    {#if iframeSrc}
      <iframe
        bind:this={iframe}
        title="Build preview"
        src={iframeSrc}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      ></iframe>
    {:else}
      <div class="bvn-empty">
        {#if buildId}
          Waiting for the build's dev server to come up…
        {:else}
          Connect this view to a Builder Pi to render the in-progress app.
        {/if}
      </div>
    {/if}
  </div>
</div>

{#if modalOpen && previewLink}
  <BuildViewModal
    src={iframeSrc}
    buildId={buildId}
    inputData={sendUpstream ? inputData : undefined}
    onClose={() => modalOpen = false}
  />
{/if}

<style>
  .bvn-body {
    display: flex; flex-direction: column;
    width: 100%; height: 100%;
    box-sizing: border-box;
    overflow: hidden;
    background: var(--bg);
    color: var(--text-primary);
    font-family: var(--font-body);
  }
  .bvn-status {
    display: flex; align-items: center; gap: 0.5rem;
    padding: 0.4rem 0.6rem;
    border-bottom: 1px solid var(--card-border);
    flex-wrap: wrap;
    flex-shrink: 0;
  }
  .bvn-empty-hdr {
    font-family: var(--font-mono); font-size: 10px;
    color: var(--text-ghost); font-style: italic;
  }
  .bvn-pill {
    font-family: var(--font-mono); font-size: 9px;
    text-transform: uppercase; letter-spacing: 0.14em;
    padding: 2px 7px; border: 1px solid currentColor;
    color: var(--text-muted);
  }
  .bvn-pill[data-status='running'] { color: var(--accent); }
  .bvn-pill[data-status='completed'] { color: var(--status-success, #10b981); }
  .bvn-pill[data-status='failed'] { color: var(--status-error, #c0392b); }
  .bvn-meta {
    font-family: var(--font-mono); font-size: 10px;
    color: var(--text-muted);
    text-transform: uppercase; letter-spacing: 0.08em;
  }
  .bvn-link {
    font-family: var(--font-mono); font-size: 10px;
    color: var(--accent); text-decoration: none;
    margin-left: auto;
  }
  .bvn-link:hover { text-decoration: underline; }
  .bvn-act {
    font-family: var(--font-mono); font-size: 9px;
    text-transform: uppercase; letter-spacing: 0.1em;
    padding: 4px 9px;
    border: 1px solid var(--text-primary);
    background: var(--bg);
    color: var(--text-primary);
    cursor: pointer;
  }
  .bvn-act:hover { background: var(--accent); color: var(--bg); border-color: var(--accent); }

  .bvn-frame {
    flex: 1; min-height: 0;
    background: #fff;
    position: relative;
  }
  .bvn-frame iframe {
    width: 100%; height: 100%;
    border: 0;
    display: block;
  }
  .bvn-empty {
    color: var(--text-ghost);
    font-style: italic;
    font-size: 11px;
    padding: 1rem;
    text-align: center;
  }
</style>
