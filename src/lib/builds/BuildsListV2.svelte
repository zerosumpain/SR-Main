<script lang="ts">
  import PageHeader from '$lib/components/PageHeader.svelte';

  type Build = {
    id: string;
    title: string | null;
    prompt: string;
    status: string;
    iterationsCompleted: number | null;
    tokensUsed: number | null;
    budgetConfig: any;
    publishedSlug: string | null;
    planStatus: string | null;
    serveConfig: any;
    origin: 'manual' | 'hermes' | string | null;
    createdAt: string | Date;
  };

  let { builds: initialBuilds }: { builds: Build[] } = $props();
  let builds = $state<Build[]>(initialBuilds);
  let busyId = $state<string | null>(null);
  let selected = $state<Set<string>>(new Set());
  let bulkBusy = $state(false);
  let openMenuId = $state<string | null>(null);
  let filter = $state<'all' | 'running' | 'queued' | 'paused' | 'awaiting' | 'completed' | 'failed' | 'published' | 'hermes'>('all');
  let toast = $state<{ kind: 'ok' | 'err'; text: string } | null>(null);

  function showToast(kind: 'ok' | 'err', text: string) {
    toast = { kind, text };
    setTimeout(() => { toast = null; }, 2200);
  }

  function bucket(b: Build): string {
    if (b.status === 'running') return 'running';
    if (b.status === 'queued') return 'queued';
    if (b.status === 'paused') return 'paused';
    if (b.status === 'awaiting_plan_approval' || b.status === 'awaiting_iter_approval' || b.planStatus === 'pending') return 'awaiting';
    if (b.status === 'failed') return 'failed';
    if (b.status === 'completed') return 'completed';
    return 'completed';
  }

  let filtered = $derived(
    filter === 'all'
      ? builds
      : filter === 'published'
        ? builds.filter((b) => b.publishedSlug)
        : filter === 'hermes'
          ? builds.filter((b) => b.origin === 'hermes')
          : builds.filter((b) => bucket(b) === filter),
  );

  function counts() {
    const c: Record<string, number> = {
      all: builds.length,
      running: 0, queued: 0, paused: 0, awaiting: 0, completed: 0, failed: 0,
      published: builds.filter((b) => b.publishedSlug).length,
      hermes: builds.filter((b) => b.origin === 'hermes').length,
    };
    for (const b of builds) c[bucket(b)] = (c[bucket(b)] || 0) + 1;
    return c;
  }
  let cnt = $derived(counts());

  function summary(config: any): string {
    const parts: string[] = [];
    if (config?.maxIterations) parts.push(`${config.maxIterations} iter cap`);
    if (config?.maxTotalMinutes) parts.push(`${config.maxTotalMinutes}m total`);
    return parts.join(' · ');
  }

  function formatTime(iso: string | Date | null) {
    if (!iso) return '—';
    const d = typeof iso === 'string' ? new Date(iso) : iso;
    return d.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function toggleSelected(id: string, e: Event) {
    e.preventDefault();
    e.stopPropagation();
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selected = next;
  }

  function selectAll() {
    if (selected.size === filtered.length && filtered.length > 0) {
      selected = new Set();
    } else {
      selected = new Set(filtered.map((b) => b.id));
    }
  }

  function clearSelection() { selected = new Set(); }

  async function bulkDelete() {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} build${selected.size === 1 ? '' : 's'}?\nAll iterations and logs will be removed.`)) return;
    bulkBusy = true;
    const ids = Array.from(selected);
    let okCount = 0, errCount = 0;
    for (const id of ids) {
      try {
        const res = await fetch(`/api/jkai/builds/${id}`, { method: 'DELETE' });
        if (res.ok) {
          builds = builds.filter((b) => b.id !== id);
          okCount++;
        } else {
          errCount++;
        }
      } catch {
        errCount++;
      }
    }
    selected = new Set();
    bulkBusy = false;
    showToast(errCount === 0 ? 'ok' : 'err', `Deleted ${okCount}${errCount ? ` · ${errCount} failed` : ''}`);
  }

  async function callAction(id: string, path: string, label: string, opts: { method?: 'POST' | 'DELETE'; refresh?: boolean } = {}) {
    busyId = id;
    openMenuId = null;
    try {
      const res = await fetch(path, { method: opts.method ?? 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        showToast('err', body.error || `${label} failed`);
        return null;
      }
      showToast('ok', `${label} ✓`);
      if (opts.refresh) {
        try {
          const r = await fetch('/api/jkai/builds');
          if (r.ok) {
            const list = (await r.json()) as Build[];
            const map = new Map(list.map((b) => [b.id, b]));
            builds = builds.map((b) => map.get(b.id) ?? b);
          }
        } catch {}
      }
      return await res.json().catch(() => ({}));
    } finally {
      busyId = null;
    }
  }

  async function deleteOne(b: Build) {
    openMenuId = null;
    if (!confirm(`Delete "${b.title ?? b.prompt.slice(0, 60)}"?\nAll iterations and logs will be removed.`)) return;
    busyId = b.id;
    try {
      const res = await fetch(`/api/jkai/builds/${b.id}`, { method: 'DELETE' });
      if (res.ok) {
        builds = builds.filter((x) => x.id !== b.id);
        showToast('ok', 'Deleted');
      } else {
        showToast('err', 'Delete failed');
      }
    } finally {
      busyId = null;
    }
  }

  async function publishOne(b: Build) {
    const result = await callAction(b.id, `/api/jkai/builds/${b.id}/publish`, 'Published', { refresh: true });
    if (result?.ok && result.url) {
      window.open(result.url, '_blank', 'noopener');
    }
  }

  async function copyPreviewLink(b: Build) {
    openMenuId = null;
    if (!b.publishedSlug) return;
    const url = `${window.location.origin}/projects/${b.publishedSlug}/`;
    try {
      await navigator.clipboard.writeText(url);
      showToast('ok', 'Link copied');
    } catch {
      showToast('err', 'Copy failed');
    }
  }

  function onDocClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest('.kebab-wrap')) openMenuId = null;
  }
</script>

<svelte:head>
  <title>Builds — JKAI</title>
</svelte:head>

<svelte:window onclick={onDocClick} />

<PageHeader title="Builds">
  {#snippet meta()}
    <span class="idx-head-meta">
      <span>{builds.length} {builds.length === 1 ? 'build' : 'builds'}</span>
    </span>
  {/snippet}
</PageHeader>

<div class="wrap">
  <header class="page-hdr">
    <div>
      <div class="kicker">JKAI</div>
      <h1>Builds</h1>
      <p class="sub">
        Autonomous AI development. <code>plan</code>-first, <code>design-system</code>-locked, fully observable.
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
        <div class="stat-val">{cnt.all}</div>
        <div class="stat-lbl">total</div>
      </div>
      <div class="stat">
        <div class="stat-val">{cnt.running}</div>
        <div class="stat-lbl">running</div>
      </div>
      <div class="stat">
        <div class="stat-val">{cnt.awaiting}</div>
        <div class="stat-lbl">awaiting</div>
      </div>
      <div class="stat">
        <div class="stat-val">{cnt.completed}</div>
        <div class="stat-lbl">completed</div>
      </div>
      <div class="stat">
        <div class="stat-val">{cnt.published}</div>
        <div class="stat-lbl">published</div>
      </div>
    </div>
  </section>

  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Builds</span>
      <span class="nm-sec-meta">
        {filtered.length} of {builds.length}
      </span>
      <a class="nm-save-btn header-cta" href="/jkai/builds/new">+ New build</a>
    </div>

    <div class="filters">
      {#each [
        { k: 'all', label: 'All' },
        { k: 'running', label: 'Running' },
        { k: 'queued', label: 'Queued' },
        { k: 'awaiting', label: 'Awaiting' },
        { k: 'paused', label: 'Paused' },
        { k: 'completed', label: 'Completed' },
        { k: 'failed', label: 'Failed' },
        { k: 'published', label: 'Published' },
        { k: 'hermes', label: 'From Hermes' },
      ] as f (f.k)}
        <button
          class="chip"
          class:active={filter === f.k}
          onclick={() => { filter = f.k as any; }}
          type="button"
        >
          {f.label}
          <span class="chip-n">{cnt[f.k] ?? 0}</span>
        </button>
      {/each}
    </div>

    {#if filtered.length === 0}
      {#if builds.length === 0}
        <div class="empty">No builds yet. <a class="row-link" href="/jkai/builds/new">+ start one</a>.</div>
      {:else}
        <div class="empty">No builds match this filter.</div>
      {/if}
    {:else}
      <div class="bulk-bar" class:visible={selected.size > 0}>
        <button class="link" type="button" onclick={selectAll}>
          {selected.size === filtered.length && filtered.length > 0 ? 'Deselect all' : 'Select all'}
        </button>
        <span class="dim">{selected.size} selected</span>
        <span class="spacer"></span>
        <button class="link danger" type="button" onclick={bulkDelete} disabled={bulkBusy}>
          {bulkBusy ? 'Deleting…' : `Delete ${selected.size}`}
        </button>
        <button class="link" type="button" onclick={clearSelection}>Cancel</button>
      </div>

      <div class="grid">
        {#each filtered as b (b.id)}
          {@const isSelected = selected.has(b.id)}
          {@const isPublished = !!b.publishedSlug}
          {@const canPause = b.status === 'running'}
          {@const canResume = b.status === 'paused'}
          {@const canRestart = b.status === 'failed'}
          {@const canStop = b.status === 'running' || b.status === 'paused'}
          {@const canCancelQueue = b.status === 'queued'}
          {@const canPublish = b.serveConfig && !isPublished}
          {@const isBusy = busyId === b.id}
          {@const buc = bucket(b)}
          {@const isHermes = b.origin === 'hermes'}
          <article
            class="build-card"
            class:selected={isSelected}
            class:hermes={isHermes}
            data-status={buc}
            data-origin={b.origin ?? 'manual'}
          >
            <div class="card-toolbar">
              <button
                class="check"
                type="button"
                aria-label={isSelected ? 'Deselect' : 'Select'}
                aria-pressed={isSelected}
                onclick={(e) => toggleSelected(b.id, e)}
              >
                {#if isSelected}✓{:else}&nbsp;{/if}
              </button>

              {#if isHermes}
                <span class="origin-flag" title="Built by Hermes via chat/WhatsApp">Hermes</span>
              {/if}

              <div class="quick-actions">
                {#if canPublish}
                  <button
                    type="button"
                    class="quick-btn"
                    title="Publish to /projects/"
                    disabled={isBusy}
                    onclick={(e) => { e.preventDefault(); e.stopPropagation(); publishOne(b); }}
                  >Publish</button>
                {/if}
                {#if isPublished}
                  <button
                    type="button"
                    class="quick-btn"
                    title="Copy /projects/ link"
                    onclick={(e) => { e.preventDefault(); e.stopPropagation(); copyPreviewLink(b); }}
                  >Copy link</button>
                {/if}
                {#if canPause}
                  <button
                    type="button"
                    class="quick-btn"
                    title="Pause build"
                    disabled={isBusy}
                    onclick={(e) => { e.preventDefault(); e.stopPropagation(); callAction(b.id, `/api/jkai/builds/${b.id}/pause`, 'Paused', { refresh: true }); }}
                  >Pause</button>
                {/if}
                {#if canResume}
                  <button
                    type="button"
                    class="quick-btn"
                    title="Resume build"
                    disabled={isBusy}
                    onclick={(e) => { e.preventDefault(); e.stopPropagation(); callAction(b.id, `/api/jkai/builds/${b.id}/resume`, 'Resumed', { refresh: true }); }}
                  >Resume</button>
                {/if}
                {#if canRestart}
                  <button
                    type="button"
                    class="quick-btn"
                    title="Restart from last good iteration"
                    disabled={isBusy}
                    onclick={(e) => { e.preventDefault(); e.stopPropagation(); callAction(b.id, `/api/jkai/builds/${b.id}/restart`, 'Restarted', { refresh: true }); }}
                  >Restart</button>
                {/if}
                <button
                  type="button"
                  class="quick-btn danger-btn"
                  title="Delete build"
                  disabled={isBusy}
                  onclick={(e) => { e.preventDefault(); e.stopPropagation(); deleteOne(b); }}
                  aria-label="Delete build"
                >✕</button>
              </div>

              <div class="kebab-wrap">
                <button
                  class="kebab"
                  type="button"
                  aria-label="More actions"
                  onclick={(e) => { e.preventDefault(); e.stopPropagation(); openMenuId = openMenuId === b.id ? null : b.id; }}
                >⋮</button>
                {#if openMenuId === b.id}
                  <div class="menu" role="menu">
                    <a class="mi" href={`/jkai/builds/${b.id}`} role="menuitem">Open detail</a>
                    {#if canStop}
                      <button class="mi" type="button" onclick={() => callAction(b.id, `/api/jkai/builds/${b.id}/stop`, 'Stopped', { refresh: true })}>Stop</button>
                    {/if}
                    {#if canCancelQueue}
                      <button class="mi" type="button" onclick={() => callAction(b.id, `/api/jkai/builds/${b.id}/cancel-queue`, 'Removed from queue', { refresh: true })}>Cancel queue</button>
                    {/if}
                    {#if isPublished}
                      <button class="mi" type="button" onclick={() => callAction(b.id, `/api/jkai/builds/${b.id}/unpublish`, 'Unpublished', { refresh: true })}>Unpublish</button>
                    {/if}
                  </div>
                {/if}
              </div>
            </div>

            <a class="card-link" href={`/jkai/builds/${b.id}`} aria-label="Open build">
              <div class="card-head">
                <div class="card-title-block">
                  <span class="card-title">{b.title ?? b.prompt.slice(0, 60)}</span>
                  <span class="card-prompt">{b.prompt.slice(0, 90)}{b.prompt.length > 90 ? '…' : ''}</span>
                </div>
                <span class="status-pill" data-status={buc}>
                  <span class="status-dot" data-status={buc} aria-hidden="true"></span>
                  {buc}
                </span>
              </div>

              <div class="card-stats">
                <div class="mini">
                  <span class="mini-val">{b.iterationsCompleted ?? 0}</span>
                  <span class="mini-lbl">iter</span>
                </div>
                <div class="mini">
                  <span class="mini-val">{(b.tokensUsed ?? 0).toLocaleString()}</span>
                  <span class="mini-lbl">tokens</span>
                </div>
                <div class="mini">
                  <span class="mini-val">
                    {#if isPublished}
                      <span class="mini-live">live</span>
                    {:else if b.serveConfig}
                      ready
                    {:else}
                      <span class="mini-muted">—</span>
                    {/if}
                  </span>
                  <span class="mini-lbl">publish</span>
                </div>
              </div>

              <div class="card-foot">
                <span>started {formatTime(b.createdAt)}</span>
                {#if summary(b.budgetConfig)}<span>{summary(b.budgetConfig)}</span>{/if}
                {#if isBusy}<span>…</span>{/if}
              </div>
            </a>
          </article>
        {/each}
      </div>
    {/if}
  </section>

  {#if toast}
    <div class="toast" data-kind={toast.kind}>{toast.text}</div>
  {/if}
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
    font-size: 11px;
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
    font-size: 10px;
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
    font-size: 0.85em;
    background: var(--code-bg);
    color: var(--code-text);
    padding: 0.08rem 0.38rem;
    border-radius: 2px;
  }
  .back-link {
    font-family: var(--font-mono);
    font-size: 11px;
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
    font-size: 10px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-muted);
  }
  .nm-sec-meta {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-ghost);
    margin-left: auto;
  }
  .header-cta {
    margin-left: 0;
  }

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
    .stats { grid-template-columns: repeat(2, 1fr); }
  }

  /* ——— Filter chips ——— */
  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-bottom: 0.9rem;
  }
  .chip {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    padding: 0.35rem 0.6rem;
    background: transparent;
    border: 1px solid var(--card-border);
    color: var(--text-muted);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    transition: all 80ms ease;
  }
  .chip:hover { color: var(--text-primary); border-color: var(--text-primary); }
  .chip.active {
    background: var(--text-primary);
    color: var(--bg);
    border-color: var(--text-primary);
  }
  .chip.active .chip-n { color: var(--bg); opacity: 0.85; }
  .chip-n {
    font-family: var(--font-mono);
    font-size: 9px;
    opacity: 0.7;
  }

  /* ——— Bulk bar ——— */
  .bulk-bar {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 0.75rem;
    margin-bottom: 0.75rem;
    background: var(--bg);
    border: 1px solid var(--card-border);
    visibility: hidden;
    opacity: 0;
    transition: opacity 100ms ease;
  }
  .bulk-bar.visible { visibility: visible; opacity: 1; }
  .bulk-bar .spacer { flex: 1; }
  .link {
    font-family: var(--font-mono);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    background: none;
    border: none;
    color: var(--text-primary);
    cursor: pointer;
    padding: 0.25rem 0.4rem;
  }
  .link:disabled { opacity: 0.5; cursor: not-allowed; }
  .link.danger { color: #b43232; }
  .link:hover { text-decoration: underline; }
  .dim {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }

  /* ——— Empty state ——— */
  .empty {
    padding: 1.5rem;
    text-align: center;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-ghost);
    font-style: italic;
    border: 1px dashed var(--card-border);
  }

  .row-link {
    font-family: var(--font-mono);
    font-size: 10px;
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

  /* ——— Build grid ——— */
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 0.6rem;
  }
  .build-card {
    position: relative;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    border: 1px solid var(--card-border);
    min-height: 140px;
    transition: border-color 80ms ease;
  }
  .build-card:hover { border-color: var(--text-primary); }
  .build-card.selected { border-color: var(--accent); }
  /* Hermes-origin builds get a distinctive left rail + accent border on top
     so users can tell at a glance which entries came in via the agent vs.
     were started manually from /jkai/builds/new. */
  .build-card.hermes {
    border-left: 3px solid var(--accent-ink);
    border-top: 2px solid var(--accent-ink);
  }

  /* Top-of-card toolbar: select checkbox · origin flag · visible quick
     actions · overflow kebab. Previously the kebab + status-pill collided
     in the top-right corner; now everything in this row owns its own space. */
  .card-toolbar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 4px 0;
    min-height: 28px;
    flex-wrap: nowrap;
  }

  .origin-flag {
    font-family: var(--font-mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    padding: 2px 6px;
    background: var(--accent-ink);
    color: white;
    border-radius: 2px;
    flex-shrink: 0;
  }

  .quick-actions {
    display: flex;
    gap: 3px;
    margin-left: auto;
    align-items: center;
    flex-wrap: nowrap;
    overflow: hidden;
  }
  .quick-btn {
    font-family: var(--font-mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 3px 7px;
    background: transparent;
    border: 1px solid var(--card-border);
    color: var(--text-muted);
    cursor: pointer;
    line-height: 1;
    transition: all 80ms ease;
  }
  .quick-btn:hover:not(:disabled) {
    border-color: var(--text-primary);
    color: var(--text-primary);
  }
  .quick-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .quick-btn.danger-btn {
    color: #b43232;
    border-color: rgba(180, 50, 50, 0.4);
    padding: 3px 6px;
    font-size: 11px;
  }
  .quick-btn.danger-btn:hover:not(:disabled) {
    background: #b43232;
    color: white;
    border-color: #b43232;
  }

  .check {
    width: 18px;
    height: 18px;
    border: 1px solid var(--card-border);
    background: var(--bg);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-family: var(--font-mono);
    color: var(--accent);
    transition: border-color 80ms ease;
    padding: 0;
    flex-shrink: 0;
  }
  .check:hover { border-color: var(--text-primary); }
  .build-card.selected .check { background: var(--accent); border-color: var(--accent); color: var(--bg); }

  .kebab-wrap {
    position: relative;
    flex-shrink: 0;
  }
  .kebab {
    width: 22px;
    height: 22px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 16px;
    line-height: 1;
    padding: 0;
    border-radius: 2px;
  }
  .kebab:hover { background: var(--bg-section); color: var(--text-primary); }

  .menu {
    position: absolute;
    top: 24px;
    right: 0;
    min-width: 160px;
    background: var(--bg);
    border: 1px solid var(--text-primary);
    display: flex;
    flex-direction: column;
    z-index: 10;
  }
  .mi {
    text-align: left;
    padding: 0.5rem 0.75rem;
    background: none;
    border: none;
    color: var(--text-primary);
    font-family: var(--font-body);
    font-size: 12px;
    cursor: pointer;
    text-decoration: none;
    display: block;
  }
  .mi:hover { background: var(--bg-section); }
  .mi.danger { color: #b43232; }
  .mi-sep {
    height: 1px;
    background: var(--card-border);
    margin: 0.25rem 0;
  }

  .card-link {
    flex: 1;
    padding: 0.5rem 1rem 0.75rem;
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
    font-size: 13px;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .card-prompt {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--text-ghost);
    line-height: 1.4;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .status-pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 18px;
    padding: 0 6px;
    font-family: var(--font-mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    background: rgba(26, 16, 8, 0.04);
    border: 1px solid var(--card-border);
    color: var(--text-muted);
    flex-shrink: 0;
  }
  .status-pill[data-status="running"] { border-color: var(--status-success, #2d7d46); color: var(--status-success, #2d7d46); }
  .status-pill[data-status="awaiting"] { border-color: var(--accent); color: var(--accent); }
  .status-pill[data-status="queued"] { border-color: #b48a32; color: #b48a32; }
  .status-pill[data-status="failed"] { border-color: #b43232; color: #b43232; }
  .status-pill[data-status="paused"] { border-color: var(--text-muted); color: var(--text-muted); }

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
    font-size: 12px;
    color: var(--text-primary);
    display: inline-flex;
    align-items: center;
    gap: 5px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .mini-muted { color: var(--text-ghost); }
  .mini-live { color: var(--status-success, #2d7d46); }
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
    padding-top: 0.35rem;
    border-top: 1px dashed var(--card-border);
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--text-ghost);
    display: inline-block;
    flex-shrink: 0;
  }
  .status-dot[data-status="running"] { background: var(--status-success, #2d7d46); animation: pulse 1.6s ease-in-out infinite; }
  .status-dot[data-status="queued"] { background: #b48a32; }
  .status-dot[data-status="paused"] { background: var(--text-muted); }
  .status-dot[data-status="awaiting"] { background: var(--accent); }
  .status-dot[data-status="completed"] { background: var(--text-muted); opacity: 0.5; }
  .status-dot[data-status="failed"] { background: #b43232; }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .nm-save-btn {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    padding: 6px 14px;
    background: var(--accent);
    color: var(--bg);
    border: 1px solid var(--accent);
    cursor: pointer;
    text-decoration: none;
    display: inline-block;
  }
  .nm-save-btn:hover {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
  }

  .toast {
    position: fixed;
    bottom: 1.5rem;
    left: 50%;
    transform: translateX(-50%);
    padding: 0.55rem 0.9rem;
    background: var(--text-primary);
    color: var(--bg);
    font-family: var(--font-mono);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    border: 1px solid var(--text-primary);
    z-index: 100;
  }
  .toast[data-kind="err"] { background: #b43232; border-color: #b43232; color: white; }
</style>
