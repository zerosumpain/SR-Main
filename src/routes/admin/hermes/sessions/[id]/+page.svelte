<svelte:head><title>Hermes session — Admin</title></svelte:head>
<script lang="ts">
  let { data } = $props();

  function fmtTs(epoch: number | null): string {
    if (!epoch) return '—';
    return new Date(epoch * 1000).toLocaleString();
  }
  function fmtTime(epoch: number): string {
    if (!epoch) return '';
    return new Date(epoch * 1000).toLocaleTimeString();
  }
  function fmtCost(c: number | null | undefined): string {
    if (c == null) return '—';
    return c < 0.01 ? `$${c.toFixed(4)}` : `$${c.toFixed(2)}`;
  }
</script>

<div class="wrap">
  <header class="page-hdr">
    <div class="hd-main">
      <div class="kicker">Hermes session</div>
      <h1>{data.session?.title || (data.available ? '(untitled session)' : 'Session inspector')}</h1>
      {#if !data.available}
        <p class="sub">
          The session store lives on the Hermes host — open
          <code>http://homeserv:5173/admin/hermes/sessions</code> to inspect it.
        </p>
      {/if}
    </div>
    <a class="back-link" href="/admin/hermes/sessions">← Sessions</a>
  </header>

  {#if data.available && data.session}
    {@const s = data.session}
    <section class="nm-sec meta">
      <div class="meta-grid mono">
        <div><span class="ml">id</span>{s.id}</div>
        <div><span class="ml">source</span>{s.source}</div>
        <div><span class="ml">model</span>{s.model ?? '—'}</div>
        <div><span class="ml">messages</span>{s.messageCount}</div>
        <div><span class="ml">tool calls</span>{s.toolCallCount}</div>
        <div><span class="ml">cost</span>{fmtCost(s.costUsd)}</div>
        <div><span class="ml">started</span>{fmtTs(s.startedAt)}</div>
        <div><span class="ml">ended</span>{s.endedAt ? fmtTs(s.endedAt) : 'open'}</div>
      </div>
      {#if s.conversationId}
        <div class="conv-link">
          Linked jkai conversation:
          <a href="/jkai" title={s.conversationId}>{s.conversationTitle || s.conversationId}</a>
        </div>
      {/if}
    </section>

    {#if data.error}
      <p class="err">Message load failed: {data.error}</p>
    {/if}

    <section class="thread">
      {#each data.messages as m, i (i)}
        <div class="msg" data-role={m.role}>
          <div class="msg-hdr mono">
            <span class="role role-{m.role}">{m.role}</span>
            {#if m.toolName}<span class="tool-name">{m.toolName}</span>{/if}
            <span class="ts">{fmtTime(m.timestamp)}</span>
          </div>
          {#if m.content}
            <div class="msg-body">{m.content}{#if m.truncated}<span class="trunc"> … (truncated)</span>{/if}</div>
          {/if}
          {#if m.toolCalls}
            <details class="tool-calls">
              <summary class="mono">tool_calls</summary>
              <pre>{m.toolCalls}</pre>
            </details>
          {/if}
        </div>
      {/each}
      {#if data.messages.length === 0 && !data.error}
        <p class="empty">No messages in this session.</p>
      {/if}
    </section>
  {/if}
</div>

<style>
  .wrap { max-width: 980px; margin: 2rem auto 4rem; padding: 0 1.5rem; color: var(--text-primary); }
  .page-hdr { display: flex; justify-content: space-between; align-items: flex-end; gap: 1.5rem; margin-bottom: 1.25rem; }
  .hd-main { min-width: 0; }
  .kicker { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.18em; color: var(--accent); }
  .page-hdr h1 { margin: 0.2rem 0 0; font-family: var(--font-brand, var(--font-display)); font-size: 1.4rem; font-weight: 500; word-break: break-word; }
  .sub { margin: 0.5rem 0 0; font-size: 0.9rem; color: var(--text-secondary); }
  code { font-family: var(--font-mono); font-size: 0.85em; background: var(--code-bg, var(--bg-section)); padding: 0.1em 0.35em; border-radius: 3px; }
  .back-link { font-family: var(--font-mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-secondary); text-decoration: none; white-space: nowrap; }
  .back-link:hover { text-decoration: underline; }
  .mono { font-family: var(--font-mono); }

  .nm-sec { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 10px; padding: 1rem 1.1rem; }
  .meta { margin-bottom: 1.25rem; }
  .meta-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.5rem 1.2rem; font-size: 12px; }
  .meta-grid > div { color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ml { display: inline-block; min-width: 5.5rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; font-size: 10px; }
  .conv-link { margin-top: 0.8rem; padding-top: 0.7rem; border-top: 1px solid var(--card-border); font-size: 0.88rem; color: var(--text-secondary); }
  .conv-link a { color: var(--accent); text-decoration: none; }
  .conv-link a:hover { text-decoration: underline; }

  .err { font-size: 0.9rem; color: var(--status-error, #b54242); }
  .empty { font-size: 0.9rem; color: var(--text-secondary); }

  .thread { display: flex; flex-direction: column; gap: 0.6rem; }
  .msg { border: 1px solid var(--card-border); border-radius: 8px; padding: 0.55rem 0.75rem; background: var(--card-bg); }
  .msg[data-role='user'] { border-left: 3px solid var(--accent); }
  .msg[data-role='assistant'] { border-left: 3px solid var(--text-muted); }
  .msg[data-role='tool'] { background: var(--bg-section); }
  .msg-hdr { display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.35rem; }
  .role { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 600; }
  .role-user { color: var(--accent); }
  .role-assistant { color: var(--text-primary); }
  .role-tool { color: var(--text-muted); }
  .role-system { color: var(--status-error, #b54242); }
  .tool-name { font-size: 10px; color: var(--text-secondary); background: var(--bg-section); padding: 0.1em 0.4em; border-radius: 3px; }
  .ts { font-size: 10px; color: var(--text-ghost, var(--text-muted)); margin-left: auto; }
  .msg-body { font-size: 0.9rem; line-height: 1.5; color: var(--text-primary); white-space: pre-wrap; word-break: break-word; }
  .trunc { color: var(--text-muted); font-style: italic; }
  .tool-calls { margin-top: 0.4rem; }
  .tool-calls summary { font-size: 11px; color: var(--text-secondary); cursor: pointer; }
  .tool-calls pre { margin: 0.4rem 0 0; font-size: 11px; line-height: 1.4; color: var(--text-secondary); background: var(--bg-section); border-radius: 5px; padding: 0.5rem; overflow-x: auto; white-space: pre-wrap; word-break: break-word; }
</style>
