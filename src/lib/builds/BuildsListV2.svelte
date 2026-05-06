<script lang="ts">
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
    createdAt: string | Date;
  };

  let { builds: initialBuilds }: { builds: Build[] } = $props();
  let builds = $state<Build[]>(initialBuilds);
  let busyId = $state<string | null>(null);
  let selected = $state<Set<string>>(new Set());
  let bulkBusy = $state(false);
  let openMenuId = $state<string | null>(null);
  let filter = $state<'all' | 'running' | 'queued' | 'paused' | 'awaiting' | 'completed' | 'failed' | 'published'>('all');
  let toast = $state<{ kind: 'ok' | 'err'; text: string } | null>(null);

  function showToast(kind: 'ok' | 'err', text: string) {
    toast = { kind, text };
    setTimeout(() => { toast = null; }, 2200);
  }

  // Derived bucket — the chip a build falls into. "awaiting" covers both
  // plan-approval and iter-approval to keep the chip count short.
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
        : builds.filter((b) => bucket(b) === filter),
  );

  function counts() {
    const c: Record<string, number> = {
      all: builds.length,
      running: 0, queued: 0, paused: 0, awaiting: 0, completed: 0, failed: 0,
      published: builds.filter((b) => b.publishedSlug).length,
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

  function statusLabel(b: Build): string {
    if (b.status === 'awaiting_plan_approval') return 'plan';
    if (b.status === 'awaiting_iter_approval') return 'iter approval';
    return b.status;
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

  // --- Per-card actions ---

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
        // Re-pull this build's row from the list endpoint so its status flips
        // visibly without a full page reload.
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

<div class="wrap">
  <header class="page-hdr">
    <div>
      <div class="kicker">JKAI</div>
      <h1>Builds</h1>
      <p class="sub">Autonomous AI development. Plan-first, design-system-locked, fully observable.</p>
    </div>
    <a class="nm-save-btn" href="/jkai/builds/new">+ New build</a>
  </header>

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
    <section class="nm-sec">
      {#if builds.length === 0}
        <p class="dim">No builds yet — <a class="row-link" href="/jkai/builds/new">+ start one</a>.</p>
      {:else}
        <p class="dim">No builds match this filter.</p>
      {/if}
    </section>
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
        <article class="card" class:selected={isSelected} data-status={bucket(b)}>
          <button
            class="check"
            type="button"
            aria-label={isSelected ? 'Deselect' : 'Select'}
            aria-pressed={isSelected}
            onclick={(e) => toggleSelected(b.id, e)}
          >
            {#if isSelected}✓{:else}&nbsp;{/if}
          </button>

          <div class="kebab-wrap">
            <button
              class="kebab"
              type="button"
              aria-label="Actions"
              onclick={(e) => { e.preventDefault(); e.stopPropagation(); openMenuId = openMenuId === b.id ? null : b.id; }}
            >⋮</button>
            {#if openMenuId === b.id}
              <div class="menu" role="menu">
                <a class="mi" href={`/jkai/builds/${b.id}`} role="menuitem">Open</a>
                {#if canPause}
                  <button class="mi" type="button" onclick={() => callAction(b.id, `/api/jkai/builds/${b.id}/pause`, 'Paused', { refresh: true })}>Pause</button>
                {/if}
                {#if canResume}
                  <button class="mi" type="button" onclick={() => callAction(b.id, `/api/jkai/builds/${b.id}/resume`, 'Resumed', { refresh: true })}>Resume</button>
                {/if}
                {#if canRestart}
                  <button class="mi" type="button" onclick={() => callAction(b.id, `/api/jkai/builds/${b.id}/restart`, 'Restarted', { refresh: true })}>Restart</button>
                {/if}
                {#if canStop}
                  <button class="mi" type="button" onclick={() => callAction(b.id, `/api/jkai/builds/${b.id}/stop`, 'Stopped', { refresh: true })}>Stop</button>
                {/if}
                {#if canCancelQueue}
                  <button class="mi" type="button" onclick={() => callAction(b.id, `/api/jkai/builds/${b.id}/cancel-queue`, 'Removed from queue', { refresh: true })}>Cancel queue</button>
                {/if}
                {#if canPublish}
                  <button class="mi" type="button" onclick={() => publishOne(b)}>Publish</button>
                {/if}
                {#if isPublished}
                  <button class="mi" type="button" onclick={() => copyPreviewLink(b)}>Copy preview link</button>
                  <button class="mi" type="button" onclick={() => callAction(b.id, `/api/jkai/builds/${b.id}/unpublish`, 'Unpublished', { refresh: true })}>Unpublish</button>
                {/if}
                <div class="mi-sep"></div>
                <button class="mi danger" type="button" onclick={() => deleteOne(b)}>Delete</button>
              </div>
            {/if}
          </div>

          <a class="card-link" href={`/jkai/builds/${b.id}`} aria-label="Open build">
            <header>
              <span class="status-dot" data-status={bucket(b)} aria-hidden="true"></span>
              <span class="title">{b.title ?? b.prompt.slice(0, 60)}</span>
            </header>
            <p class="prompt">{b.prompt.slice(0, 180)}{b.prompt.length > 180 ? '…' : ''}</p>
            <footer>
              <span class="dim">iter {b.iterationsCompleted ?? 0}</span>
              <span class="dim">tok {(b.tokensUsed ?? 0).toLocaleString()}</span>
              {#if summary(b.budgetConfig)}<span class="dim">{summary(b.budgetConfig)}</span>{/if}
              {#if b.status === 'queued'}<span class="dim badge queued">queued</span>
              {:else if b.status === 'paused'}<span class="dim badge paused">paused</span>
              {:else if b.status === 'awaiting_plan_approval'}<span class="dim badge plan">awaiting plan</span>
              {:else if b.status === 'awaiting_iter_approval'}<span class="dim badge plan">awaiting iter</span>
              {:else if b.status === 'failed'}<span class="dim badge failed">failed</span>{/if}
              {#if isPublished}<span class="dim badge live">live</span>{/if}
              {#if isBusy}<span class="dim">…</span>{/if}
            </footer>
          </a>
        </article>
      {/each}
    </div>
  {/if}

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
  .page-hdr {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    gap: 1.5rem;
    margin-bottom: 1.25rem;
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
  h1 {
    font-family: var(--font-display);
    font-size: 2rem;
    font-weight: 900;
    line-height: 1.05;
    margin: 0;
    color: var(--text-primary);
  }
  .sub {
    margin: 0.4rem 0 0;
    font-size: 12px;
    color: var(--text-muted);
    font-family: var(--font-body);
  }

  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-bottom: 1rem;
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

  .bulk-bar {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 0.75rem;
    margin-bottom: 0.75rem;
    background: var(--bg-section, var(--card-bg));
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

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 0.6rem;
  }
  .card {
    position: relative;
    background: var(--bg);
    border: 1px solid var(--card-border);
    transition: border-color 80ms ease;
  }
  .card:hover { border-color: var(--text-primary); }
  .card.selected { border-color: var(--accent); }
  .card[data-status="queued"] { border-left: 3px solid #b48a32; }
  .card[data-status="running"] { border-left: 3px solid var(--status-success, #2d7d46); }
  .card[data-status="failed"] { border-left: 3px solid #b43232; }
  .card[data-status="paused"] { border-left: 3px solid var(--text-muted); }
  .card[data-status="awaiting"] { border-left: 3px solid var(--accent); }

  .check {
    position: absolute;
    top: 6px;
    left: 6px;
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
    z-index: 2;
    transition: border-color 80ms ease;
    padding: 0;
  }
  .check:hover { border-color: var(--text-primary); }
  .card.selected .check { background: var(--accent); border-color: var(--accent); color: var(--bg); }

  .kebab-wrap {
    position: absolute;
    top: 4px;
    right: 4px;
    z-index: 3;
  }
  .kebab {
    width: 24px;
    height: 24px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 18px;
    line-height: 1;
    padding: 0;
    border-radius: 2px;
  }
  .kebab:hover { background: var(--bg-section, var(--card-bg)); color: var(--text-primary); }

  .menu {
    position: absolute;
    top: 26px;
    right: 0;
    min-width: 180px;
    background: var(--bg);
    border: 1px solid var(--text-primary);
    box-shadow: 4px 4px 0 var(--card-border);
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
  .mi:hover { background: var(--bg-section, var(--card-bg)); }
  .mi.danger { color: #b43232; }
  .mi-sep {
    height: 1px;
    background: var(--card-border);
    margin: 0.25rem 0;
  }

  .card-link {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 0.9rem 2rem 0.7rem 2rem;
    text-decoration: none;
    color: inherit;
    min-height: 140px;
  }
  .card header {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .title {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 0.95rem;
    line-height: 1.2;
    color: var(--text-primary);
  }
  .prompt {
    margin: 0;
    color: var(--text-secondary);
    font-size: 12px;
    line-height: 1.4;
  }
  footer {
    margin-top: auto;
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    padding-top: 8px;
  }
  .dim {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  .badge { padding: 0 0.35rem; border: 1px solid currentColor; }
  .badge.queued { color: #b48a32; }
  .badge.paused { color: var(--text-muted); }
  .badge.plan { color: var(--accent); }
  .badge.failed { color: #b43232; }
  .badge.live { color: var(--status-success, #2d7d46); }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
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
