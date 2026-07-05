<svelte:head><title>Agent Actions — Admin</title></svelte:head>
<script lang="ts">
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  let expandedId = $state<string | null>(null);
  let filter = $state('all');

  const filtered = $derived(
    filter === 'all'
      ? data.actions
      : data.actions.filter(a => a.actionType === filter)
  );

  const actionTypes = $derived([...new Set(data.actions.map(a => a.actionType))]);

  function fmtDate(d: Date | string | null): string {
    if (!d) return '—';
    return new Date(d).toLocaleString();
  }

  function fmtJson(obj: unknown): string {
    if (!obj) return '—';
    try { return JSON.stringify(obj, null, 2); } catch { return String(obj); }
  }
</script>

<PageWrap width="wide">
  <PageHeader
    kicker="Agent"
    title="Action Log"
    sub="Every tool call, LLM call, decision, and message — with tokens, cost, latency, input and output."
  >
    {#snippet actions()}
      <span class="nm-pill">{filtered.length} entries</span>
    {/snippet}
  </PageHeader>

  <div class="nm-tabs">
    <button class="nm-tab" class:active={filter === 'all'} onclick={() => (filter = 'all')}>
      All <span class="nm-tab-count">{data.actions.length}</span>
    </button>
    {#each actionTypes as type}
      <button class="nm-tab" class:active={filter === type} onclick={() => (filter = type)}>
        {type.replace('_', ' ')}
      </button>
    {/each}
  </div>

  {#if filtered.length === 0}
    <div class="nm-empty">No actions {filter === 'all' ? '' : `of type ${filter}`} recorded.</div>
  {:else}
    <div class="action-list">
      {#each filtered as action}
        <div class="action-card">
          <button class="action-head" onclick={() => expandedId = expandedId === action.id ? null : action.id}>
            <span class="action-type">{action.actionType.replace('_', ' ')}</span>
            <span class="action-summary">{action.toolName ?? action.reasoning?.slice(0, 100) ?? '—'}</span>
            {#if action.costUsd}<span class="action-meta">${action.costUsd.toFixed(4)}</span>{/if}
            {#if action.durationMs}<span class="action-meta">{action.durationMs}ms</span>{/if}
            <span class="action-time">{fmtDate(action.createdAt)}</span>
          </button>

          {#if expandedId === action.id}
            <div class="action-body">
              {#if action.reasoning}
                <div>
                  <span class="sr-label-tight">Reasoning</span>
                  <p class="hint-line">{action.reasoning}</p>
                </div>
              {/if}
              <div class="io-grid">
                {#if action.input}
                  <div>
                    <span class="sr-label-tight">Input</span>
                    <pre class="code">{fmtJson(action.input)}</pre>
                  </div>
                {/if}
                {#if action.output}
                  <div>
                    <span class="sr-label-tight">Output</span>
                    <pre class="code">{fmtJson(action.output)}</pre>
                  </div>
                {/if}
              </div>
              {#if action.error}
                <div class="banner banner-error">{action.error}</div>
              {/if}
              <div class="meta-line">
                {#if action.provider}<span>{action.provider}/{action.model}</span>{/if}
                {#if action.tokensInput}<span>{action.tokensInput} → {action.tokensOutput} tokens</span>{/if}
                {#if action.sessionId}<span>session: {action.sessionId.slice(0, 8)}…</span>{/if}
                <span>id: {action.id.slice(0, 8)}…</span>
              </div>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</PageWrap>

<style>
  .action-list { display: flex; flex-direction: column; gap: 2px; }
  .action-card {
    background: var(--bg-section);
    border: 1px solid transparent;
    transition: border-color 120ms ease;
  }
  .action-card:hover { border-color: var(--card-border); }

  .action-head {
    width: 100%;
    background: none;
    border: 0;
    padding: 0.45rem 0.7rem;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    cursor: pointer;
    text-align: left;
    color: inherit;
  }
  .action-type {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--accent);
    width: 100px;
    flex-shrink: 0;
  }
  .action-summary {
    flex: 1;
    font-size: 0.82rem;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .action-meta {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-ghost);
    flex-shrink: 0;
  }
  .action-time {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-ghost);
    width: 110px;
    text-align: right;
    flex-shrink: 0;
  }

  .action-body {
    padding: 0.6rem 0.85rem 0.7rem;
    border-top: 1px solid var(--divider);
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }
  .hint-line { margin: 0.25rem 0 0; font-size: 0.85rem; color: var(--text-secondary); }
  .io-grid { display: grid; gap: 0.6rem; grid-template-columns: 1fr 1fr; }
  @media (max-width: 760px) { .io-grid { grid-template-columns: 1fr; } }
  .code {
    font-family: var(--font-mono);
    font-size: 11px;
    background: var(--code-bg);
    color: var(--code-text);
    padding: 0.55rem 0.7rem;
    margin: 0.3rem 0 0;
    overflow: auto;
    max-height: 240px;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .meta-line {
    display: flex;
    gap: 1rem;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-ghost);
    flex-wrap: wrap;
  }
</style>
