<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { slugify } from '$lib/canvas/slug';

  let { data } = $props();
  const canvases = $derived(data.canvases);

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

<div class="page">
  <header class="page-head">
    <div>
      <h1 class="page-title">Canvases</h1>
      <p class="page-sub">
        Spatial workspaces. Each canvas is one workflow, one conversation, any number of LLM /
        parse / intel / agent nodes.
      </p>
    </div>
  </header>

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
      {#each canvases as c (c.workflowId)}
        <article class="card">
          <a class="card-link" href={`/jkai/canvas/${c.slug}`}>
            <div class="card-title-row">
              <span class="card-title">{c.title}</span>
              <span class="card-slug">/{c.slug}</span>
            </div>
            <div class="card-meta">
              <span>{c.nodeCount} {c.nodeCount === 1 ? 'node' : 'nodes'}</span>
              <span class="sr-sep">·</span>
              <span>{c.edgeCount} {c.edgeCount === 1 ? 'edge' : 'edges'}</span>
              <span class="sr-sep">·</span>
              <span class="trigger-pill" data-type={c.triggerType}>trigger · {c.triggerType}</span>
              <span class="sr-sep">·</span>
              <span>last run {formatTime(c.latestRunAt)}</span>
              {#if c.latestRunStatus}
                <span class="sr-sep">·</span>
                <span class="status-{c.latestRunStatus}">{c.latestRunStatus}</span>
              {/if}
            </div>
          </a>
          <button
            class="card-del"
            title="Delete canvas"
            onclick={() => removeCanvas(c.slug, c.title)}>✕</button
          >
        </article>
      {/each}
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
    margin-bottom: 32px;
  }
  .page-title {
    font-family: var(--font-serif, var(--font-mono));
    font-size: 32px;
    font-weight: 500;
    letter-spacing: -0.02em;
    margin: 0 0 6px;
    line-height: 1.1;
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
  .sr-sep {
    color: var(--text-ghost);
    opacity: 0.5;
    padding: 0 4px;
  }

  .create {
    padding: 16px;
    border: 1px solid var(--card-border);
    background: var(--bg-section);
    margin-bottom: 32px;
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

  .list {
    display: flex;
    flex-direction: column;
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
  }
  .card:hover {
    border-color: var(--text-muted);
  }
  .card-link {
    flex: 1;
    padding: 14px 18px;
    color: var(--text-primary);
    text-decoration: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .card-title-row {
    display: flex;
    align-items: baseline;
    gap: 10px;
    flex-wrap: wrap;
  }
  .card-title {
    font-weight: 500;
    font-size: 15px;
  }
  .card-slug {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-ghost);
  }
  .card-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-muted);
  }
  .trigger-pill {
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-size: 9px;
    padding: 1px 6px;
    border: 1px solid var(--card-border);
    color: var(--text-muted);
  }
  .trigger-pill[data-type='manual'] {
    border-color: var(--card-border);
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
    padding: 0 14px;
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
  .status-completed {
    color: #3a8a56;
  }
  .status-failed {
    color: #c44;
  }
  .status-running {
    color: var(--accent);
  }
</style>
