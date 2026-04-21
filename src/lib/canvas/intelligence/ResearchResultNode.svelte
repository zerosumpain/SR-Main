<script lang="ts">
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
    oncancel,
    ondone,
  } = $props<{
    engine: 'deep' | 'quick';
    topic: string;
    status: Status;
    report: string;
    sources: Source[];
    durationMs?: number | null;
    streamUrl?: string | null;
    oncancel: () => void;
    ondone: (res: { report: string; sources: Source[]; durationMs?: number }) => void;
  }>();

  let logLine = $state('');
  let es: EventSource | null = null;

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
        } else if (evt.type === 'status' && evt.data?.status === 'complete') {
          status = 'complete';
          ondone({ report, sources, durationMs: evt.data?.durationMs });
          es?.close();
        } else if (evt.type === 'complete') {
          status = 'complete';
          ondone({ report, sources, durationMs: evt.data?.durationMs });
          es?.close();
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

<div class="research-result" data-status={status}>
  <div class="header">
    <span class="kind-bar"></span>
    <span class="title">{engine === 'deep' ? 'Deep' : 'Quick'} · {topic}</span>
    {#if status === 'running' || status === 'pending'}
      <button type="button" class="cancel" onclick={oncancel}>cancel</button>
    {/if}
  </div>

  {#if status === 'running' || status === 'pending'}
    <div class="pending">
      <div class="spinner"></div>
      <div class="log">{logLine || 'Commissioning…'}</div>
    </div>
  {:else if status === 'failed'}
    <div class="failed">Research failed.</div>
  {:else}
    <div class="body">
      <div class="report">{report}</div>
      {#if sources?.length}
        <details class="sources">
          <summary>{sources.length} source{sources.length === 1 ? '' : 's'}</summary>
          <ul>
            {#each sources as s}
              <li><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a> <span class="domain">{s.domain}</span></li>
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
  .research-result {
    position: relative;
    width: 340px;
    height: 360px;
    background: var(--card-bg, #0c0e12);
    border: 1.5px solid #5dbea3;
    border-radius: 8px;
    color: var(--text-primary, #ddd);
    font-family: var(--font-mono, ui-monospace, monospace);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .research-result[data-status='pending'],
  .research-result[data-status='running'] {
    animation: intel-pulse 2s ease-in-out infinite;
  }
  .research-result[data-status='failed'] {
    border-color: #c44;
  }
  @keyframes intel-pulse {
    0%, 100% {
      box-shadow: 0 0 0 0 rgba(93, 190, 163, 0.35);
      border-color: #5dbea3;
    }
    50% {
      box-shadow: 0 0 0 8px rgba(93, 190, 163, 0);
      border-color: rgba(93, 190, 163, 0.55);
    }
  }
  .header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border-bottom: 1px solid var(--divider, #1c1f27);
    font-size: 11px;
    color: var(--text-muted);
    letter-spacing: 0.08em;
  }
  .kind-bar { width: 3px; align-self: stretch; background: #5dbea3; }
  .title { flex: 1; }
  .cancel {
    background: transparent;
    color: var(--text-muted);
    border: 1px solid var(--card-border);
    border-radius: 10px;
    padding: 0 6px;
    font: inherit;
    font-size: 10px;
    cursor: pointer;
  }
  .pending {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
  }
  .spinner {
    width: 16px; height: 16px;
    border: 2px solid var(--card-border);
    border-top-color: #5dbea3;
    border-radius: 50%;
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .log { color: var(--text-muted); font-size: 11px; text-align: center; padding: 0 12px; }
  .failed { padding: 12px; color: #c66; font-size: 11px; }
  .body { flex: 1; overflow: auto; padding: 8px 10px; font-size: 11px; }
  .report { white-space: pre-wrap; color: var(--text-primary); }
  .sources { margin-top: 8px; font-size: 10px; }
  .sources summary { cursor: pointer; color: var(--text-muted); }
  .sources ul { list-style: none; padding: 0; margin: 4px 0 0; }
  .sources a { color: var(--accent); text-decoration: none; }
  .domain { color: var(--text-ghost); margin-left: 6px; }
  .duration { color: var(--text-ghost); font-size: 9px; text-align: right; margin-top: 8px; }
</style>
