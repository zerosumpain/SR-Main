<script lang="ts">
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';
  import { invalidateAll } from '$app/navigation';
  import { KIND_LABEL, type CommitFact, type FileFact, type ReleaseItemKind } from '$lib/releases/types';

  let { data } = $props();

  // Per-card UI state, keyed by release id. Reassigned wholesale (not mutated)
  // so the template's reads stay reactive.
  let expanded = $state<Record<number, boolean>>({});
  let evidenceOpen = $state<Record<number, boolean>>({});

  function toggle(id: number) {
    expanded = { ...expanded, [id]: !expanded[id] };
  }
  function toggleEvidence(id: number) {
    evidenceOpen = { ...evidenceOpen, [id]: !evidenceOpen[id] };
  }

  type RawView = { version: string; commits: CommitFact[]; files: FileFact[] };
  let raw = $state<RawView | null>(null);

  let busy = $state(false);
  let busyMsg = $state<string | null>(null);

  async function summarise(body: Record<string, unknown>, label: string) {
    busy = true;
    busyMsg = label;
    try {
      const res = await fetch('/api/releases/summarise', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result?.message || `HTTP ${res.status}`);
      busyMsg = result.remaining ? `${result.remaining} still pending` : 'done';
      await invalidateAll();
    } catch (err) {
      busyMsg = err instanceof Error ? err.message : 'failed';
    } finally {
      busy = false;
      setTimeout(() => (busyMsg = null), 4000);
    }
  }

  /** Portal to <body> so the overlay escapes the page's stacking context.
   *  Local, not $lib/canvas/portal — that one re-appends on destroy. */
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }

  const kindMax = $derived(Math.max(1, ...data.kindDist.map((k) => k.count)));
  const seriesMax = $derived(Math.max(1, ...data.releaseSeries.map((s) => s.count)));

  function fmtNum(n: number): string {
    return n.toLocaleString('en-GB');
  }
  function fmtDate(d: Date | string | null): string {
    if (!d) return '—';
    const date = typeof d === 'string' ? new Date(d) : d;
    return date.toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  function qs(patch: Record<string, string | number>): string {
    const p = new URLSearchParams();
    const merged = { ...data.filters, ...patch } as Record<string, string | number>;
    for (const [k, v] of Object.entries(merged)) {
      if (v === '' || v === 'all' || v === 0) continue;
      p.set(k, String(v));
    }
    const s = p.toString();
    return s ? `?${s}` : '';
  }
</script>

<svelte:head><title>Releases · admin</title></svelte:head>

<PageWrap width="wide">
  <PageHeader
    kicker="Ops"
    title="releases"
    sub="Every production deploy, and what each one put live. Generated from the deployed commit range — independent of how the work was built."
    crumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Ops', href: '/admin/ops/agent' }, { label: 'Releases' }]}
  >
    {#snippet actions()}
      <div class="hdr-actions">
        {#if busyMsg}<span class="busy-msg">{busyMsg}</span>{/if}
        {#if data.totals.pending > 0}
          <button class="go" disabled={busy} onclick={() => summarise({ limit: 25 }, 'summarising…')}>
            {busy ? 'working…' : `Summarise ${data.totals.pending} pending`}
          </button>
        {:else if data.totals.failed > 0}
          <button class="go ghost" disabled={busy} onclick={() => summarise({ limit: 25, retryFailed: true }, 'retrying…')}>
            Retry {data.totals.failed} failed
          </button>
        {/if}
      </div>
    {/snippet}
  </PageHeader>

  <!-- Filters -->
  <form class="filters" method="get">
    <label class="f">
      <span>Kind</span>
      <select name="kind" value={data.filters.kind}>
        <option value="all">All kinds</option>
        {#each Object.entries(KIND_LABEL) as [k, label] (k)}
          <option value={k}>{label}</option>
        {/each}
      </select>
    </label>
    <label class="f">
      <span>Impact</span>
      <select name="impact" value={data.filters.impact}>
        <option value="all">All</option>
        <option value="user-facing">User-facing</option>
        <option value="internal">Internal</option>
      </select>
    </label>
    <label class="f">
      <span>Source</span>
      <select name="via" value={data.filters.via}>
        <option value="all">All sources</option>
        {#each data.vias as v (v.via)}
          <option value={v.via}>{v.via} ({v.count})</option>
        {/each}
      </select>
    </label>
    <label class="f grow">
      <span>Search</span>
      <input type="search" name="q" value={data.filters.q} placeholder="version, sha, feature or summary text" />
    </label>
    <button class="go" type="submit">Apply</button>
  </form>

  <!-- Totals -->
  <div class="stat-grid">
    <div class="stat"><span class="stat-v">{fmtNum(data.totals.releases)}</span><span class="stat-l">Releases</span></div>
    <div class="stat"><span class="stat-v">{fmtNum(data.totals.commits)}</span><span class="stat-l">Commits shipped</span></div>
    <div class="stat"><span class="stat-v">{fmtNum(data.totals.files)}</span><span class="stat-l">File changes</span></div>
    <div class="stat">
      <span class="stat-v mono"><span class="ins">+{fmtNum(data.totals.insertions)}</span> <span class="del">−{fmtNum(data.totals.deletions)}</span></span>
      <span class="stat-l">Lines</span>
    </div>
    <div class="stat">
      <span class="stat-v mono">{data.totals.minDate ?? '—'} → {data.totals.maxDate ?? '—'}</span>
      <span class="stat-l">Range</span>
    </div>
    {#if data.totals.pending || data.totals.failed}
      <div class="stat">
        <span class="stat-v">{fmtNum(data.totals.pending)}{#if data.totals.failed}<span class="failed"> / {data.totals.failed}</span>{/if}</span>
        <span class="stat-l">Pending / failed</span>
      </div>
    {/if}
  </div>

  <!-- Distribution + cadence -->
  <div class="cat-grid">
    <section class="nm-sec">
      <div class="nm-sec-hd"><span class="sr-label-tight">What ships</span><span class="nm-sec-meta mono">releases containing each kind</span></div>
      {#if data.kindDist.length === 0}
        <p class="empty-note">Nothing summarised yet.</p>
      {:else}
        <div class="bars">
          {#each data.kindDist as k (k.kind)}
            <div class="bar-row">
              <span class="bar-lbl">{KIND_LABEL[k.kind as ReleaseItemKind] ?? k.kind}</span>
              <span class="bar-track"><span class="bar-fill" data-kind={k.kind} style="width:{(k.count / kindMax) * 100}%"></span></span>
              <span class="bar-val">{k.count}</span>
            </div>
          {/each}
        </div>
      {/if}
    </section>

    <section class="nm-sec">
      <div class="nm-sec-hd"><span class="sr-label-tight">Cadence</span><span class="nm-sec-meta mono">deploys per week</span></div>
      {#if data.releaseSeries.length === 0}
        <p class="empty-note">No releases recorded.</p>
      {:else}
        <div class="spark">
          {#each data.releaseSeries as s (s.week)}
            <div class="spark-col" title="{s.week}: {s.count} releases">
              <span class="spark-bar" style="height:{(s.count / seriesMax) * 100}%"></span>
            </div>
          {/each}
        </div>
        <div class="spark-cap mono">{data.releaseSeries[0]?.week} → {data.releaseSeries[data.releaseSeries.length - 1]?.week}</div>
      {/if}
    </section>
  </div>

  <!-- Releases -->
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Version log</span>
      <span class="nm-sec-meta mono">newest first · page {data.filters.page + 1}</span>
    </div>

    {#if data.items.length === 0}
      <p class="empty-note">
        No releases match. Run <code>node scripts/release-log/ingest.mjs --backfill</code> to reconstruct history from git.
      </p>
    {:else}
      <div class="releases">
        {#each data.items as r (r.id)}
          <article class="release" class:open={expanded[r.id]}>
            <button class="release-hd" onclick={() => toggle(r.id)} aria-expanded={expanded[r.id] ?? false}>
              <span class="ver mono">{r.version}</span>
              <span class="titles">
                <span class="r-title">{r.title ?? r.commits[0]?.subject ?? r.shortSha}</span>
                <span class="r-meta">
                  <span class="date">{fmtDate(r.deployedAt)}</span>
                  {#if r.via !== 'github-actions'}<span class="via-chip" data-via={r.via}>{r.via}</span>{/if}
                  {#each r.kinds as k (k)}<span class="kind-chip" data-kind={k}>{KIND_LABEL[k] ?? k}</span>{/each}
                  {#if r.summaryStatus === 'pending'}<span class="state-chip pending">awaiting summary</span>{/if}
                  {#if r.summaryStatus === 'failed'}<span class="state-chip failed">summary failed</span>{/if}
                </span>
              </span>
              <span class="churn mono">
                <span class="ins">+{fmtNum(r.stats.insertions ?? 0)}</span>
                <span class="del">−{fmtNum(r.stats.deletions ?? 0)}</span>
              </span>
              <span class="counts mono">{r.stats.commits ?? 0}c · {r.stats.files ?? 0}f</span>
              <span class="chev">{expanded[r.id] ? '▾' : '▸'}</span>
            </button>

            {#if expanded[r.id]}
              <div class="release-body">
                {#if r.summary}<p class="r-summary">{r.summary}</p>{/if}

                <div class="prov mono">
                  <span title="deployed commit">{r.shortSha}</span>
                  <span class="prov-sep">←</span>
                  <span title="commit it replaced">{r.prevSha ? r.prevSha.slice(0, 8) : 'root'}</span>
                  {#if r.via === 'backfill'}
                    <span class="prov-note">reconstructed from git history — boundary and time approximate</span>
                  {/if}
                </div>

                {#if r.items.length === 0}
                  <p class="empty-note small">
                    {r.summaryStatus === 'pending' ? 'Not summarised yet.' : 'No entries — this deploy shipped no code changes.'}
                  </p>
                {:else}
                  <div class="items">
                    {#each r.items as it (it.id)}
                      <div class="item" data-kind={it.kind}>
                        <div class="item-top">
                          <span class="kind-badge" data-kind={it.kind}>{KIND_LABEL[it.kind] ?? it.kind}</span>
                          {#if it.impact === 'user-facing'}<span class="impact-chip">user-facing</span>{/if}
                          <span class="item-title">{it.title}</span>
                          {#if it.confidence === 'low'}<span class="conf-chip" title="Thin evidence — read the commits below">low confidence</span>{/if}
                        </div>
                        {#if it.summary}<p class="item-sum">{it.summary}</p>{/if}

                        {#if it.includes.length || it.excludes.length}
                          <div class="scope">
                            {#if it.includes.length}
                              <div class="scope-col">
                                <span class="scope-hd">Includes</span>
                                <ul class="scope-list yes">
                                  {#each it.includes as line, i (i)}<li>{line}</li>{/each}
                                </ul>
                              </div>
                            {/if}
                            {#if it.excludes.length}
                              <div class="scope-col">
                                <span class="scope-hd">Not included</span>
                                <ul class="scope-list no">
                                  {#each it.excludes as line, i (i)}<li>{line}</li>{/each}
                                </ul>
                              </div>
                            {/if}
                          </div>
                        {/if}

                        {#if it.surfaces.length}
                          <div class="surfaces">
                            {#each it.surfaces as s, i (i)}<span class="surface-chip mono">{s}</span>{/each}
                          </div>
                        {/if}

                        {#if it.files.length || it.commits.length}
                          <details class="evidence">
                            <summary>Evidence · {it.files.length} files · {it.commits.length} commits</summary>
                            <div class="evidence-body mono">
                              {#each it.commits as c, i (i)}<span class="ev-commit">{c}</span>{/each}
                              <ul class="ev-files">
                                {#each it.files as f, i (i)}<li>{f}</li>{/each}
                              </ul>
                            </div>
                          </details>
                        {/if}
                      </div>
                    {/each}
                  </div>
                {/if}

                <div class="release-actions">
                  <button class="raw-btn" onclick={() => (raw = { version: r.version, commits: r.commits, files: r.files })}>
                    Full diff detail
                  </button>
                  <button class="raw-btn" onclick={() => toggleEvidence(r.id)}>
                    {evidenceOpen[r.id] ? 'Hide' : 'Show'} commit list
                  </button>
                  <button class="raw-btn" disabled={busy} onclick={() => summarise({ id: r.id, force: true }, `re-summarising ${r.version}…`)}>
                    Regenerate summary
                  </button>
                  {#if r.summaryModel}<span class="model-note mono">{r.summaryModel}</span>{/if}
                </div>

                {#if evidenceOpen[r.id]}
                  <ul class="commit-list">
                    {#each r.commits as c (c.sha)}
                      <li>
                        <span class="mono sha">{c.short}</span>
                        <span class="c-subject">{c.subject}</span>
                        {#if c.pr}<span class="pr-chip mono">#{c.pr}</span>{/if}
                      </li>
                    {/each}
                  </ul>
                {/if}

                {#if r.summaryError}
                  <p class="err-note mono">{r.summaryError}</p>
                {/if}
              </div>
            {/if}
          </article>
        {/each}
      </div>

      <div class="pager">
        {#if data.filters.page > 0}
          <a class="page-btn" href={qs({ page: data.filters.page - 1 })}>← Newer</a>
        {:else}<span></span>{/if}
        {#if data.hasMore}
          <a class="page-btn" href={qs({ page: data.filters.page + 1 })}>Older →</a>
        {/if}
      </div>
    {/if}
  </section>
</PageWrap>

{#if raw}
  <div class="raw-overlay" use:portal role="presentation" onclick={() => (raw = null)}>
    <div class="raw-modal" role="dialog" aria-modal="true" aria-label="Release detail" onclick={(e) => e.stopPropagation()}>
      <div class="raw-hd">
        <span class="raw-stage">{raw.version}</span>
        <span class="raw-title">{raw.commits.length} commits · {raw.files.length} files</span>
        <button class="raw-close" onclick={() => (raw = null)} aria-label="Close">✕</button>
      </div>
      <div class="raw-body">
        <div class="raw-sec sr-label-tight">Commits</div>
        <ul class="commit-list detail">
          {#each raw.commits as c (c.sha)}
            <li>
              <span class="mono sha">{c.short}</span>
              <span class="c-subject">{c.subject}</span>
              {#if c.pr}<span class="pr-chip mono">#{c.pr}</span>{/if}
              {#if c.body}<pre class="c-body">{c.body}</pre>{/if}
            </li>
          {/each}
        </ul>
        <div class="raw-sec sr-label-tight">Files</div>
        <table class="file-table">
          <colgroup><col style="width:auto" /><col style="width:64px" /><col style="width:64px" /><col style="width:32px" /></colgroup>
          <tbody>
            {#each raw.files as f (f.path)}
              <tr>
                <td class="mono f-path">{f.path}</td>
                <td class="mono ins">+{f.insertions}</td>
                <td class="mono del">−{f.deletions}</td>
                <td class="mono f-status">{f.status}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  </div>
{/if}

<style>
  /* Filters */
  .filters { display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: flex-end; margin-bottom: 1.5rem; }
  .f { display: flex; flex-direction: column; gap: 0.3rem; }
  .f.grow { flex: 1; min-width: 200px; }
  .f span {
    font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase;
    letter-spacing: 0.16em; color: var(--text-ghost);
  }
  .f select, .f input {
    background: var(--surface-elevated, var(--bg)); color: var(--text-primary);
    border: 1px solid var(--border, rgba(120, 110, 100, 0.3)); border-radius: 4px;
    padding: 0.45rem 0.6rem; font-size: 0.9rem; font-family: var(--font-body);
  }
  .go {
    background: var(--accent); color: var(--bg); border: none; border-radius: 4px;
    padding: 0.5rem 0.9rem; font-size: 0.85rem; font-weight: 600; cursor: pointer;
    font-family: var(--font-mono); text-transform: uppercase; letter-spacing: 0.08em;
  }
  .go:disabled { opacity: 0.55; cursor: default; }
  .go.ghost { background: transparent; color: var(--accent); border: 1px solid var(--accent); }
  .hdr-actions { display: flex; align-items: center; gap: 0.6rem; }
  .busy-msg { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); }

  /* Stat tiles */
  .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 0.75rem; margin-bottom: 1.75rem; }
  .stat {
    display: flex; flex-direction: column; gap: 0.25rem; padding: 0.9rem 1rem;
    border: 1px solid var(--border, rgba(120, 110, 100, 0.25)); border-radius: 6px;
    background: var(--surface-elevated, transparent);
  }
  .stat-v { font-family: var(--font-brand); font-size: 1.5rem; line-height: 1; color: var(--text-primary); }
  .stat-v.mono, .mono { font-family: var(--font-mono); }
  .stat-v.mono { font-size: 0.95rem; }
  .stat-l { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-ghost); }
  .ins { color: var(--success, #2d7a3a); }
  .del { color: var(--error, #c44); }
  .failed { color: var(--error, #c44); }

  /* Sections */
  .nm-sec {
    border: 1px solid var(--border, rgba(120, 110, 100, 0.25)); border-radius: 8px;
    padding: 1.1rem 1.2rem; margin-bottom: 1.25rem; background: var(--surface-elevated, transparent);
  }
  .nm-sec-hd { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; margin-bottom: 0.9rem; }
  .sr-label-tight { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.14em; color: var(--text-primary); }
  .nm-sec-meta { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-ghost); }
  .empty-note { color: var(--text-muted); font-size: 0.9rem; }
  .empty-note.small { font-size: 0.82rem; }
  .empty-note code { font-family: var(--font-mono); font-size: 0.82rem; color: var(--text-secondary); }

  .cat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem; }
  @media (max-width: 720px) { .cat-grid { grid-template-columns: 1fr; } }

  /* Bars */
  .bars { display: flex; flex-direction: column; gap: 0.35rem; }
  .bar-row { display: grid; grid-template-columns: 110px 1fr 34px; align-items: center; gap: 0.6rem; font-size: 0.85rem; }
  .bar-lbl { color: var(--text-secondary); font-family: var(--font-mono); font-size: 0.78rem; }
  .bar-track { height: 10px; background: var(--border, rgba(120, 110, 100, 0.18)); border-radius: 3px; overflow: hidden; }
  .bar-fill { display: block; height: 100%; background: var(--accent); border-radius: 3px; }
  .bar-val { text-align: right; font-family: var(--font-mono); font-size: 0.78rem; color: var(--text-ghost); }

  /* Cadence spark */
  .spark { display: flex; align-items: flex-end; gap: 2px; height: 90px; }
  .spark-col { flex: 1; height: 100%; display: flex; align-items: flex-end; min-width: 3px; }
  .spark-bar { width: 100%; background: var(--accent); border-radius: 2px 2px 0 0; opacity: 0.85; }
  .spark-cap { margin-top: 0.4rem; font-size: var(--fs-label-xs); color: var(--text-ghost); }

  /* Kind colours — one system, reused by chip / badge / bar */
  .bar-fill[data-kind='feature'], .kind-chip[data-kind='feature'], .kind-badge[data-kind='feature'] { background: #4f9e6a; }
  .bar-fill[data-kind='fix'], .kind-chip[data-kind='fix'], .kind-badge[data-kind='fix'] { background: #c56b6b; }
  .bar-fill[data-kind='improvement'], .kind-chip[data-kind='improvement'], .kind-badge[data-kind='improvement'] { background: #c99a4b; }
  .bar-fill[data-kind='infra'], .kind-chip[data-kind='infra'], .kind-badge[data-kind='infra'] { background: #6b7f99; }
  .bar-fill[data-kind='content'], .kind-chip[data-kind='content'], .kind-badge[data-kind='content'] { background: #9b7fb8; }
  .bar-fill[data-kind='chore'], .kind-chip[data-kind='chore'], .kind-badge[data-kind='chore'] { background: #8d8478; }

  /* Release rows */
  .releases { display: flex; flex-direction: column; gap: 0.55rem; }
  .release { border: 1px solid var(--border, rgba(120, 110, 100, 0.22)); border-radius: 6px; overflow: hidden; }
  .release.open { border-color: var(--accent); }
  .release-hd {
    display: grid; grid-template-columns: 92px 1fr auto auto 18px; align-items: center; gap: 0.9rem;
    width: 100%; padding: 0.7rem 0.9rem; background: transparent; border: none; cursor: pointer;
    text-align: left; color: var(--text-primary); font-family: var(--font-body);
  }
  .release-hd:hover { background: var(--surface-elevated, rgba(120, 110, 100, 0.05)); }
  .ver { font-size: 0.78rem; color: var(--accent); letter-spacing: -0.02em; }
  .titles { min-width: 0; display: flex; flex-direction: column; gap: 0.28rem; }
  .r-title { font-size: 0.95rem; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .r-meta { display: flex; flex-wrap: wrap; gap: 0.3rem; align-items: center; }
  .date { font-size: var(--fs-label-xs); color: var(--text-ghost); }
  .kind-chip, .via-chip, .state-chip, .impact-chip, .conf-chip, .pr-chip, .surface-chip {
    font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.08em;
    padding: 0.1rem 0.35rem; border-radius: 3px;
  }
  .kind-chip { color: #fff; }
  .via-chip { background: var(--border, rgba(120, 110, 100, 0.2)); color: var(--text-muted); }
  .via-chip[data-via='backfill'] { background: transparent; border: 1px dashed var(--border, rgba(120, 110, 100, 0.5)); color: var(--text-ghost); }
  .state-chip.pending { background: transparent; border: 1px solid var(--warn, #b0892a); color: var(--warn, #b0892a); }
  .state-chip.failed { background: var(--error, #c44); color: #fff; }
  .churn { font-size: var(--fs-label-xs); display: flex; gap: 0.4rem; }
  .counts { font-size: var(--fs-label-xs); color: var(--text-ghost); }
  .chev { color: var(--text-ghost); font-size: 0.8rem; }

  .release-body { padding: 0.2rem 0.9rem 0.9rem; border-top: 1px dashed var(--border, rgba(120, 110, 100, 0.2)); }
  .r-summary { margin: 0.7rem 0 0.6rem; font-size: 0.9rem; line-height: 1.5; color: var(--text-secondary); max-width: 82ch; }
  .prov { font-size: var(--fs-label-xs); color: var(--text-ghost); display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem; margin-bottom: 0.75rem; }
  .prov-sep { color: var(--accent); }
  .prov-note { font-family: var(--font-body); font-style: italic; }

  /* Feature entries */
  .items { display: flex; flex-direction: column; gap: 0.55rem; }
  .item {
    border-left: 3px solid var(--border); padding: 0.6rem 0.8rem; border-radius: 0 4px 4px 0;
    background: var(--surface-elevated, rgba(120, 110, 100, 0.04));
  }
  .item[data-kind='feature'] { border-left-color: #4f9e6a; }
  .item[data-kind='fix'] { border-left-color: #c56b6b; }
  .item[data-kind='improvement'] { border-left-color: #c99a4b; }
  .item[data-kind='infra'] { border-left-color: #6b7f99; }
  .item[data-kind='content'] { border-left-color: #9b7fb8; }
  .item[data-kind='chore'] { border-left-color: #8d8478; }
  .item-top { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
  .kind-badge { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; padding: 0.12rem 0.4rem; border-radius: 3px; color: #fff; }
  .impact-chip { background: var(--accent-ink, #0e5b66); color: var(--bg); }
  .conf-chip { background: transparent; border: 1px solid var(--warn, #b0892a); color: var(--warn, #b0892a); }
  .item-title { font-size: 0.92rem; font-weight: 500; min-width: 0; }
  .item-sum { margin: 0.45rem 0 0; font-size: 0.85rem; line-height: 1.5; color: var(--text-secondary); max-width: 82ch; }

  .scope { display: grid; grid-template-columns: 1fr 1fr; gap: 0.9rem; margin-top: 0.7rem; }
  @media (max-width: 720px) { .scope { grid-template-columns: 1fr; } }
  .scope-col { min-width: 0; }
  .scope-hd { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 700; text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-ghost); }
  .scope-list { margin: 0.3rem 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 0.22rem; }
  .scope-list li { position: relative; padding-left: 1.1rem; font-size: 0.83rem; line-height: 1.45; color: var(--text-secondary); }
  .scope-list li::before { position: absolute; left: 0; top: 0; font-family: var(--font-mono); font-size: 0.8rem; }
  .scope-list.yes li::before { content: '+'; color: var(--success, #2d7a3a); }
  .scope-list.no li::before { content: '−'; color: var(--error, #c44); }

  .surfaces { display: flex; flex-wrap: wrap; gap: 0.3rem; margin-top: 0.6rem; }
  .surface-chip { background: var(--border, rgba(120, 110, 100, 0.18)); color: var(--text-muted); text-transform: none; letter-spacing: 0; }

  .evidence { margin-top: 0.6rem; }
  .evidence summary { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); cursor: pointer; }
  .evidence summary:hover { color: var(--accent); }
  .evidence-body { margin-top: 0.4rem; font-size: var(--fs-label-xs); color: var(--text-muted); }
  .ev-commit { display: inline-block; margin: 0 0.3rem 0.25rem 0; padding: 0.05rem 0.3rem; border: 1px solid var(--border, rgba(120, 110, 100, 0.3)); border-radius: 3px; }
  .ev-files { margin: 0.3rem 0 0; padding-left: 1rem; display: flex; flex-direction: column; gap: 0.1rem; }

  .release-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.45rem; margin-top: 0.8rem; }
  .raw-btn {
    background: transparent; border: 1px solid var(--border, rgba(120, 110, 100, 0.35));
    color: var(--text-secondary); border-radius: 4px; padding: 0.25rem 0.6rem; font-size: 0.75rem;
    font-family: var(--font-mono); cursor: pointer;
  }
  .raw-btn:hover { border-color: var(--accent); color: var(--accent); }
  .raw-btn:disabled { opacity: 0.5; cursor: default; }
  .model-note { font-size: var(--fs-label-xs); color: var(--text-ghost); }
  .err-note { margin: 0.6rem 0 0; font-size: var(--fs-label-xs); color: var(--error, #c44); }

  .commit-list { margin: 0.7rem 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 0.25rem; }
  .commit-list li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.5rem; font-size: 0.82rem; color: var(--text-secondary); }
  .sha { font-size: var(--fs-label-xs); color: var(--text-ghost); }
  .c-subject { min-width: 0; }
  .pr-chip { background: var(--border, rgba(120, 110, 100, 0.2)); color: var(--text-muted); }

  .pager { display: flex; justify-content: space-between; margin-top: 1rem; }
  .page-btn { font-family: var(--font-mono); font-size: 0.8rem; color: var(--text-secondary); text-decoration: none; padding: 0.4rem 0.7rem; border: 1px solid var(--border); border-radius: 4px; }
  .page-btn:hover { border-color: var(--accent); color: var(--accent); }

  /* Detail modal — opaque panel per the design system */
  .raw-overlay {
    position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center;
    background: rgba(20, 16, 12, 0.72); padding: 2rem 1rem;
  }
  .raw-modal {
    background: var(--surface-elevated, var(--bg)); color: var(--text-primary);
    border: 1px solid var(--border, rgba(120, 110, 100, 0.4)); border-radius: 8px;
    width: min(980px, 100%); max-height: 85vh; display: flex; flex-direction: column; overflow: hidden;
  }
  .raw-hd { display: flex; align-items: center; gap: 0.7rem; padding: 0.8rem 1rem; border-bottom: 1px solid var(--border, rgba(120, 110, 100, 0.25)); }
  .raw-stage { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: var(--accent); }
  .raw-title { font-size: 0.9rem; color: var(--text-secondary); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .raw-close { margin-left: auto; background: transparent; border: none; color: var(--text-muted); font-size: 1rem; cursor: pointer; }
  .raw-close:hover { color: var(--text-primary); }
  .raw-body { padding: 0.9rem 1.1rem 1.2rem; overflow: auto; }
  .raw-sec { display: block; margin: 1rem 0 0.5rem; }
  .raw-sec:first-child { margin-top: 0; }
  .commit-list.detail li { display: block; padding-bottom: 0.4rem; }
  .c-body { margin: 0.3rem 0 0; padding: 0.4rem 0.6rem; white-space: pre-wrap; word-break: break-word; font-family: var(--font-mono); font-size: var(--fs-label-xs); line-height: 1.45; color: var(--text-muted); border-left: 2px solid var(--border, rgba(120, 110, 100, 0.3)); }
  .file-table { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 0.76rem; }
  .file-table td { padding: 0.18rem 0.4rem; color: var(--text-secondary); }
  .file-table td.ins, .file-table td.del, .file-table td.f-status { text-align: right; }
  .f-path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .f-status { color: var(--text-ghost); }
</style>
