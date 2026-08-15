<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import type { PageData } from './$types';
  import StandardCard from '../components/StandardCard.svelte';
  import { CATALOG, standardById } from '../lib/knowledge';
  import type { Sector } from '../lib/types';
  const base = '/projects/data-standard-designer';
  let { data }: { data: PageData } = $props();

  type Entry = PageData['snapshot']['entries'][number];
  const entries = $derived((data.snapshot?.entries ?? []) as Entry[]);
  const health = $derived(data.snapshot?.sourceHealth ?? []);
  const watches = $derived(data.snapshot?.watches ?? []);

  // Kinds that count as an actual standard (vs guidance/news).
  const STANDARD_KINDS = ['data-standard', 'data-dictionary', 'metadata', 'api-standard', 'identifier'];
  const isStd = (e: Entry) => STANDARD_KINDS.includes(String(e.kind || ''));

  // ---------- LLM standards search ----------
  let query = $state('');
  let searching = $state(false);
  let searchErr = $state('');
  let searchNote = $state('');
  type Result = { refId: string; source: 'catalog' | 'registry'; name: string; owner: string; covers: string; why: string; ingestable: boolean };
  let results = $state<Result[]>([]);
  let searched = $state(false);

  async function runSearch() {
    const q = query.trim();
    if (!q || searching) return;
    searching = true;
    searchErr = '';
    searchNote = '';
    searched = true;
    // Pass classified registry standards as candidates so the model can pick real ones.
    const registryCandidates = entries.filter(isStd).slice(0, 18).map((e) => ({ refId: e.url, name: e.title, owner: e.publisher ?? '', covers: e.summary ?? '', kind: e.kind }));
    try {
      const res = await fetch(`${base}/assist`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'find-standards', query: q, registryCandidates }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.message || `Search failed (${res.status})`);
      }
      const j = await res.json();
      results = Array.isArray(j?.standards) ? j.standards : [];
      searchNote = String(j?.note || '');
    } catch (e: any) {
      searchErr = e?.message || 'Search is unavailable right now.';
      results = [];
    } finally {
      searching = false;
    }
  }
  const regUrl = (refId: string) => refId.replace(/^registry:/, '');
  const catId = (refId: string) => refId.replace(/^catalog:/, '');

  // ---------- browsable catalog ----------
  const SECTORS: { v: Sector | 'all'; l: string }[] = [
    { v: 'all', l: 'All' },
    { v: 'education', l: 'Education' },
    { v: 'childrens-social-care', l: "Children's social care" },
    { v: 'child-protection', l: 'Child protection' },
    { v: 'health', l: 'Health & care' },
    { v: 'local-gov', l: 'Local gov' },
    { v: 'cross-gov', l: 'Cross-gov' },
    { v: 'metadata', l: 'Metadata & publishing' },
  ];
  let catFilter = $state<Sector | 'all'>('all');
  let catQ = $state('');
  const catShown = $derived(
    CATALOG.filter((s) => (catFilter === 'all' || s.sector === catFilter) && (!catQ || `${s.name} ${s.owner} ${s.dataCovered || ''}`.toLowerCase().includes(catQ.toLowerCase()))),
  );

  // ---------- discovery feed (demoted) ----------
  let feedOpen = $state(false);
  let q = $state('');
  let domain = $state('all');
  let showAllKinds = $state(false);
  let watchFilter = $state('all');
  let refreshing = $state(false);
  let refreshMsg = $state('');

  const SOURCE_LABEL: Record<string, string> = { 'govuk-search': 'GOV.UK Search API', github: 'GitHub (gov orgs)', 'data-gov-uk': 'data.gov.uk' };
  const domains = $derived(['all', ...Array.from(new Set(entries.map((e) => e.domain).filter(Boolean)))] as string[]);
  const filtered = $derived(
    entries.filter((e) => {
      if (!showAllKinds && !isStd(e)) return false;
      if (watchFilter !== 'all' && e.watch !== watchFilter) return false;
      if (domain !== 'all' && e.domain !== domain) return false;
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
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30_000);
    try {
      const res = await fetch('/api/data-standard-designer/ingest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: ctrl.signal });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.message || `Failed (${res.status})`);
      refreshMsg = j?.throttled ? 'Recently swept — showing the latest results.' : `Swept ${j?.totalCandidates ?? 0} candidates; ${j?.classified ?? 0} newly classified.`;
    } catch {
      refreshMsg = 'Sweep running in the background — new entries appear as they are classified.';
    } finally {
      clearTimeout(timer);
      await invalidateAll();
      refreshing = false;
    }
  }
</script>

{#snippet eyeIcon()}
  <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 10S4.5 4 10 4s8.5 6 8.5 6-3 6-8.5 6-8.5-6-8.5-6Z" /><circle cx="10" cy="10" r="2.4" /></svg>
{/snippet}

<div class="dsd-route wide">
  <span class="dsd-eyebrow">Standards registry</span>
  <h1 class="dsd-h1" style="font-size:clamp(26px,4vw,40px)">Find a standard before you build one.</h1>
  <p class="dsd-prose">Search across the {CATALOG.length} grounded standards this tool knows about, plus the ones it auto-discovers across government. Ask in plain language — the search returns <b>actual standards</b> to reuse or align with, not news articles that happen to mention them.</p>

  <!-- SEARCH HERO -->
  <div class="search-hero">
    <div class="sh-row">
      <input class="dsd-input" bind:value={query} placeholder="e.g. standards for recording a child's missing-education episode" onkeydown={(e) => e.key === 'Enter' && runSearch()} />
      <button class="dsd-btn primary" disabled={searching || !query.trim()} onclick={runSearch}>{searching ? 'Searching…' : '✦ Find standards'}</button>
    </div>
    {#if searchErr}<p class="sh-err">⚠ {searchErr}</p>{/if}
    {#if searched && !searching}
      {#if results.length}
        {#if searchNote}<p class="sh-note">{searchNote}</p>{/if}
        <div class="results">
          {#each results as r}
            {#if r.source === 'catalog'}
              {@const s = standardById(catId(r.refId))}
              {#if s}
                <div class="res-wrap"><StandardCard std={s} /><p class="why">↳ {r.why}</p></div>
              {/if}
            {:else}
              <a class="reg-result" href={regUrl(r.refId)} target="_blank" rel="noopener">
                <div class="rr-top"><b>{r.name}</b><span class="dsd-pill muted">discovered</span></div>
                {#if r.owner}<span class="rr-owner">{r.owner}</span>{/if}
                {#if r.covers}<p class="rr-covers">{r.covers}</p>{/if}
                <p class="why">↳ {r.why}</p>
              </a>
            {/if}
          {/each}
        </div>
      {:else}
        <p class="sh-empty">No matching standards found{searchNote ? ` — ${searchNote}` : '. Try different terms, or browse the catalog below.'}</p>
      {/if}
    {/if}
  </div>

  <!-- BROWSE CATALOG -->
  <h2 class="dsd-h2">Browse the catalog <span class="muted-n">({CATALOG.length})</span></h2>
  <p class="dsd-prose" style="margin-bottom:12px">Click any standard to explore it — its identifiers, data items, the standards it connects to — and <b>ingest it into your design</b>.</p>
  <div class="filters">
    {#each SECTORS as s}<button class="dsd-chip" class:on={catFilter === s.v} onclick={() => (catFilter = s.v)}>{s.l}</button>{/each}
    <input class="dsd-input search" bind:value={catQ} placeholder="Search the catalog…" />
  </div>
  <div class="cat-grid">
    {#each catShown as s}<StandardCard std={s} />{/each}
    {#if !catShown.length}<p class="empty">No standards match.</p>{/if}
  </div>

  <!-- DISCOVERY FEED (demoted) -->
  <div class="feed">
    <button class="feed-toggle" onclick={() => (feedOpen = !feedOpen)} aria-expanded={feedOpen}>
      <span class="caret">{feedOpen ? '▾' : '▸'}</span>
      Discovery feed &amp; source health
      <span class="feed-sub">{entries.filter(isStd).length} discovered standards · auto-refreshed</span>
    </button>
    {#if feedOpen}
      <div class="feed-body">
        <p class="dsd-prose" style="font-size: var(--fs-label)">Discovery is <b>index-driven</b> — it reads official timestamped indexes (the GOV.UK Search API, gov GitHub orgs) and AI only classifies what's found. A broken feed is visible here, not silent.</p>

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
                <div class="hc-stats"><span><b>{h.itemsFound}</b> found</span><span><b>{h.itemsNew}</b> new</span>{#if h.totalAvailable != null}<span><b>{h.totalAvailable.toLocaleString()}</b> indexed</span>{/if}</div>
                <span class="hc-when">{h.ok ? `swept ${ago(h.runAt)}` : `failed ${ago(h.runAt)}`}</span>
                {#if h.error}<span class="hc-err">{h.error}</span>{/if}
              </div>
            {/each}
          </div>
        {:else}
          <p class="empty">No discovery sweep has run yet. Hit <b>Refresh now</b>, or the daily cron will fill it.</p>
        {/if}
        {#if data.error}<p class="hc-err" style="margin-top:8px">Registry storage not ready: {data.error}</p>{/if}

        {#if watches.length}
          <div class="watches">
            <span class="dsd-label" style="margin:10px 0 8px">Watching</span>
            <div class="watch-row">
              {#each watches as w}
                <button class="watch" class:on={watchFilter === w.id} onclick={() => (watchFilter = watchFilter === w.id ? 'all' : w.id)}>
                  <span class="eye">{@render eyeIcon()}</span><span class="w-body"><b>{w.label}</b><span class="w-meta">{w.count} match{w.count === 1 ? '' : 'es'}{w.latest ? ` · latest ${fmtDate(w.latest)}` : ''}</span></span>
                </button>
              {/each}
              {#if watchFilter !== 'all'}<button class="watch-clear" onclick={() => (watchFilter = 'all')}>clear ✕</button>{/if}
            </div>
          </div>
        {/if}

        <div class="filters" style="margin-top:12px">
          <input class="dsd-input search" bind:value={q} placeholder="Search the feed…" />
          <select class="dsd-select" bind:value={domain}>{#each domains as d}<option value={d}>{d === 'all' ? 'All domains' : d}</option>{/each}</select>
          <label class="rev"><input type="checkbox" bind:checked={showAllKinds} /> include guidance/other</label>
          <span class="count">{filtered.length} of {entries.length}</span>
        </div>

        {#if filtered.length}
          <div class="entries">
            {#each filtered as e}
              <a class="entry" href={e.url} target="_blank" rel="noopener">
                <div class="e-top"><span class="e-title">{e.title}</span><div class="e-tags">{#if e.watch}<span class="dsd-pill watch-pill">{@render eyeIcon()}</span>{/if}{#if e.kind}<span class="dsd-pill">{e.kind}</span>{/if}{#if e.confidence === 'high'}<span class="dsd-pill ok">high</span>{/if}</div></div>
                {#if e.summary}<p class="e-sum">{e.summary}</p>{/if}
                <div class="e-meta">{#if e.publisher}<span>{e.publisher}</span>{/if}{#if e.domain}<span class="dot-sep">{e.domain}</span>{/if}<span class="dot-sep">{SOURCE_LABEL[e.sourceKey] ?? e.sourceKey}</span><span class="dot-sep">{fmtDate(e.publishedAt)}</span></div>
              </a>
            {/each}
          </div>
        {:else}
          <p class="empty">No entries match. {entries.length === 0 ? 'Run a discovery sweep to populate the registry.' : 'Try widening the filters.'}</p>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .search-hero { border: 2px solid var(--text-primary); border-radius: var(--radius-sharp); padding: 16px; background: var(--card-bg); margin: 18px 0 8px; }
  .sh-row { display: flex; gap: 10px; flex-wrap: wrap; }
  .sh-row .dsd-input { flex: 1; min-width: 240px; }
  .sh-err { font-size: var(--fs-label-xs); color: var(--error); background: var(--error-bg); padding: 7px 10px; border-radius: var(--radius-sharp); margin: 10px 0 0; }
  .sh-note { font-size: var(--fs-label); color: var(--text-secondary); margin: 10px 0 4px; }
  .sh-empty { font-size: var(--fs-label); color: var(--text-muted); font-style: italic; margin: 12px 0 0; }
  .results { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; margin-top: 12px; }
  .res-wrap { display: flex; flex-direction: column; }
  .why { font-size: var(--fs-label-xs); color: var(--accent); margin: 6px 0 0; line-height: 1.4; }
  .reg-result { display: block; border: 1.5px solid var(--card-border); border-left: 3px solid var(--text-ghost); border-radius: var(--radius-sharp); padding: 12px 14px; background: var(--surface-elevated); }
  .reg-result:hover { border-color: var(--accent); }
  .rr-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
  .rr-top b { font-size: var(--fs-label); color: var(--text-primary); line-height: 1.25; }
  .rr-owner { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-ghost); }
  .rr-covers { font-size: var(--fs-label-xs); color: var(--text-secondary); margin: 5px 0; line-height: 1.45; }

  .muted-n { font-family: var(--font-mono); font-size: var(--fs-label); color: var(--text-ghost); font-weight: 400; }
  .filters { display: flex; flex-wrap: wrap; gap: 7px; align-items: center; margin-bottom: 14px; }
  .filters .dsd-select { width: auto; }
  .search { width: auto; flex: 1; min-width: 180px; max-width: 280px; margin-left: auto; }
  .cat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(270px, 1fr)); gap: 12px; }
  .empty { color: var(--text-muted); font-style: italic; }

  .feed { margin: 26px 0 10px; border: 1.5px solid var(--card-border); border-radius: var(--radius-sharp); overflow: hidden; }
  .feed-toggle { width: 100%; display: flex; align-items: center; gap: 10px; padding: 12px 16px; background: var(--card-bg); border: none; cursor: pointer; text-align: left; font-weight: 700; font-size: var(--fs-nav); color: var(--text-primary); }
  .feed-toggle:hover { background: var(--accent-tint-04); }
  .feed-toggle .caret { font-size: var(--fs-label-xs); color: var(--text-muted); }
  .feed-sub { margin-left: auto; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); font-weight: 400; }
  .feed-body { padding: 14px 16px; border-top: 1px solid var(--divider); }

  .health-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 10px; }
  .refresh-msg { font-size: var(--fs-label-xs); color: var(--text-secondary); margin: 8px 0 0; }
  .health-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px; margin-top: 10px; }
  .hcard { border: 1.5px solid var(--card-border); border-radius: var(--radius-sharp); padding: 10px 12px; background: var(--surface-elevated); }
  .hcard.bad { border-color: var(--error-border); }
  .hc-top { display: flex; align-items: center; justify-content: space-between; }
  .hc-top b { font-size: var(--fs-label); color: var(--text-primary); }
  .dot { width: 9px; height: 9px; border-radius: var(--radius-pill); background: var(--text-ghost); }
  .dot.ok { background: var(--success); } .dot.bad { background: var(--error); }
  .hc-stats { display: flex; gap: 12px; margin: 6px 0 3px; font-size: var(--fs-label-xs); color: var(--text-muted); }
  .hc-stats b { color: var(--accent); font-family: var(--font-mono); }
  .hc-when { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-ghost); }
  .hc-err { display: block; font-size: var(--fs-label-xs); color: var(--error); margin-top: 4px; }

  .watch-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .watch { display: inline-flex; align-items: center; gap: 8px; text-align: left; border: 1.5px solid var(--info-border); border-radius: var(--radius-sharp); padding: 8px 12px; background: var(--info-bg); cursor: pointer; }
  .watch.on { border-color: var(--info); box-shadow: 0 0 0 2px var(--info-bg); }
  .watch .eye { display: inline-flex; color: var(--info); }
  .watch .w-body { display: flex; flex-direction: column; }
  .watch b { font-size: var(--fs-label); color: var(--text-primary); }
  .watch .w-meta { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.04em; color: var(--info); }
  .watch-clear { background: none; border: none; color: var(--text-muted); font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; cursor: pointer; }
  :global(.dsd-pill.watch-pill) { background: var(--info-bg); color: var(--info); display: inline-flex; align-items: center; }

  .rev { font-size: var(--fs-label-xs); color: var(--text-muted); display: inline-flex; align-items: center; gap: 5px; }
  .count { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-muted); margin-left: auto; }
  .entries { display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 10px; }
  .entry { display: block; border: 1.5px solid var(--card-border); border-radius: var(--radius-sharp); padding: 13px 15px; background: var(--surface-elevated); transition: border-color 0.15s; }
  .entry:hover { border-color: var(--accent); }
  .e-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
  .e-title { font-weight: 700; font-size: var(--fs-nav); color: var(--text-primary); line-height: 1.25; }
  .e-tags { display: flex; gap: 4px; flex-wrap: wrap; flex-shrink: 0; }
  .e-sum { font-size: var(--fs-label); line-height: 1.5; color: var(--text-secondary); margin: 6px 0; }
  .e-meta { display: flex; flex-wrap: wrap; gap: 6px; font-size: var(--fs-label-xs); color: var(--text-muted); margin-top: 4px; }
  .e-meta .dot-sep::before { content: '· '; color: var(--text-ghost); }
</style>
