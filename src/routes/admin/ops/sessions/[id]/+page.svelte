<svelte:head><title>Hermes session — Admin</title></svelte:head>
<script lang="ts">
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';

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

<PageWrap width="wide">
  <PageHeader
    kicker="Hermes"
    title="Session"
    crumbs={[{ label: 'Sessions', href: '/admin/ops/sessions' }, { label: 'Session' }]}
  />

  {#if !data.available}
    <p class="host-note">
      The session store lives on the Hermes host — open
      <code>http://homeserv:5173/admin/ops/sessions</code> to inspect it.
    </p>
  {/if}

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
</PageWrap>

<style>
  .host-note { margin: 0 0 1.25rem; font-size: 0.9rem; line-height: 1.45; color: var(--text-secondary); max-width: 60ch; }
  code { font-family: var(--font-mono); font-size: 0.85em; background: var(--code-bg, var(--bg-section)); padding: 0.1em 0.35em; border-radius: var(--radius-sharp); }
  .mono { font-family: var(--font-mono); }

  .nm-sec { background: var(--card-bg); border: 1px solid var(--card-border); padding: 1rem 1.1rem; }
  .meta { margin-bottom: 1.25rem; }
  .meta-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.5rem 1.2rem; font-size: 12px; }
  .meta-grid > div { color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ml { display: inline-block; min-width: 5.5rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; font-size: 10px; }
  .conv-link { margin-top: 0.8rem; padding-top: 0.7rem; border-top: 1px solid var(--card-border); font-size: 0.88rem; color: var(--text-secondary); }
  .conv-link a { color: var(--accent); text-decoration: none; }
  .conv-link a:hover { text-decoration: underline; }

  .err { font-size: 0.9rem; color: var(--error); }
  .empty { font-size: 0.9rem; color: var(--text-secondary); }

  .thread { display: flex; flex-direction: column; gap: 0.6rem; }
  .msg { border: 1px solid var(--card-border); border-radius: var(--radius-round); padding: 0.55rem 0.75rem; background: var(--card-bg); }
  .msg[data-role='user'] { border-left: 3px solid var(--accent); }
  .msg[data-role='assistant'] { border-left: 3px solid var(--text-muted); }
  .msg[data-role='tool'] { background: var(--bg-section); }
  .msg-hdr { display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.35rem; }
  .role { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 600; }
  .role-user { color: var(--accent); }
  .role-assistant { color: var(--text-primary); }
  .role-tool { color: var(--text-muted); }
  .role-system { color: var(--error); }
  .tool-name { font-size: 10px; color: var(--text-secondary); background: var(--bg-section); padding: 0.1em 0.4em; border-radius: var(--radius-sharp); }
  .ts { font-size: 10px; color: var(--text-ghost); margin-left: auto; }
  .msg-body { font-size: 0.9rem; line-height: 1.5; color: var(--text-primary); white-space: pre-wrap; word-break: break-word; }
  .trunc { color: var(--text-muted); font-style: italic; }
  .tool-calls { margin-top: 0.4rem; }
  .tool-calls summary { font-size: 11px; color: var(--text-secondary); cursor: pointer; }
  .tool-calls pre { margin: 0.4rem 0 0; font-size: 11px; line-height: 1.4; color: var(--text-secondary); background: var(--bg-section); border-radius: var(--radius-round); padding: 0.5rem; overflow-x: auto; white-space: pre-wrap; word-break: break-word; }
</style>
