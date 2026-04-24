<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { slugify } from '$lib/canvas/slug';
  import PageHeader from '$lib/components/PageHeader.svelte';

  let { data } = $props();
  const canvases = $derived(data.canvases);
  const stats = $derived(data.stats);

  let titleDraft = $state('');
  let slugDraft = $state('');
  let slugEdited = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);

  const previewSlug = $derived(slugEdited ? slugify(slugDraft) : slugify(titleDraft));

  function formatTime(iso: string | null) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function formatPct(v: number | null) {
    if (v === null) return '—';
    return `${Math.round(v * 100)}%`;
  }

  async function createCanvas(e: Event) {
    e.preventDefault();
    const slug = previewSlug;
    const title = titleDraft.trim() || slug;
    if (!slug || busy) return;
    busy = true;
    error = null;
    try {
      const res = await fetch('/api/canvas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, title }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      titleDraft = '';
      slugDraft = '';
      slugEdited = false;
      await goto(`/jkai/canvas/${body.slug}`);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }

  async function removeCanvas(slug: string, title: string) {
    if (!confirm(`Delete canvas "${title}"? This drops its workflow, nodes, edges, runs, and chat history. Not reversible.`))
      return;
    try {
      const res = await fetch(`/api/canvas/${slug}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      await invalidateAll();
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  }
</script>

<svelte:head>
  <title>Canvases — JKAI</title>
</svelte:head>

<PageHeader title="Canvases">
  {#snippet meta()}
    <span class="idx-head-meta">
      <span>{canvases.length} {canvases.length === 1 ? 'canvas' : 'canvases'}</span>
    </span>
  {/snippet}
</PageHeader>

<div class="page">
  <header class="page-head">
    <p class="page-sub">
      Spatial workspaces. Each canvas is one workflow, one conversation, any number of LLM /
      parse / intel / agent nodes.
    </p>
  </header>

  <section class="stats">
    <div class="stat">
      <div class="stat-val">{stats.canvasCount}</div>
      <div class="stat-lbl">canvases</div>
    </div>
    <div class="stat">
      <div class="stat-val">{stats.nodeCount}</div>
      <div class="stat-lbl">nodes</div>
    </div>
    <div class="stat">
      <div class="stat-val">{stats.edgeCount}</div>
      <div class="stat-lbl">edges</div>
    </div>
    <div class="stat">
      <div class="stat-val">{stats.runs7d}</div>
      <div class="stat-lbl">runs · 7d</div>
    </div>
    <div class="stat">
      <div class="stat-val">{formatPct(stats.successRate7d)}</div>
      <div class="stat-lbl">success · 7d</div>
    </div>
  </section>

  <section class="create">
    <div class="sr-label">Create canvas</div>
    <form class="create-form" onsubmit={createCanvas}>
      <input
        class="create-input"
        type="text"
        bind:value={titleDraft}
        placeholder="Title (e.g. “Morning briefing”)"
        aria-label="Canvas title"
        disabled={busy}
      />
      <input
        class="create-input slug-input"
        type="text"
        value={previewSlug}
        oninput={(e) => {
          slugDraft = (e.target as HTMLInputElement).value;
          slugEdited = true;
        }}
        placeholder="slug"
        aria-label="Canvas slug"
        disabled={busy}
      />
      <button class="create-btn" type="submit" disabled={!previewSlug || busy}>
        {busy ? 'creating…' : '+ canvas'}
      </button>
    </form>
    {#if error}
      <div class="create-err">⚠ {error}</div>
    {/if}
    <div class="create-hint">
      url → <code>/jkai/canvas/{previewSlug || '<slug>'}</code>
    </div>
  </section>

  <section class="list">
    {#if canvases.length === 0}
      <div class="empty">No canvases yet. Create one above.</div>
    {:else}
      <div class="grid">
        {#each canvases as c (c.workflowId)}
          <article class="card">
            <a class="card-link" href={`/jkai/canvas/${c.slug}`}>
              <div class="card-head">
                <div class="card-title-block">
                  <span class="card-title">{c.title}</span>
                  <span class="card-slug">/{c.slug}</span>
                </div>
                <span class="trigger-pill" data-type={c.triggerType}>{c.triggerType}</span>
              </div>
              <div class="card-stats">
                <div class="mini">
                  <span class="mini-val">{c.nodeCount}</span>
                  <span class="mini-lbl">nodes</span>
                </div>
                <div class="mini">
                  <span class="mini-val">{c.edgeCount}</span>
                  <span class="mini-lbl">edges</span>
                </div>
                <div class="mini">
                  <span class="mini-val">
                    {#if c.latestRunStatus}
                      <span class="status-dot" data-status={c.latestRunStatus}></span>
                      {c.latestRunStatus}
                    {:else}
                      —
                    {/if}
                  </span>
                  <span class="mini-lbl">last run</span>
                </div>
              </div>
              <div class="card-foot">last run {formatTime(c.latestRunAt)}</div>
            </a>
            <button
              class="card-del"
              title="Delete canvas"
              onclick={() => removeCanvas(c.slug, c.title)}>✕</button
            >
          </article>
        {/each}
      </div>
    {/if}
  </section>
</div>

<style>
  .page {
    max-width: 960px;
    margin: 0 auto;
    padding: 48px 24px 80px;
    color: var(--text-primary);
  }
  .page-head {
    margin-bottom: 20px;
  }
  .idx-head-meta {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-muted);
  }
  .page-sub {
    color: var(--text-muted);
    font-size: 14px;
    margin: 0;
    max-width: 560px;
    line-height: 1.55;
  }

  .sr-label {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    color: var(--text-muted);
    margin-bottom: 8px;
  }

  .stats {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 1px;
    background: var(--card-border);
    border: 1px solid var(--card-border);
    margin-bottom: 24px;
  }
  .stat {
    padding: 14px 16px;
    background: var(--bg-section);
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .stat-val {
    font-family: var(--font-mono);
    font-size: 20px;
    color: var(--text-primary);
    line-height: 1.1;
  }
  .stat-lbl {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-muted);
  }
  @media (max-width: 640px) {
    .stats {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  .create {
    padding: 16px;
    border: 1px solid var(--card-border);
    background: var(--bg-section);
    margin-bottom: 24px;
  }
  .create-form {
    display: flex;
    gap: 8px;
    align-items: stretch;
  }
  .create-input {
    flex: 1;
    min-width: 0;
    font-family: var(--font-mono);
    font-size: 13px;
    padding: 8px 10px;
    border: 1px solid var(--card-border);
    background: var(--bg);
    color: var(--text-primary);
    outline: none;
  }
  .create-input:focus {
    border-color: var(--accent);
  }
  .slug-input {
    flex: 0 0 220px;
    color: var(--text-muted);
  }
  .create-btn {
    font-family: var(--font-mono);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    padding: 8px 16px;
    background: var(--accent);
    color: var(--bg);
    border: 1px solid var(--accent);
    cursor: pointer;
    white-space: nowrap;
  }
  .create-btn:hover:not(:disabled) {
    background: var(--accent-hover, #a84808);
  }
  .create-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .create-err {
    margin-top: 8px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: #c44;
  }
  .create-hint {
    margin-top: 10px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-ghost);
  }
  .create-hint code {
    background: var(--bg);
    padding: 1px 5px;
    border: 1px solid var(--card-border);
    color: var(--text-muted);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 10px;
  }
  .empty {
    padding: 40px 20px;
    text-align: center;
    color: var(--text-ghost);
    font-family: var(--font-mono);
    font-size: 12px;
    border: 1px dashed var(--card-border);
  }
  .card {
    display: flex;
    align-items: stretch;
    border: 1px solid var(--card-border);
    background: var(--bg);
    transition: border-color 0.12s;
    min-height: 128px;
  }
  .card:hover {
    border-color: var(--text-muted);
  }
  .card-link {
    flex: 1;
    padding: 12px 14px;
    color: var(--text-primary);
    text-decoration: none;
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
  }
  .card-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
  }
  .card-title-block {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }
  .card-title {
    font-weight: 500;
    font-size: 14px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .card-slug {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-ghost);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .card-stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
    margin-top: auto;
  }
  .mini {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .mini-val {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--text-primary);
    display: inline-flex;
    align-items: center;
    gap: 5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .mini-lbl {
    font-family: var(--font-mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-ghost);
  }
  .card-foot {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-ghost);
  }

  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--text-ghost);
    display: inline-block;
  }
  .status-dot[data-status='completed'] {
    background: #3a8a56;
  }
  .status-dot[data-status='failed'] {
    background: #c44;
  }
  .status-dot[data-status='running'] {
    background: var(--accent);
  }
  .status-dot[data-status='pending'] {
    background: var(--text-muted);
  }

  .trigger-pill {
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-family: var(--font-mono);
    font-size: 9px;
    padding: 2px 6px;
    border: 1px solid var(--card-border);
    color: var(--text-muted);
    flex-shrink: 0;
  }
  .trigger-pill[data-type='cron'] {
    border-color: var(--accent);
    color: var(--accent);
  }
  .trigger-pill[data-type='webhook'] {
    border-color: var(--text-primary);
    color: var(--text-primary);
  }
  .card-del {
    padding: 0 12px;
    background: transparent;
    border: none;
    border-left: 1px solid var(--card-border);
    color: var(--text-ghost);
    cursor: pointer;
    font-size: 14px;
  }
  .card-del:hover {
    background: rgba(196, 68, 68, 0.08);
    color: #c44;
  }
</style>
