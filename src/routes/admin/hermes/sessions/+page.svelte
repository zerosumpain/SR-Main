<svelte:head><title>Hermes sessions — Admin</title></svelte:head>
<script lang="ts">
  let { data } = $props();

  function fmtTs(epoch: number): string {
    if (!epoch) return '—';
    return new Date(epoch * 1000).toLocaleString();
  }
  function fmtCost(c: number | null): string {
    if (c == null) return '—';
    return c < 0.01 ? `$${c.toFixed(4)}` : `$${c.toFixed(2)}`;
  }
  function sourceHref(s: string): string {
    const p = new URLSearchParams();
    if (s !== 'jkai') p.set('source', s);
    const qs = p.toString();
    return qs ? `?${qs}` : '?';
  }
</script>

<div class="wrap">
  <header class="page-hdr">
    <div>
      <div class="kicker">Hermes</div>
      <h1>Session inspector</h1>
      <p class="sub">
        {#if data.available}
          Read-only view of the engine's SQLite session store on <code>{data.hostname}</code>.
        {:else}
          The session store lives on the Hermes host. Open
          <code>http://homeserv:5173/admin/hermes/sessions</code> to inspect it
          (host <code>{data.hostname}</code> can't read it).
        {/if}
      </p>
    </div>
    <a class="back-link" href="/admin/hermes">← Hermes</a>
  </header>

  {#if data.available}
    <section class="nm-sec">
      <div class="toolbar">
        <div class="sources">
          {#each data.sources as s (s)}
            <a class="src-pill" class:active={s === data.source} href={sourceHref(s)} data-sveltekit-noscroll>{s}</a>
          {/each}
        </div>
        <form method="GET" class="search">
          <input type="hidden" name="source" value={data.source} />
          <input
            class="nm-text-input search-input"
            type="search"
            name="q"
            value={data.q}
            placeholder="Search message content…"
            autocomplete="off"
          />
          <button type="submit" class="nm-save-btn">Search</button>
          {#if data.q}
            <a class="clear-link" href={sourceHref(data.source)}>clear</a>
          {/if}
        </form>
      </div>

      {#if data.error}
        <p class="err">Query failed: {data.error}</p>
      {:else if data.q}
        <!-- Search results -->
        {#if data.hits.length === 0}
          <p class="empty">No messages match <code>{data.q}</code> in <code>{data.source}</code> sessions.</p>
        {:else}
          <p class="result-count">{data.hits.length} match{data.hits.length === 1 ? '' : 'es'} for <code>{data.q}</code></p>
          <ul class="hit-list">
            {#each data.hits as hit (hit.sessionId + hit.snippet)}
              <li>
                <a class="hit" href={`/admin/hermes/sessions/${hit.sessionId}`}>
                  <div class="hit-title">{hit.title || '(untitled)'}</div>
                  <div class="hit-snip">{hit.snippet}</div>
                  <div class="hit-meta mono">{hit.sessionId} · {fmtTs(hit.startedAt)}</div>
                </a>
              </li>
            {/each}
          </ul>
        {/if}
      {:else if data.sessions.length === 0}
        <p class="empty">No <code>{data.source}</code> sessions in the store.</p>
      {:else}
        <!-- Session list -->
        <div class="rows">
          {#each data.sessions as s (s.id)}
            <a class="row" href={`/admin/hermes/sessions/${s.id}`}>
              <div class="row-main">
                <div class="row-title">
                  {s.title || '(untitled)'}
                  {#if !s.endedAt}<span class="live-dot" title="open session"></span>{/if}
                </div>
                <div class="row-sub mono">
                  {s.id}
                  {#if s.conversationTitle}<span class="conv-chip" title="linked jkai conversation">jkai · {s.conversationTitle}</span>{/if}
                </div>
              </div>
              <div class="row-stats mono">
                <span title="messages">{s.messageCount} msg</span>
                <span title="tool calls">{s.toolCallCount} tools</span>
                {#if s.model}<span class="row-model" title="model">{s.model}</span>{/if}
                <span title="cost">{fmtCost(s.costUsd)}</span>
                <span class="row-date">{fmtTs(s.startedAt)}</span>
              </div>
            </a>
          {/each}
        </div>
      {/if}
    </section>
  {/if}
</div>

<style>
  .wrap { max-width: 980px; margin: 2rem auto 4rem; padding: 0 1.5rem; color: var(--text-primary); }
  .page-hdr { display: flex; justify-content: space-between; align-items: flex-end; gap: 1.5rem; margin-bottom: 1.5rem; }
  .kicker { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.18em; color: var(--accent); }
  .page-hdr h1 { margin: 0.2rem 0 0; font-family: var(--font-brand, var(--font-display)); font-size: 1.6rem; font-weight: 500; }
  .sub { margin: 0.6rem 0 0; font-size: 0.92rem; line-height: 1.45; color: var(--text-secondary); max-width: 60ch; }
  code { font-family: var(--font-mono); font-size: 0.85em; background: var(--code-bg, var(--bg-section)); padding: 0.1em 0.35em; border-radius: 3px; }
  .back-link { font-family: var(--font-mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-secondary); text-decoration: none; white-space: nowrap; }
  .back-link:hover { text-decoration: underline; }
  .mono { font-family: var(--font-mono); }

  .nm-sec { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 10px; padding: 1rem 1.1rem; }

  .toolbar { display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap; margin-bottom: 0.9rem; }
  .sources { display: flex; gap: 0.4rem; }
  .src-pill { font-family: var(--font-mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; padding: 0.2rem 0.55rem; border: 1px solid var(--card-border); border-radius: 5px; color: var(--text-secondary); text-decoration: none; }
  .src-pill.active { color: var(--bg, #fff); background: var(--accent); border-color: var(--accent); }
  .search { display: flex; align-items: center; gap: 0.5rem; }
  .search-input { min-width: 16rem; }
  .clear-link { font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary); }

  .empty, .result-count, .err { font-size: 0.9rem; color: var(--text-secondary); margin: 0.4rem 0; }
  .err { color: var(--status-error, #b54242); }

  .rows { display: flex; flex-direction: column; }
  .row { display: flex; justify-content: space-between; align-items: center; gap: 1rem; padding: 0.6rem 0.4rem; border-bottom: 1px solid var(--card-border); text-decoration: none; color: inherit; }
  .row:last-child { border-bottom: none; }
  .row:hover { background: var(--bg-section); }
  .row-main { min-width: 0; }
  .row-title { font-size: 0.95rem; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 0.4rem; }
  .row-sub { font-size: 11px; color: var(--text-ghost, var(--text-muted)); margin-top: 0.15rem; display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .conv-chip { color: var(--accent); }
  .live-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--status-success, #3ba55d); flex-shrink: 0; }
  .row-stats { display: flex; align-items: center; gap: 0.8rem; font-size: 11px; color: var(--text-muted); white-space: nowrap; }
  .row-model { max-width: 12ch; overflow: hidden; text-overflow: ellipsis; }
  .row-date { color: var(--text-ghost, var(--text-muted)); }

  .hit-list { list-style: none; margin: 0.4rem 0 0; padding: 0; display: flex; flex-direction: column; gap: 0.5rem; }
  .hit { display: block; padding: 0.6rem 0.7rem; border: 1px solid var(--card-border); border-radius: 7px; text-decoration: none; color: inherit; }
  .hit:hover { background: var(--bg-section); }
  .hit-title { font-size: 0.92rem; color: var(--text-primary); }
  .hit-snip { font-size: 0.85rem; color: var(--text-secondary); margin: 0.25rem 0; line-height: 1.4; word-break: break-word; }
  .hit-meta { font-size: 10px; color: var(--text-ghost, var(--text-muted)); }

  @media (max-width: 640px) {
    .row { flex-direction: column; align-items: flex-start; gap: 0.3rem; }
    .row-stats { flex-wrap: wrap; }
  }
</style>
