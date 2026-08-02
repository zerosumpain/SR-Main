<script lang="ts">
  import { goto, invalidateAll } from '$app/navigation';
  import { slugify } from '$lib/canvas/slug';
  import JkaiPageTitle from '$lib/components/jkai/JkaiPageTitle.svelte';
  import type { CanvasSummary } from '$lib/canvas/adapter';

  let { data } = $props();
  const canvases = $derived(data.canvases);
  const stats = $derived(data.stats);

  let titleDraft = $state('');
  let slugDraft = $state('');
  let slugEdited = $state(false);
  let busy = $state(false);
  let error = $state<string | null>(null);

  type SortKey = 'lastRun' | 'nodes' | 'lastEdited';
  let sortKey = $state<SortKey>('lastRun');

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

  const DAY_MS = 24 * 60 * 60 * 1000;

  function bucketLastRun(c: { latestRunAt: string | null }, now: number): string {
    if (!c.latestRunAt) return 'Never run';
    const age = now - new Date(c.latestRunAt).getTime();
    if (age < 1 * DAY_MS) return 'Last 24 hours';
    if (age < 7 * DAY_MS) return 'This week';
    if (age < 14 * DAY_MS) return 'Last 2 weeks';
    return 'Older than 2 weeks';
  }

  function bucketLastEdited(c: { updatedAt: string }, now: number): string {
    const age = now - new Date(c.updatedAt).getTime();
    if (age < 1 * DAY_MS) return 'Today';
    if (age < 7 * DAY_MS) return 'This week';
    if (age < 30 * DAY_MS) return 'This month';
    return 'Older';
  }

  function bucketNodes(c: { nodeCount: number }): string {
    if (c.nodeCount <= 5) return 'Small (1–5 nodes)';
    if (c.nodeCount <= 15) return 'Medium (6–15 nodes)';
    return 'Large (16+ nodes)';
  }

  const BUCKET_ORDER: Record<SortKey, string[]> = {
    lastRun: ['Last 24 hours', 'This week', 'Last 2 weeks', 'Older than 2 weeks', 'Never run'],
    lastEdited: ['Today', 'This week', 'This month', 'Older'],
    nodes: ['Large (16+ nodes)', 'Medium (6–15 nodes)', 'Small (1–5 nodes)'],
  };

  function sortValue(c: CanvasSummary, key: SortKey): number {
    if (key === 'lastRun') return c.latestRunAt ? new Date(c.latestRunAt).getTime() : 0;
    if (key === 'lastEdited') return new Date(c.updatedAt).getTime();
    return c.nodeCount;
  }

  // Health board: failing workflows surface in a dedicated bucket ABOVE the
  // normal grouping, whatever the sort — failures were previously invisible
  // unless each canvas was opened.
  const FAILING_STATUSES = new Set(['failed', 'completed_with_errors']);
  // Named so the header's Doctor link keys off the same string the bucket is
  // built with — two literals would drift.
  const FAILING_BUCKET = '⚠ Needs attention';

  const groupedCanvases = $derived.by(() => {
    const now = Date.now();
    const failing = canvases.filter((c) => c.latestRunStatus && FAILING_STATUSES.has(c.latestRunStatus));
    const rest = canvases.filter((c) => !c.latestRunStatus || !FAILING_STATUSES.has(c.latestRunStatus));
    const bucketed = new Map<string, CanvasSummary[]>();
    for (const c of rest) {
      const bucket =
        sortKey === 'lastRun'
          ? bucketLastRun(c, now)
          : sortKey === 'lastEdited'
            ? bucketLastEdited(c, now)
            : bucketNodes(c);
      if (!bucketed.has(bucket)) bucketed.set(bucket, []);
      bucketed.get(bucket)!.push(c);
    }
    for (const list of bucketed.values()) {
      list.sort((a, b) => sortValue(b, sortKey) - sortValue(a, sortKey));
    }
    failing.sort((a, b) => sortValue(b, sortKey) - sortValue(a, sortKey));
    const groups = BUCKET_ORDER[sortKey]
      .filter((name) => bucketed.has(name))
      .map((name) => ({ name, items: bucketed.get(name)! }));
    return failing.length > 0 ? [{ name: FAILING_BUCKET, items: failing }, ...groups] : groups;
  });

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

  let dupBusy = $state<string | null>(null);
  async function duplicateCanvas(slug: string) {
    if (dupBusy) return;
    dupBusy = slug;
    error = null;
    try {
      const res = await fetch(`/api/canvas/${slug}/duplicate`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      await goto(`/jkai/canvas/${body.slug}`);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      dupBusy = null;
    }
  }

  let importBusy = $state(false);
  let importInputEl: HTMLInputElement | undefined = $state();
  async function onImportPick(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file || importBusy) return;
    importBusy = true;
    error = null;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const res = await fetch('/api/canvas/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      await goto(`/jkai/canvas/${body.slug}`);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Import failed — is this a canvas export file?';
    } finally {
      importBusy = false;
      if (importInputEl) importInputEl.value = '';
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

<JkaiPageTitle title="Canvases">
  {#snippet meta()}
    <span class="idx-head-meta">
      <span>{canvases.length} {canvases.length === 1 ? 'canvas' : 'canvases'}</span>
    </span>
  {/snippet}
</JkaiPageTitle>

<div class="wrap">
  <header class="page-hdr">
    <div>
      <div class="kicker">JKAI</div>
      <h1>Canvases</h1>
      <p class="sub">
        Spatial workspaces. Each canvas is one workflow, one conversation, any number of
        <code>LLM</code> / <code>parse</code> / <code>intel</code> / <code>agent</code> nodes.
      </p>
    </div>
    <a class="back-link" href="/jkai">← JKAI</a>
  </header>

  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Overview</span>
    </div>
    <div class="stats">
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
    </div>
  </section>

  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Create canvas</span>
      <button
        type="button"
        class="row-link"
        disabled={importBusy}
        title="Create a canvas from an exported JSON file"
        onclick={() => importInputEl?.click()}
      >
        {importBusy ? 'Importing…' : 'Import JSON'}
      </button>
      <input
        bind:this={importInputEl}
        type="file"
        accept="application/json,.json"
        style="display: none"
        onchange={onImportPick}
      />
    </div>
    <form class="form" onsubmit={createCanvas}>
      <div class="row">
        <label class="field">
          <span class="sr-label-tight">Title <em>— free text</em></span>
          <input
            type="text"
            class="nm-text-input"
            bind:value={titleDraft}
            placeholder="Morning briefing"
            disabled={busy}
          />
        </label>
        <label class="field">
          <span class="sr-label-tight">Slug <em>— url segment</em></span>
          <input
            type="text"
            class="nm-text-input"
            value={previewSlug}
            oninput={(e) => {
              slugDraft = (e.target as HTMLInputElement).value;
              slugEdited = true;
            }}
            placeholder="morning-briefing"
            disabled={busy}
          />
        </label>
      </div>

      {#if error}
        <div class="err-line">⚠ {error}</div>
      {/if}

      <div class="form-actions">
        <button type="submit" class="nm-save-btn" disabled={!previewSlug || busy}>
          {busy ? 'Creating…' : '+ Canvas'}
        </button>
        <span class="hint">
          url → <code>/jkai/canvas/{previewSlug || '<slug>'}</code>
        </span>
      </div>
    </form>
  </section>

  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Canvases</span>
      <label class="sort-ctrl">
        <span class="sr-label-tight">Sort</span>
        <select class="nm-text-input sort-select" bind:value={sortKey}>
          <option value="lastRun">Last run (recent → older)</option>
          <option value="nodes">Node count (large → small)</option>
          <option value="lastEdited">Last edited (recent → older)</option>
        </select>
      </label>
      <span class="nm-sec-meta">
        {canvases.length} {canvases.length === 1 ? 'canvas' : 'canvases'}
      </span>
    </div>

    {#if canvases.length === 0}
      <div class="empty">No canvases yet. Create one above.</div>
    {:else}
      {#each groupedCanvases as group (group.name)}
        <div class="bucket">
          <div class="bucket-hd">
            <span class="bucket-name">{group.name}</span>
            <span class="bucket-count">{group.items.length}</span>
            {#if group.name === FAILING_BUCKET}
              <!-- The bucket names the casualties; the doctor says why. -->
              <a class="row-link bucket-doctor" href="/jkai/doctor">Doctor →</a>
            {/if}
          </div>
          <div class="grid">
            {#each group.items as c (c.workflowId)}
              <article class="canvas-card">
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
                          <span class="mini-muted">—</span>
                        {/if}
                      </span>
                      <span class="mini-lbl">last run</span>
                    </div>
                  </div>
                  <div class="card-foot">
                    <span>last run {formatTime(c.latestRunAt)}</span>
                    <span>edited {formatTime(c.updatedAt)}</span>
                  </div>
                </a>
                <div class="card-actions">
                  <button
                    type="button"
                    class="row-link"
                    title="Duplicate this canvas (nodes + edges; schedule NOT copied)"
                    disabled={dupBusy === c.slug}
                    onclick={() => duplicateCanvas(c.slug)}
                  >
                    {dupBusy === c.slug ? 'Duplicating…' : 'Duplicate'}
                  </button>
                  <a
                    class="row-link"
                    href={`/api/canvas/${c.slug}/export`}
                    download={`canvas-${c.slug}.json`}
                    title="Download this canvas as JSON"
                  >
                    Export
                  </a>
                  <button
                    type="button"
                    class="row-link danger card-del"
                    title="Delete canvas"
                    onclick={() => removeCanvas(c.slug, c.title)}
                  >
                    Delete
                  </button>
                </div>
              </article>
            {/each}
          </div>
        </div>
      {/each}
    {/if}
  </section>
</div>

<style>
  .wrap {
    max-width: 980px;
    margin: 2rem auto 4rem;
    padding: 0 1.5rem;
    color: var(--text-primary);
    font-family: var(--font-body);
  }
  .idx-head-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-muted);
  }

  .page-hdr {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 1.5rem;
    margin-bottom: 1.75rem;
    padding-bottom: 1rem;
    border-bottom: 2px solid var(--text-primary);
  }
  .kicker {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: var(--accent);
    margin-bottom: 0.35rem;
  }
  .page-hdr h1 {
    margin: 0;
    font-family: var(--font-display);
    font-size: 2rem;
    font-weight: 900;
    line-height: 1.05;
    color: var(--text-primary);
  }
  .sub {
    margin: 0.6rem 0 0;
    font-size: 0.95rem;
    line-height: 1.45;
    color: var(--text-secondary);
    max-width: 60ch;
  }
  .sub code, code {
    font-family: var(--font-mono);
    font-size: max(0.85em, var(--fs-label-xs));
    background: var(--code-bg);
    color: var(--code-text);
    padding: 0.08rem 0.38rem;
    border-radius: 2px;
  }
  .back-link {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--accent);
    text-decoration: none;
    flex-shrink: 0;
  }
  .back-link:hover { text-decoration: underline; }

  .nm-sec {
    background: var(--bg-section);
    border: 1px solid var(--card-border);
    padding: 1rem 1.1rem 1.15rem;
    margin-bottom: 1.25rem;
  }
  .nm-sec-hd {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    margin-bottom: 0.9rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--card-border);
  }
  .sr-label-tight {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-muted);
  }
  .nm-sec-meta {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    margin-left: auto;
  }
  .sort-ctrl {
    display: inline-flex;
    align-items: baseline;
    gap: 0.45rem;
  }
  .sort-select {
    width: auto;
    padding: 3px 6px;
    font-size: var(--fs-label);
    background: var(--bg);
    cursor: pointer;
  }

  /* ——— Buckets ——— */
  .bucket { margin-bottom: 1.1rem; }
  .bucket:last-child { margin-bottom: 0; }
  .bucket-hd {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
    margin-bottom: 0.55rem;
    padding-bottom: 0.35rem;
    border-bottom: 1px dashed var(--card-border);
  }
  .bucket-name {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--text-muted);
  }
  .bucket-count {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
  }
  /* Pushed to the far end of the header row; typography comes from .row-link. */
  .bucket-doctor { margin-left: auto; }

  /* ——— Stats ——— */
  .stats {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 1px;
    background: var(--card-border);
    border: 1px solid var(--card-border);
  }
  .stat {
    padding: 0.85rem 1rem;
    background: var(--bg);
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .stat-val {
    font-family: var(--font-mono);
    font-size: 1.25rem;
    color: var(--text-primary);
    line-height: 1.1;
  }
  .stat-lbl {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-muted);
  }
  @media (max-width: 640px) {
    .stats { grid-template-columns: repeat(2, 1fr); }
  }

  /* ——— Create form ——— */
  .form { display: grid; gap: 0.9rem; }
  .field { display: grid; gap: 0.35rem; min-width: 0; }
  .field em { color: var(--text-ghost); font-style: normal; font-weight: 400; }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.9rem; }
  @media (max-width: 640px) { .row { grid-template-columns: 1fr; } }

  .nm-text-input {
    width: 100%;
    font-family: var(--font-mono);
    font-size: var(--fs-body);
    color: var(--text-primary);
    background: rgba(26, 16, 8, 0.04);
    border: 1px solid var(--card-border);
    padding: 7px 10px;
    outline: none;
  }
  .nm-text-input:focus { border-color: var(--accent); background: var(--bg); }
  .nm-text-input::placeholder { color: var(--text-ghost); }
  .nm-text-input:disabled { opacity: 0.55; cursor: not-allowed; }

  .err-line {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--error);
    padding: 6px 8px;
    background: var(--error-bg);
    border-left: 2px solid var(--error);
  }
  .form-actions {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .hint {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-ghost);
  }

  .nm-save-btn {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.12em;
    padding: 6px 14px;
    background: var(--accent);
    color: var(--bg);
    border: 1px solid var(--accent);
    cursor: pointer;
  }
  .nm-save-btn:hover:not(:disabled) {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
  }
  .nm-save-btn:disabled { opacity: 0.55; cursor: not-allowed; }

  /* ——— Empty ——— */
  .empty {
    padding: 1.5rem;
    text-align: center;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-ghost);
    font-style: italic;
    border: 1px dashed var(--card-border);
  }

  /* ——— Canvas grid ——— */
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 0.6rem;
  }
  .canvas-card {
    position: relative;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    border: 1px solid var(--card-border);
    min-height: 140px;
    transition: border-color 80ms ease;
  }
  .canvas-card:hover { border-color: var(--text-primary); }

  .card-link {
    flex: 1;
    padding: 0.85rem 1rem 0.75rem;
    color: var(--text-primary);
    text-decoration: none;
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    min-width: 0;
  }
  .card-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.6rem;
  }
  .card-title-block {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }
  .card-title {
    font-family: var(--font-body);
    font-weight: 500;
    font-size: var(--fs-nav);
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .card-slug {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .trigger-pill {
    display: inline-flex;
    align-items: center;
    height: 18px;
    padding: 0 6px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    background: rgba(26, 16, 8, 0.04);
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

  .card-stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 0.4rem;
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
    font-size: var(--fs-label);
    color: var(--text-primary);
    display: inline-flex;
    align-items: center;
    gap: 5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .mini-muted { color: var(--text-ghost); }
  .mini-lbl {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-ghost);
  }
  .card-foot {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-ghost);
    padding-top: 0.35rem;
    border-top: 1px dashed var(--card-border);
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--text-ghost);
    display: inline-block;
  }
  .status-dot[data-status='completed'] { background: var(--success); }
  .status-dot[data-status='failed'] { background: var(--error); }
  .status-dot[data-status='running'] { background: var(--accent); }
  .status-dot[data-status='pending'] { background: var(--text-muted); }

  /* Delete as discreet row-link in corner, matches /drive */
  .row-link {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--accent);
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    text-decoration: none;
  }
  .row-link:hover { color: var(--accent-hover); text-decoration: underline; }
  .row-link.danger { color: var(--error); }
  .row-link.danger:hover { color: var(--error-hover); }
  .card-actions {
    position: absolute;
    top: 0.75rem;
    right: 0.85rem;
    display: flex;
    gap: 10px;
    align-items: center;
    opacity: 0;
    transition: opacity 120ms ease;
    /* Sits above the stretched card link so the actions stay clickable. */
    z-index: 1;
    background: var(--bg);
    padding-left: 6px;
  }
  .canvas-card:hover .card-actions,
  .card-actions:focus-within { opacity: 1; }
  /* Touch devices have no hover — keep the actions visible. */
  @media (hover: none) {
    .card-actions { opacity: 1; }
  }
</style>
