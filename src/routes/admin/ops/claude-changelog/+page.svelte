<script lang="ts">
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';

  let { data } = $props();

  const STAGE_ORDER = ['request', 'design', 'plan', 'result', 'fixes'] as const;
  const STAGE_LABEL: Record<string, string> = {
    request: 'Request', design: 'Design', plan: 'Plan', result: 'Result', fixes: 'Fixes',
  };

  const stageFilter = $derived(data.filters.stage);

  // Client-side stage filtering: when a stage is selected, keep only sessions that
  // contain it, and show only that stage's segments within each card.
  const items = $derived(
    stageFilter === 'all'
      ? data.items
      : data.items
          .map((s) => ({ ...s, stages: s.stages.filter((st) => st.stage === stageFilter) }))
          .filter((s) => s.stages.length > 0),
  );

  let expanded = $state<Record<string, boolean>>({});
  function toggle(id: string) {
    expanded = { ...expanded, [id]: !expanded[id] };
  }

  let raw = $state<null | { title: string; stage: string; text: string }>(null);

  function openStageRaw(sess: { title: string | null; id: string }, st: { stage: string; rawText: string | null }) {
    raw = {
      title: sess.title || sess.id.slice(0, 8),
      stage: STAGE_LABEL[st.stage] ?? st.stage,
      text: st.rawText || '(no raw text captured for this stage)',
    };
  }

  // Per-session detail modal: full transcript + auditable cost breakdown, fetched on demand.
  type CostLine = {
    model: string; known: boolean; costUsd: number;
    tokens: { input: number; output: number; cacheRead: number; cacheWrite5m: number; cacheWrite1h: number };
    rates: { input: number; output: number; cacheRead: number; cacheWrite5m: number; cacheWrite1h: number } | null;
  };
  type Detail = {
    id: string; title: string; project: string; models: string[];
    estCostUsd: number | null; costKnown: boolean; costBreakdown: CostLine[];
    fullTranscript: string | null; transcriptPath: string;
  };
  let detail = $state<Detail | null>(null);
  let detailTitle = $state('');
  let detailLoading = $state(false);
  let detailErr = $state<string | null>(null);

  async function openDetail(id: string, title: string) {
    detailTitle = title;
    detailLoading = true;
    detailErr = null;
    detail = null;
    try {
      const res = await fetch(`/api/claude-changelog/session/${id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      detail = await res.json();
    } catch (e) {
      detailErr = e instanceof Error ? e.message : 'failed to load';
    } finally {
      detailLoading = false;
    }
  }
  function closeDetail() {
    detail = null;
    detailTitle = '';
    detailErr = null;
  }

  const featureMax = $derived(Math.max(1, ...data.featureDist.map((f) => f.count)));
  const termMax = $derived(Math.max(1, ...data.topTerms.map((t) => t.count)));
  const costMax = $derived(Math.max(0.01, ...data.costSeries.map((c) => c.cost)));

  function fmtNum(n: number): string {
    return (n ?? 0).toLocaleString();
  }
  function fmtK(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(n ?? 0);
  }
  function fmtCost(n: number | null): string {
    if (n == null) return '—';
    return '$' + n.toFixed(n < 10 ? 2 : 0);
  }
  function fmtDate(iso: string | Date | null): string {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
  }
</script>

<svelte:head><title>Claude Changelog · Admin</title></svelte:head>

<PageWrap width="wide">
  <PageHeader
    kicker="Ops"
    title="claude changelog"
    sub="Every Claude Code engagement on this codebase, decomposed into request · design · plan · result · fixes. Auto-ingested from session transcripts."
    crumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Ops', href: '/admin/ops/agent' }, { label: 'Changelog' }]}
  />

  <!-- Filters -->
  <form class="filters" method="GET" data-sveltekit-keepfocus>
    <label class="f">
      <span>Project</span>
      <select name="project" onchange={(e) => e.currentTarget.form?.requestSubmit()}>
        <option value="all" selected={data.filters.project === 'all'}>All projects</option>
        {#each data.projects as p (p.project)}
          <option value={p.project} selected={data.filters.project === p.project}>{p.project} ({p.count})</option>
        {/each}
      </select>
    </label>
    <label class="f">
      <span>Stage</span>
      <select name="stage" onchange={(e) => e.currentTarget.form?.requestSubmit()}>
        <option value="all" selected={stageFilter === 'all'}>All stages</option>
        {#each STAGE_ORDER as st}
          <option value={st} selected={stageFilter === st}>{STAGE_LABEL[st]}</option>
        {/each}
      </select>
    </label>
    <label class="f grow">
      <span>Search</span>
      <input type="search" name="q" value={data.filters.q} placeholder="title or prompt…" />
    </label>
    <button type="submit" class="go">Filter</button>
  </form>

  <!-- KPI tiles -->
  <div class="stat-grid">
    <div class="stat"><span class="stat-v">{fmtNum(data.totals.sessions)}</span><span class="stat-l">sessions</span></div>
    <div class="stat"><span class="stat-v">{fmtCost(data.totals.totalCost)}{#if !data.totals.costKnown}<span class="approx">*</span>{/if}</span><span class="stat-l">est. cost{#if !data.totals.costKnown} (partial)*{/if}</span></div>
    <div class="stat"><span class="stat-v">{fmtK(data.totals.totalOutput)}</span><span class="stat-l">output tokens</span></div>
    <div class="stat"><span class="stat-v">{data.totals.projectCount}</span><span class="stat-l">projects</span></div>
    <div class="stat"><span class="stat-v mono">{fmtDate(data.totals.minDate)}</span><span class="stat-l">→ {fmtDate(data.totals.maxDate)}</span></div>
  </div>

  <!-- Categorical panels -->
  <div class="cat-grid">
    <section class="nm-sec">
      <div class="nm-sec-hd"><span class="sr-label-tight">Feature types</span><span class="nm-sec-meta">across sessions</span></div>
      {#if data.featureDist.length}
        <div class="bars">
          {#each data.featureDist as f (f.type)}
            <div class="bar-row">
              <span class="bar-lbl">{f.type}</span>
              <span class="bar-track"><span class="bar-fill" style={`width:${Math.round((f.count / featureMax) * 100)}%`}></span></span>
              <span class="bar-val">{f.count}</span>
            </div>
          {/each}
        </div>
      {:else}<p class="empty-note">No data.</p>{/if}
    </section>

    <section class="nm-sec">
      <div class="nm-sec-hd"><span class="sr-label-tight">Top terms</span><span class="nm-sec-meta">in prompts &amp; plans</span></div>
      {#if data.topTerms.length}
        <div class="terms">
          {#each data.topTerms as t (t.term)}
            <span class="term" style={`--w:${Math.max(0.72, (t.count / termMax)).toFixed(2)}`} title={`${t.count}×`}>{t.term}</span>
          {/each}
        </div>
      {:else}<p class="empty-note">No data.</p>{/if}
    </section>
  </div>

  <section class="nm-sec">
    <div class="nm-sec-hd"><span class="sr-label-tight">Estimated cost over time</span><span class="nm-sec-meta">by week</span></div>
    {#if data.costSeries.length}
      <div class="spark" role="img" aria-label="estimated cost per week">
        {#each data.costSeries as c (c.week)}
          <div class="spark-col" title={`${c.week}: ${fmtCost(c.cost)} · ${c.sessions} session(s)`}>
            <div class="spark-bar" style={`height:${Math.max(4, Math.round((c.cost / costMax) * 100))}%`}></div>
          </div>
        {/each}
      </div>
      <div class="spark-cap mono">{data.costSeries[0]?.week} → {data.costSeries[data.costSeries.length - 1]?.week}</div>
    {:else}<p class="empty-note">No dated sessions.</p>{/if}
  </section>

  <!-- Session timeline -->
  <section class="nm-sec">
    <div class="nm-sec-hd"><span class="sr-label-tight">Sessions</span><span class="nm-sec-meta">newest first · {items.length} shown</span></div>
    {#if items.length === 0}
      <p class="empty-note">No sessions match these filters.</p>
    {/if}
    <div class="sessions">
      {#each items as s (s.id)}
        {@const maxStageCost = Math.max(0.0001, ...s.stages.map((x) => x.costUsd ?? 0))}
        <article class="session" class:open={expanded[s.id]}>
          <button class="session-hd" onclick={() => toggle(s.id)} aria-expanded={expanded[s.id] ?? false}>
            <span class="date mono">{fmtDate(s.startedAt)}</span>
            <span class="titles">
              <span class="s-title">{s.title || s.id.slice(0, 8)}</span>
              <span class="s-meta">
                <span class="proj-chip">{s.project}</span>
                {#if s.status === 'active'}<span class="live-chip">● live</span>{/if}
                {#each (s.featureTypes as string[]) ?? [] as f}<span class="feat-chip">{f}</span>{/each}
              </span>
            </span>
            <span class="cost-spark" aria-label="estimated cost per stage — click a bar for its raw view">
              {#if s.stages.length === 0}
                <span class="cs-empty">—</span>
              {:else}
                {#each s.stages as st (st.id)}
                  <span
                    class="cs-bar"
                    data-stage={st.stage}
                    role="button"
                    tabindex="-1"
                    style={`height:${Math.max(9, Math.round(((st.costUsd ?? 0) / maxStageCost) * 100))}%`}
                    title={`${STAGE_LABEL[st.stage] ?? st.stage}: ${fmtCost(st.costUsd ?? 0)} · ${fmtK(((st.tokens as { output?: number })?.output) ?? 0)} out tok — click for raw`}
                    onclick={(e) => { e.stopPropagation(); openStageRaw(s, st); }}
                    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); openStageRaw(s, st); } }}
                  ></span>
                {/each}
              {/if}
            </span>
            <span class="s-cost">
              <span class="c-val">{fmtCost(s.estCostUsd)}</span>
              <span class="c-sub mono">{fmtK(((s.tokens as { output?: number })?.output) ?? 0)} out</span>
            </span>
            <span class="chev" aria-hidden="true">{expanded[s.id] ? '▾' : '▸'}</span>
          </button>

          {#if expanded[s.id]}
            <div class="stages">
              <div class="detail-bar">
                <button class="detail-btn" onclick={() => openDetail(s.id, s.title || s.id.slice(0, 8))}>
                  ⌗ Full transcript &amp; cost breakdown
                </button>
              </div>
              {#if s.stages.length === 0}<p class="empty-note small">No stage segments.</p>{/if}
              {#each s.stages as st (st.id)}
                <div class="stage-card" data-stage={st.stage}>
                  <div class="stage-top">
                    <span class="stage-badge" data-stage={st.stage}>{STAGE_LABEL[st.stage] ?? st.stage}</span>
                    <span class="stage-title">{st.title}</span>
                    <span class="stage-meta mono">
                      {st.messageCount} msg · {st.toolCalls} tools · {fmtK(((st.tokens as { output?: number })?.output) ?? 0)} out
                    </span>
                  </div>
                  {#if st.summary}<p class="stage-sum">{st.summary}</p>{/if}
                  {#if st.rawText}
                    <button class="raw-btn" onclick={() => (raw = { title: s.title || s.id.slice(0, 8), stage: STAGE_LABEL[st.stage] ?? st.stage, text: st.rawText! })}>
                      View raw {st.stage === 'plan' ? 'plan' : st.stage === 'request' || st.stage === 'fixes' ? 'prompt' : 'detail'}
                    </button>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        </article>
      {/each}
    </div>

    {#if data.hasMore || data.filters.page > 0}
      <div class="pager">
        {#if data.filters.page > 0}
          <a class="page-btn" href={`?project=${data.filters.project}&stage=${data.filters.stage}&q=${encodeURIComponent(data.filters.q)}&page=${data.filters.page - 1}`}>← Newer</a>
        {/if}
        {#if data.hasMore}
          <a class="page-btn" href={`?project=${data.filters.project}&stage=${data.filters.stage}&q=${encodeURIComponent(data.filters.q)}&page=${data.filters.page + 1}`}>Older →</a>
        {/if}
      </div>
    {/if}
  </section>
</PageWrap>

<!-- Raw prompt/plan viewer -->
{#if raw}
  <div
    class="raw-overlay"
    role="dialog"
    aria-modal="true"
    aria-label="Raw text"
    tabindex="-1"
    onclick={() => (raw = null)}
    onkeydown={(e) => { if (e.key === 'Escape') raw = null; }}
  >
    <div class="raw-modal" role="document" onclick={(e) => e.stopPropagation()}>
      <div class="raw-hd">
        <span class="raw-stage">{raw.stage}</span>
        <span class="raw-title">{raw.title}</span>
        <button class="raw-close" onclick={() => (raw = null)} aria-label="Close">✕</button>
      </div>
      <pre class="raw-body">{raw.text}</pre>
    </div>
  </div>
{/if}

<!-- Per-session detail: full transcript + auditable cost breakdown -->
{#if detail !== null || detailLoading || detailErr}
  <div
    class="raw-overlay"
    role="dialog"
    aria-modal="true"
    aria-label="Session detail"
    tabindex="-1"
    onclick={closeDetail}
    onkeydown={(e) => { if (e.key === 'Escape') closeDetail(); }}
  >
    <div class="raw-modal detail-modal" role="document" onclick={(e) => e.stopPropagation()}>
      <div class="raw-hd">
        <span class="raw-stage">SESSION</span>
        <span class="raw-title">{detailTitle}</span>
        <button class="raw-close" onclick={closeDetail} aria-label="Close">✕</button>
      </div>
      {#if detailLoading}
        <p class="detail-loading">Loading full transcript…</p>
      {:else if detailErr}
        <p class="detail-loading">Couldn't load detail ({detailErr}).</p>
      {:else if detail}
        <div class="detail-body">
          <!-- Cost breakdown -->
          <div class="cost-block">
            <div class="cost-hd">
              <span class="sr-label-tight">Cost breakdown</span>
              <span class="nm-sec-meta">tokens × Anthropic API rate — {fmtCost(detail.estCostUsd)}{#if !detail.costKnown} (partial){/if}</span>
            </div>
            <div class="cost-scroll">
              <table class="cost-table">
                <thead>
                  <tr><th>model</th><th>input</th><th>output</th><th>cache read</th><th>cache write</th><th>cost</th></tr>
                </thead>
                <tbody>
                  {#each detail.costBreakdown as c (c.model)}
                    <tr>
                      <td class="mono">{c.model}</td>
                      <td>{fmtK(c.tokens.input)}{#if c.rates}<span class="rate">@${c.rates.input}</span>{/if}</td>
                      <td>{fmtK(c.tokens.output)}{#if c.rates}<span class="rate">@${c.rates.output}</span>{/if}</td>
                      <td>{fmtK(c.tokens.cacheRead)}{#if c.rates}<span class="rate">@${c.rates.cacheRead}</span>{/if}</td>
                      <td>{fmtK(c.tokens.cacheWrite5m + c.tokens.cacheWrite1h)}{#if c.rates}<span class="rate">@${c.rates.cacheWrite1h}/{c.rates.cacheWrite5m}</span>{/if}</td>
                      <td class="cost-val">{c.known ? fmtCost(c.costUsd) : 'n/a'}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
            <p class="cost-note">Rates in $/million tokens (input · output · cache-read · cache-write 1h/5m), per the model used in each message. Verified against Anthropic's published API pricing; the 1M context window is billed at standard rates (no long-context premium).</p>
          </div>
          <!-- Full transcript -->
          <div class="cost-hd"><span class="sr-label-tight">Full transcript</span><span class="nm-sec-meta mono">{detail.transcriptPath?.split('/').pop()}</span></div>
          <pre class="raw-body transcript-body">{detail.fullTranscript || '(no transcript stored)'}</pre>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  /* Filters */
  .filters {
    display: flex; flex-wrap: wrap; gap: 0.75rem; align-items: flex-end;
    margin-bottom: 1.5rem;
  }
  .f { display: flex; flex-direction: column; gap: 0.3rem; }
  .f.grow { flex: 1; min-width: 180px; }
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

  /* Stat tiles */
  .stat-grid {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 0.75rem; margin-bottom: 1.75rem;
  }
  .stat {
    display: flex; flex-direction: column; gap: 0.25rem; padding: 0.9rem 1rem;
    border: 1px solid var(--border, rgba(120, 110, 100, 0.25));
    border-radius: 6px; background: var(--surface-elevated, transparent);
  }
  .stat-v { font-family: var(--font-brand); font-size: 1.5rem; line-height: 1; color: var(--text-primary); }
  .stat-v.mono, .mono { font-family: var(--font-mono); }
  .stat-v.mono { font-size: 1rem; }
  .stat-l { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-ghost); }
  .approx { color: var(--accent); }

  /* Sections */
  .nm-sec {
    border: 1px solid var(--border, rgba(120, 110, 100, 0.25)); border-radius: 8px;
    padding: 1.1rem 1.2rem; margin-bottom: 1.25rem; background: var(--surface-elevated, transparent);
  }
  .nm-sec-hd { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 0.9rem; }
  .sr-label-tight { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 600; text-transform: uppercase; letter-spacing: 0.14em; color: var(--text-primary); }
  .nm-sec-meta { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-ghost); }
  .empty-note { color: var(--text-muted); font-size: 0.9rem; }
  .empty-note.small { font-size: 0.82rem; }

  .cat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem; }
  @media (max-width: 720px) { .cat-grid { grid-template-columns: 1fr; } }

  /* Horizontal bars */
  .bars { display: flex; flex-direction: column; gap: 0.35rem; }
  .bar-row { display: grid; grid-template-columns: 120px 1fr 34px; align-items: center; gap: 0.6rem; font-size: 0.85rem; }
  .bar-lbl { color: var(--text-secondary); font-family: var(--font-mono); font-size: 0.78rem; }
  .bar-track { height: 10px; background: var(--border, rgba(120, 110, 100, 0.18)); border-radius: 3px; overflow: hidden; }
  .bar-fill { display: block; height: 100%; background: var(--accent); border-radius: 3px; }
  .bar-val { text-align: right; font-family: var(--font-mono); font-size: 0.78rem; color: var(--text-ghost); }

  /* Term "cloud" (sized by frequency) */
  .terms { display: flex; flex-wrap: wrap; gap: 0.4rem 0.55rem; align-items: baseline; }
  .term {
    font-family: var(--font-mono); font-size: calc(0.72rem + (var(--w) - 0.72) * 0.7rem);
    color: var(--text-secondary); opacity: calc(0.55 + var(--w) * 0.45);
  }

  /* Spark bars */
  .spark { display: flex; align-items: flex-end; gap: 2px; height: 90px; }
  .spark-col { flex: 1; height: 100%; display: flex; align-items: flex-end; min-width: 3px; }
  .spark-bar { width: 100%; background: var(--accent); border-radius: 2px 2px 0 0; opacity: 0.85; }
  .spark-cap { margin-top: 0.4rem; font-size: var(--fs-label-xs); color: var(--text-ghost); }

  /* Sessions */
  .sessions { display: flex; flex-direction: column; gap: 0.55rem; }
  .session { border: 1px solid var(--border, rgba(120, 110, 100, 0.22)); border-radius: 6px; overflow: hidden; }
  .session.open { border-color: var(--accent); }
  .session-hd {
    display: grid; grid-template-columns: 72px 1fr auto auto 18px; align-items: center; gap: 0.9rem;
    width: 100%; padding: 0.7rem 0.9rem; background: transparent; border: none; cursor: pointer;
    text-align: left; color: var(--text-primary); font-family: var(--font-body);
  }
  .session-hd:hover { background: var(--surface-elevated, rgba(120, 110, 100, 0.05)); }
  .date { font-size: var(--fs-label-xs); color: var(--text-ghost); }
  .titles { min-width: 0; display: flex; flex-direction: column; gap: 0.28rem; }
  .s-title { font-size: 0.95rem; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .s-meta { display: flex; flex-wrap: wrap; gap: 0.3rem; align-items: center; }
  .proj-chip, .feat-chip, .live-chip {
    font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.08em;
    padding: 0.1rem 0.35rem; border-radius: 3px;
  }
  .proj-chip { background: var(--accent); color: var(--bg); }
  .feat-chip { background: var(--border, rgba(120, 110, 100, 0.18)); color: var(--text-muted); }
  .live-chip { background: #2f9e5f; color: #fff; }
  /* Cost-per-stage sparkline: one bar per stage segment (in order), height ∝ est. cost, coloured by stage. */
  .cost-spark { display: flex; align-items: flex-end; gap: 1px; height: 26px; width: 112px; }
  .cost-spark:hover { gap: 1.5px; }
  .cs-empty { margin: auto; color: var(--text-ghost); font-size: 0.85rem; }
  .cs-bar {
    flex: 1; min-width: 2px; border-radius: 1px 1px 0 0;
    background: var(--border, rgba(120, 110, 100, 0.4)); opacity: 0.92;
    cursor: pointer; padding: 0; border: none; transition: opacity 0.1s, transform 0.1s;
  }
  .cs-bar:hover, .cs-bar:focus-visible { opacity: 1; transform: scaleY(1.08); outline: 1px solid var(--text-primary); outline-offset: 1px; }
  .cs-bar[data-stage='request'] { background: #6b7f99; }
  .cs-bar[data-stage='design'] { background: #9b7fb8; }
  .cs-bar[data-stage='plan'] { background: #c99a4b; }
  .cs-bar[data-stage='result'] { background: #4f9e6a; }
  .cs-bar[data-stage='fixes'] { background: #c56b6b; }
  .s-cost { display: flex; flex-direction: column; align-items: flex-end; gap: 0.15rem; }
  .c-val { font-family: var(--font-brand); font-size: 0.95rem; }
  .c-sub { font-size: var(--fs-label-xs); color: var(--text-ghost); }
  .chev { color: var(--text-ghost); font-size: 0.8rem; }

  .stages { padding: 0.3rem 0.9rem 0.9rem; display: flex; flex-direction: column; gap: 0.5rem; border-top: 1px dashed var(--border, rgba(120, 110, 100, 0.2)); }
  .stage-card { border-left: 3px solid var(--border); padding: 0.5rem 0.75rem; border-radius: 0 4px 4px 0; background: var(--surface-elevated, rgba(120, 110, 100, 0.04)); }
  .stage-card[data-stage='request'] { border-left-color: #6b7f99; }
  .stage-card[data-stage='design'] { border-left-color: #9b7fb8; }
  .stage-card[data-stage='plan'] { border-left-color: #c99a4b; }
  .stage-card[data-stage='result'] { border-left-color: #4f9e6a; }
  .stage-card[data-stage='fixes'] { border-left-color: #c56b6b; }
  .stage-top { display: flex; flex-wrap: wrap; align-items: center; gap: 0.55rem; }
  .stage-badge { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; padding: 0.12rem 0.4rem; border-radius: 3px; color: #fff; }
  .stage-badge[data-stage='request'] { background: #6b7f99; }
  .stage-badge[data-stage='design'] { background: #9b7fb8; }
  .stage-badge[data-stage='plan'] { background: #c99a4b; }
  .stage-badge[data-stage='result'] { background: #4f9e6a; }
  .stage-badge[data-stage='fixes'] { background: #c56b6b; }
  .stage-title { font-size: 0.9rem; color: var(--text-primary); min-width: 0; }
  .stage-meta { margin-left: auto; font-size: var(--fs-label-xs); color: var(--text-ghost); }
  .stage-sum { margin: 0.4rem 0 0; font-size: 0.85rem; color: var(--text-secondary); line-height: 1.4; }
  .raw-btn {
    margin-top: 0.5rem; background: transparent; border: 1px solid var(--border, rgba(120, 110, 100, 0.35));
    color: var(--text-secondary); border-radius: 4px; padding: 0.25rem 0.6rem; font-size: 0.75rem;
    font-family: var(--font-mono); cursor: pointer;
  }
  .raw-btn:hover { border-color: var(--accent); color: var(--accent); }

  .pager { display: flex; justify-content: space-between; margin-top: 1rem; }
  .page-btn { font-family: var(--font-mono); font-size: 0.8rem; color: var(--text-secondary); text-decoration: none; padding: 0.4rem 0.7rem; border: 1px solid var(--border); border-radius: 4px; }
  .page-btn:hover { border-color: var(--accent); color: var(--accent); }

  /* Raw modal — opaque background, full-viewport fixed overlay */
  .raw-overlay {
    position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center;
    background: rgba(20, 16, 12, 0.72); padding: 2rem 1rem;
  }
  .raw-modal {
    background: var(--surface-elevated, var(--bg)); color: var(--text-primary);
    border: 1px solid var(--border, rgba(120, 110, 100, 0.4)); border-radius: 8px;
    width: min(860px, 100%); max-height: 85vh; display: flex; flex-direction: column; overflow: hidden;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4);
  }
  .raw-hd { display: flex; align-items: center; gap: 0.7rem; padding: 0.8rem 1rem; border-bottom: 1px solid var(--border, rgba(120, 110, 100, 0.25)); }
  .raw-stage { font-family: var(--font-mono); font-size: var(--fs-label-xs); font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: var(--accent); }
  .raw-title { font-size: 0.9rem; color: var(--text-secondary); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .raw-close { margin-left: auto; background: transparent; border: none; color: var(--text-muted); font-size: 1rem; cursor: pointer; }
  .raw-close:hover { color: var(--text-primary); }
  .raw-body {
    margin: 0; padding: 1rem 1.1rem; overflow: auto; white-space: pre-wrap; word-break: break-word;
    font-family: var(--font-mono); font-size: 0.82rem; line-height: 1.5; color: var(--text-secondary);
  }

  /* Detail bar (in expanded session) */
  .detail-bar { margin-bottom: 0.5rem; }
  .detail-btn {
    background: var(--accent); color: var(--bg); border: none; border-radius: 4px;
    padding: 0.35rem 0.7rem; font-size: 0.75rem; font-family: var(--font-mono);
    text-transform: uppercase; letter-spacing: 0.06em; cursor: pointer;
  }
  .detail-btn:hover { opacity: 0.9; }

  /* Detail modal */
  .detail-modal { width: min(1000px, 100%); }
  .detail-loading { padding: 2rem; text-align: center; color: var(--text-muted); }
  .detail-body { display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
  .cost-block { padding: 0.9rem 1.1rem; border-bottom: 1px solid var(--border, rgba(120, 110, 100, 0.25)); }
  .cost-hd { display: flex; justify-content: space-between; align-items: baseline; padding: 0.7rem 1.1rem 0.4rem; gap: 1rem; }
  .cost-scroll { overflow-x: auto; }
  .cost-table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
  .cost-table th {
    text-align: right; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase;
    letter-spacing: 0.08em; color: var(--text-ghost); padding: 0.3rem 0.5rem; font-weight: 500;
    border-bottom: 1px solid var(--border, rgba(120, 110, 100, 0.2));
  }
  .cost-table th:first-child, .cost-table td:first-child { text-align: left; }
  .cost-table td { text-align: right; padding: 0.35rem 0.5rem; color: var(--text-secondary); white-space: nowrap; }
  .cost-table .rate { color: var(--text-ghost); font-size: var(--fs-label-xs); margin-left: 0.25rem; }
  .cost-table .cost-val { font-family: var(--font-brand); color: var(--text-primary); }
  .cost-note { margin: 0.6rem 0 0; font-size: var(--fs-label-xs); color: var(--text-ghost); line-height: 1.4; }
  .transcript-body { flex: 1; min-height: 240px; }
</style>
