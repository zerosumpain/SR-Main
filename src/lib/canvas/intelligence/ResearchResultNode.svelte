<script lang="ts">
  import DeepResearchViewer from './DeepResearchViewer.svelte';
  import OpenAsWebpageButton from '../OpenAsWebpageButton.svelte';

  type Source = { url: string; title: string; domain: string };
  type Status = 'pending' | 'running' | 'complete' | 'failed';

  let {
    engine,
    topic,
    status = $bindable(),
    report = $bindable(),
    sources = $bindable(),
    durationMs,
    streamUrl,
    sessionId,
    nodeId,
    oncancel,
    ondone,
    onopenaswebpage,
  } = $props<{
    engine: 'deep' | 'quick';
    topic: string;
    status: Status;
    report: string;
    sources: Source[];
    durationMs?: number | null;
    streamUrl?: string | null;
    sessionId?: string | null;
    nodeId: string;
    oncancel: () => void;
    ondone: (res: { report: string; sources: Source[]; durationMs?: number }) => void;
    onopenaswebpage?: (e: { url: string; fromNodeId: string }) => void;
  }>();

  // ResizeObserver: measure the parent .chat-node and set --scroll-h
  // so that inner scroll containers get an explicit pixel height instead
  // of relying on the flex chain (which has repeatedly failed to propagate).
  let rrRootEl = $state<HTMLDivElement | null>(null);
  let rrHeaderEl = $state<HTMLDivElement | null>(null);

  // applyScrollH is called both by ResizeObserver and by the reactive $effect below.
  function applyScrollH(isDeep: boolean) {
    if (!rrRootEl) return;
    const chatNode = rrRootEl.parentElement;
    if (!chatNode) return;
    const nodeH = chatNode.getBoundingClientRect().height;
    const hdrH = rrHeaderEl ? rrHeaderEl.getBoundingClientRect().height : 27;
    // 36px = drv-tabs bar height in DeepResearchViewer (fixed, flex-shrink:0)
    // For quick engine there is no tab bar.
    const tabBarH = isDeep ? 36 : 0;
    const scrollH = Math.max(60, nodeH - hdrH - tabBarH);
    rrRootEl.style.setProperty('--scroll-h', `${scrollH}px`);
  }

  // Set up ResizeObserver on the parent .chat-node element.
  $effect(() => {
    const el = rrRootEl;
    if (!el) return;
    const chatNode = el.parentElement;
    if (!chatNode) return;
    const ro = new ResizeObserver(() => applyScrollH(showDeepViewer));
    ro.observe(chatNode);
    ro.observe(el);
    applyScrollH(showDeepViewer);
    return () => ro.disconnect();
  });

  // Re-apply when showDeepViewer changes (e.g. status flips to complete).
  $effect(() => {
    const isDeep = showDeepViewer;
    applyScrollH(isDeep);
  });

  let logLine = $state('');
  let es: EventSource | null = null;
  // Local state so the fetched report survives parent re-renders.
  let fetchedReport = $state('');
  let fetchedSources = $state<Source[]>([]);
  let fetchedSessionId = $state('');
  let fetchedDeepReport = $state<Record<string, unknown> | null>(null);
  let fetchError = $state<string | null>(null);

  const effectiveReport = $derived(report || fetchedReport);
  const effectiveSources = $derived((sources && sources.length ? sources : fetchedSources));

  // For deep+complete: the full report object for DeepResearchViewer
  const deepReportData = $derived(
    engine === 'deep' && status === 'complete' ? fetchedDeepReport : null,
  );
  const showDeepViewer = $derived(engine === 'deep' && status === 'complete' && !!sessionId);

  $effect(() => {
    if (status !== 'complete') return;
    const sid = sessionId;
    if (!sid || sid === fetchedSessionId) return;
    // A new / different session id was picked. Reset local fetched state and re-fetch.
    fetchedSessionId = sid;
    fetchedReport = '';
    fetchedSources = [];
    fetchedDeepReport = null;
    fetchError = null;
    const url = engine === 'deep' ? `/api/deepdive/${sid}` : `/api/quickanswer/${sid}`;
    (async () => {
      try {
        const resp = await fetch(url);
        if (!resp.ok) {
          fetchError = `Fetch failed (${resp.status})`;
          return;
        }
        const body = await resp.json();
        if (engine === 'deep') {
          const deepReport = body.report as Record<string, unknown> | string | null | undefined;
          if (typeof deepReport === 'object' && deepReport !== null) {
            fetchedDeepReport = deepReport as Record<string, unknown>;
            const execSummary = deepReport.executive_summary;
            if (typeof execSummary === 'string') fetchedReport = execSummary;
          } else if (typeof deepReport === 'string' && deepReport) {
            fetchedReport = deepReport;
          }
          if (Array.isArray(body.sources) && body.sources.length > 0) {
            fetchedSources = body.sources as Source[];
          }
        } else {
          if (typeof body.answer === 'string' && body.answer) {
            fetchedReport = body.answer;
          }
          if (Array.isArray(body.sources) && body.sources.length > 0) {
            fetchedSources = body.sources as Source[];
          }
        }
      } catch (err) {
        console.error('[research-result] fetch failed', err);
        fetchError = err instanceof Error ? err.message : 'Fetch failed';
      }
    })();
  });

  $effect(() => {
    if (status !== 'running' && status !== 'pending') return;
    if (!streamUrl) return;
    es = new EventSource(streamUrl);
    es.onmessage = (msg) => {
      try {
        const evt = JSON.parse(msg.data);
        if (evt.type === 'log' && typeof evt.message === 'string') {
          logLine = evt.message;
        } else if (evt.type === 'token' && evt.data?.token) {
          report = (report ?? '') + String(evt.data.token);
        } else if (evt.type === 'sources' && evt.data?.sources) {
          sources = evt.data.sources as Source[];
        } else if (
          (evt.type === 'status' && evt.data?.status === 'complete') ||
          evt.type === 'complete'
        ) {
          es?.close();
          status = 'complete';
          const evtDuration = evt.data?.durationMs;
          if (engine === 'deep' && !report) {
            (async () => {
              try {
                const sid = new URL(streamUrl!, location.origin).pathname.split('/')[3];
                const resp = await fetch(`/api/deepdive/${sid}`);
                if (resp.ok) {
                  const body = await resp.json();
                  const deepReport = body.report as Record<string, unknown> | null | undefined;
                  if (typeof deepReport?.executive_summary === 'string') {
                    report = deepReport.executive_summary;
                  }
                }
              } catch (err) {
                console.error('[research-result] fetch deep report failed', err);
              }
              ondone({ report, sources, durationMs: evtDuration });
            })();
          } else {
            ondone({ report, sources, durationMs: evtDuration });
          }
        } else if (evt.type === 'error') {
          status = 'failed';
          es?.close();
        }
      } catch {
        /* ignore malformed frames */
      }
    };
    es.onerror = () => {
      // Keep node in running state; user can cancel manually.
    };
    return () => {
      es?.close();
      es = null;
    };
  });
</script>

<!--
  This component is rendered as a DIRECT flex child of .chat-node.research-result-node
  (position:absolute; display:flex; flex-direction:column; overflow:hidden).
  It must fill that parent with flex:1 and provide scroll containers as direct flex children.
  No position:absolute here — that breaks the flex height chain.
-->
<div class="rr-root" data-status={status} bind:this={rrRootEl}>
  <div class="rr-header" bind:this={rrHeaderEl}>
    <span class="kind-bar"></span>
    <span class="title">{engine === 'deep' ? 'Deep' : 'Quick'} · {topic}</span>
    {#if status === 'running' || status === 'pending'}
      <button type="button" class="cancel" onclick={oncancel}>cancel</button>
    {/if}
    {#if status === 'complete' && sessionId}
      <a
        href="/deepdive/{sessionId}/dashboard"
        target="_blank"
        rel="noreferrer"
        class="open-link"
        title="Open full dashboard"
      >↗</a>
    {/if}
  </div>

  {#if status === 'running' || status === 'pending'}
    <div class="rr-pending">
      <div class="spinner"></div>
      <div class="log">{logLine || 'Commissioning…'}</div>
    </div>
  {:else if status === 'failed'}
    <div class="rr-failed">Research failed.</div>
  {:else if showDeepViewer}
    <!-- Deep research complete: rich tabbed viewer — direct flex child, fills remaining space -->
    <DeepResearchViewer
      sessionId={sessionId!}
      reportData={deepReportData}
    />
  {:else}
    <!-- Quick research or deep without session id: simple scrollable body -->
    <div class="rr-body">
      {#if effectiveReport}
        <div class="report">{effectiveReport}</div>
      {:else if fetchError}
        <div class="rr-failed">{fetchError}</div>
      {:else if sessionId}
        <div class="log">Loading session {sessionId.slice(0, 8)}…</div>
      {:else}
        <div class="log">Pick a session in the config panel, or wire an upstream node that emits <code>researchSessionId</code>.</div>
      {/if}
      {#if effectiveSources?.length}
        <details class="sources">
          <summary>{effectiveSources.length} source{effectiveSources.length === 1 ? '' : 's'}</summary>
          <ul>
            {#each effectiveSources as s}
              <li>
                <a href={s.url} target="_blank" rel="noreferrer">{s.title}</a>
                <span class="domain">{s.domain}</span>
                {#if onopenaswebpage}
                  <OpenAsWebpageButton url={s.url} sourceNodeId={nodeId} onCreate={onopenaswebpage} />
                {/if}
              </li>
            {/each}
          </ul>
        </details>
      {/if}
      {#if durationMs}
        <div class="duration">{(durationMs / 1000).toFixed(1)}s</div>
      {/if}
    </div>
  {/if}
</div>

<style>
  /*
    .rr-root is a direct flex child of .chat-node (position:absolute; display:flex; flex-direction:column; overflow:hidden).
    flex:1 makes it fill the remaining height after the header. overflow:hidden clips children.
    No position:absolute — we rely on the flex chain exactly like .chat-node-body does.
  */
  .rr-root {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--bg);
    color: var(--text-primary);
    font-family: var(--font-mono);
  }
  .rr-root[data-status='pending'],
  .rr-root[data-status='running'] {
    animation: intel-pulse 2s ease-in-out infinite;
  }
  @keyframes intel-pulse {
    0%, 100% {
      box-shadow: inset 0 0 0 0 rgba(93, 190, 163, 0.15);
    }
    50% {
      box-shadow: inset 0 0 12px 2px rgba(93, 190, 163, 0.12);
    }
  }
  .rr-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border-bottom: 1px solid var(--divider, #1c1f27);
    font-size: 11px;
    color: var(--text-muted);
    letter-spacing: 0.08em;
    flex-shrink: 0;
  }
  .kind-bar { width: 3px; align-self: stretch; background: #5dbea3; flex-shrink: 0; }
  .title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cancel {
    background: var(--bg);
    color: var(--text-muted);
    border: 1px solid var(--divider);
    border-radius: 10px;
    padding: 0 6px;
    font: inherit;
    font-size: 10px;
    cursor: pointer;
    flex-shrink: 0;
  }
  .cancel:hover { color: var(--text-primary); border-color: var(--text-muted); }
  .open-link {
    font-size: 10px;
    color: var(--text-muted);
    text-decoration: none;
    flex-shrink: 0;
  }
  .open-link:hover { color: #5dbea3; }
  .rr-pending {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
  }
  .spinner {
    width: 16px; height: 16px;
    border: 2px solid var(--divider);
    border-top-color: #5dbea3;
    border-radius: 50%;
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .log { color: var(--text-muted); font-size: 11px; text-align: center; padding: 0 12px; }
  .rr-failed { padding: 12px; color: #c66; font-size: 11px; flex-shrink: 0; }

  /*
    .rr-body — quick engine scroll container.
    Uses --scroll-h (set by ResizeObserver) for an explicit pixel height so the
    scroll container is guaranteed to have a concrete size regardless of flex chain.
  */
  .rr-body {
    height: var(--scroll-h, 300px);
    overflow-y: auto;
    overflow-x: hidden;
    padding: 8px 10px;
    font-size: 11px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex-shrink: 0;
    scrollbar-width: thin;
    scrollbar-color: #5dbea3 transparent;
  }
  .rr-body::-webkit-scrollbar { width: 10px; }
  .rr-body::-webkit-scrollbar-track { background: transparent; }
  .rr-body::-webkit-scrollbar-thumb {
    background: #2f5a50;
    border-radius: 5px;
    border: 2px solid var(--bg);
  }
  .rr-body::-webkit-scrollbar-thumb:hover { background: #5dbea3; }
  .report { white-space: pre-wrap; color: var(--text-primary); }
  .sources { margin-top: 4px; font-size: 10px; }
  .sources summary { cursor: pointer; color: var(--text-muted); }
  .sources ul { list-style: none; padding: 0; margin: 4px 0 0; }
  .sources a { color: var(--accent); text-decoration: none; }
  .domain { color: var(--text-ghost); margin-left: 6px; }
  .duration { color: var(--text-ghost); font-size: 9px; text-align: right; margin-top: 4px; }
</style>
