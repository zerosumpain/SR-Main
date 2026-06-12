<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import type { PageData } from './$types';
  const base = '/projects/data-standard-designer';
  let { data }: { data: PageData } = $props();

  type Entry = PageData['snapshot']['entries'][number];
  const entries = $derived((data.snapshot?.entries ?? []) as Entry[]);
  const health = $derived(data.snapshot?.sourceHealth ?? []);
  const watches = $derived(data.snapshot?.watches ?? []);

  let q = $state('');
  let domain = $state('all');
  let kind = $state('all');
  let source = $state('all');
  let watchFilter = $state('all');
  let showReview = $state(true);

  let refreshing = $state(false);
  let refreshMsg = $state('');

  const SOURCE_LABEL: Record<string, string> = { 'govuk-search': 'GOV.UK Search API', github: 'GitHub (gov orgs)', 'data-gov-uk': 'data.gov.uk' };
  const domains = $derived(['all', ...Array.from(new Set(entries.map((e) => e.domain).filter(Boolean)))] as string[]);
  const kinds = $derived(['all', ...Array.from(new Set(entries.map((e) => e.kind).filter(Boolean)))] as string[]);
  const sources = $derived(['all', ...Array.from(new Set(entries.map((e) => e.sourceKey)))] as string[]);

  const filtered = $derived(
    entries.filter((e) => {
      if (!showReview && e.status === 'review') return false;
      if (watchFilter !== 'all' && e.watch !== watchFilter) return false;
      if (domain !== 'all' && e.domain !== domain) return false;
      if (kind !== 'all' && e.kind !== kind) return false;
      if (source !== 'all' && e.sourceKey !== source) return false;
      if (q) {
        const hay = `${e.title} ${e.publisher ?? ''} ${e.summary ?? ''}`.toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      return true;
    }),
  );

  function fmtDate(d: string | Date | null) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function ago(d: string) {
    const ms = Date.now() - new Date(d).getTime();
    const h = Math.round(ms / 3600000);
    if (h < 1) return 'just now';
    if (h < 24) return `${h}h ago`;
    return `${Math.round(h / 24)}d ago`;
  }

  async function refresh() {
    refreshing = true;
    refreshMsg = '';
    // Cap the wait — the server keeps running even if we stop waiting, and the
    // discovery upserts candidates before classifying, so entries appear either way.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30_000);
    try {
      const res = await fetch('/api/data-standard-designer/ingest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: ctrl.signal });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.message || `Failed (${res.status})`);
      refreshMsg = j?.throttled
        ? 'Recently swept — showing the latest results (throttled to protect the sources).'
        : `Swept ${j?.totalCandidates ?? 0} candidates across ${j?.sources?.length ?? 0} sources; ${j?.classified ?? 0} newly classified.`;
    } catch {
      refreshMsg = 'Sweep running in the background — new entries will appear as they are classified. Reloading…';
    } finally {
      clearTimeout(timer);
      await invalidateAll(); // refresh the list regardless — Phase-1 upserts land fast
      refreshing = false;
    }
  }
</script>

<div class="dsd-route wide">
  <span class="dsd-eyebrow">Standards portal · auto-discovered</span>
  <h1 class="dsd-h1" style="font-size:clamp(26px,4vw,40px)">What's emerging across government.</h1>
  <p class="dsd-prose">A continuously-refreshed registry of newly published and updated data standards across government. Discovery is <b>index-driven</b> — it reads official, timestamped indexes (the GOV.UK Search API, gov GitHub orgs) that report a total count — so coverage is exhaustive and a broken feed is visible, not silent. AI only classifies and summarises what's found; it never decides what exists.</p>

  <!-- Source health: the robustness made visible -->
  <div class="health">
    <div class="health-head">
      <span class="dsd-label" style="margin:0">Source coverage &amp; health</span>
      <button class="dsd-btn sm" disabled={refreshing} onclick={refresh}>{refreshing ? 'Sweeping…' : '↻ Refresh now'}</button>
    </div>
    {#if refreshMsg}<p class="refresh-msg">{refreshMsg}</p>{/if}
    {#if health.length}
      <div class="health-grid">
        {#each health as h}
          <div class="hcard" class:bad={!h.ok}>
            <div class="hc-top"><b>{SOURCE_LABEL[h.sourceKey] ?? h.sourceKey}</b><span class="dot" class:ok={h.ok} class:bad={!h.ok}></span></div>
            <div class="hc-stats">
              <span><b>{h.itemsFound}</b> found</span>
              <span><b>{h.itemsNew}</b> new</span>
              {#if h.totalAvailable != null}<span><b>{h.totalAvailable.toLocaleString()}</b> indexed</span>{/if}
            </div>
            <span class="hc-when">{h.ok ? `swept ${ago(h.runAt)}` : `failed ${ago(h.runAt)}`}</span>
            {#if h.error}<span class="hc-err">{h.error}</span>{/if}
          </div>
        {/each}
      </div>
    {:else}
      <p class="empty">No discovery sweep has run yet. Hit <b>Refresh now</b> to populate the registry, or the daily cron will fill it.</p>
    {/if}
    {#if data.error}<p class="hc-err" style="margin-top:8px">Registry storage not ready: {data.error}</p>{/if}
  </div>

  <!-- Watches: focused topics the sweep tracks -->
  {#if watches.length}
    <div class="watches">
      <span class="dsd-label" style="margin:0 0 8px">Watching</span>
      <div class="watch-row">
        {#each watches as w}
          <button class="watch" class:on={watchFilter === w.id} onclick={() => (watchFilter = watchFilter === w.id ? 'all' : w.id)}>
            <span class="eye">👁</span>
            <span class="w-body"><b>{w.label}</b><span class="w-meta">{w.count} match{w.count === 1 ? '' : 'es'}{w.latest ? ` · latest ${fmtDate(w.latest)}` : ''}</span></span>
          </button>
        {/each}
        {#if watchFilter !== 'all'}<button class="watch-clear" onclick={() => (watchFilter = 'all')}>clear ✕</button>{/if}
      </div>
    </div>
  {/if}

  <!-- Filters -->
  <div class="filters">
    <input class="dsd-input search" bind:value={q} placeholder="Search the registry…" />
    <select class="dsd-select" bind:value={domain}>{#each domains as d}<option value={d}>{d === 'all' ? 'All domains' : d}</option>{/each}</select>
    <select class="dsd-select" bind:value={kind}>{#each kinds as k}<option value={k}>{k === 'all' ? 'All kinds' : k}</option>{/each}</select>
    <select class="dsd-select" bind:value={source}>{#each sources as s}<option value={s}>{s === 'all' ? 'All sources' : (SOURCE_LABEL[s] ?? s)}</option>{/each}</select>
    <label class="rev"><input type="checkbox" bind:checked={showReview} /> show unverified</label>
    <span class="count">{filtered.length} of {entries.length}</span>
  </div>

  <!-- Entries -->
  {#if filtered.length}
    <div class="entries">
      {#each filtered as e}
        <a class="entry" class:review={e.status === 'review'} href={e.url} target="_blank" rel="noopener">
          <div class="e-top">
            <span class="e-title">{e.title}</span>
            <div class="e-tags">
              {#if e.watch}<span class="dsd-pill watch-pill">👁 watch</span>{/if}
              {#if e.kind}<span class="dsd-pill">{e.kind}</span>{/if}
              {#if e.status === 'review'}<span class="dsd-pill warn">unverified</span>{/if}
              {#if e.confidence === 'high'}<span class="dsd-pill ok">high confidence</span>{/if}
            </div>
          </div>
          {#if e.summary}<p class="e-sum">{e.summary}</p>{/if}
          <div class="e-meta">
            {#if e.publisher}<span>{e.publisher}</span>{/if}
            {#if e.domain}<span class="dot-sep">{e.domain}</span>{/if}
            <span class="dot-sep">{SOURCE_LABEL[e.sourceKey] ?? e.sourceKey}</span>
            <span class="dot-sep">{fmtDate(e.publishedAt)}</span>
          </div>
        </a>
      {/each}
    </div>
  {:else}
    <p class="empty">No entries match. {entries.length === 0 ? 'Run a discovery sweep to populate the registry.' : 'Try widening the filters.'}</p>
  {/if}
</div>

<style>
  .health { border: 1.5px solid var(--card-border); border-radius: var(--radius-round); padding: 14px 16px; background: var(--card-bg); margin: 18px 0; }
  .health-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .refresh-msg { font-size: 12px; color: var(--text-secondary); margin: 8px 0 0; }
  .health-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; margin-top: 10px; }
  .hcard { border: 1.5px solid var(--card-border); border-radius: var(--radius-round); padding: 10px 12px; background: var(--surface-elevated); }
  .hcard.bad { border-color: var(--error-border); }
  .hc-top { display: flex; align-items: center; justify-content: space-between; }
  .hc-top b { font-size: 12.5px; color: var(--text-primary); }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--text-ghost); }
  .dot.ok { background: var(--success); } .dot.bad { background: var(--error); }
  .hc-stats { display: flex; gap: 12px; margin: 6px 0 3px; font-size: 11px; color: var(--text-muted); }
  .hc-stats b { color: var(--accent); font-family: var(--font-mono); }
  .hc-when { font-family: var(--font-mono); font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-ghost); }
  .hc-err { display: block; font-size: 11px; color: var(--error); margin-top: 4px; }

  .watches { margin-bottom: 14px; }
  .watch-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .watch { display: inline-flex; align-items: center; gap: 8px; text-align: left; border: 1.5px solid var(--info-border); border-radius: var(--radius-round); padding: 8px 12px; background: var(--info-bg); cursor: pointer; }
  .watch.on { border-color: var(--info); box-shadow: 0 0 0 2px var(--info-bg); }
  .watch .eye { font-size: 14px; }
  .watch .w-body { display: flex; flex-direction: column; }
  .watch b { font-size: 12.5px; color: var(--text-primary); }
  .watch .w-meta { font-family: var(--font-mono); font-size: 9.5px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--info); }
  .watch-clear { background: none; border: none; color: var(--text-muted); font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; cursor: pointer; }
  :global(.dsd-pill.watch-pill) { background: var(--info-bg); color: var(--info); }

  .filters { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 14px; }
  .search { flex: 1; min-width: 200px; max-width: 360px; }
  .filters .dsd-select { width: auto; }
  .rev { font-size: 12px; color: var(--text-muted); display: inline-flex; align-items: center; gap: 5px; }
  .count { font-family: var(--font-mono); font-size: 11px; color: var(--text-muted); margin-left: auto; }

  .entries { display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 10px; }
  .entry { display: block; border: 1.5px solid var(--card-border); border-radius: var(--radius-round); padding: 13px 15px; background: var(--surface-elevated); transition: border-color 0.15s; }
  .entry:hover { border-color: var(--accent); }
  .entry.review { border-left: 3px solid var(--warn); }
  .e-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
  .e-title { font-weight: 700; font-size: 14px; color: var(--text-primary); line-height: 1.25; }
  .e-tags { display: flex; gap: 4px; flex-wrap: wrap; flex-shrink: 0; }
  .e-sum { font-size: 12.5px; line-height: 1.5; color: var(--text-secondary); margin: 6px 0; }
  .e-meta { display: flex; flex-wrap: wrap; gap: 6px; font-size: 11px; color: var(--text-muted); margin-top: 4px; }
  .e-meta .dot-sep::before { content: '· '; color: var(--text-ghost); }
  .empty { color: var(--text-muted); font-style: italic; padding: 12px 0; }
</style>
