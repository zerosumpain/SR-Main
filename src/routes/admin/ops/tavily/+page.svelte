<script lang="ts">
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';

  let { data } = $props();

  const audit = $derived(data.audit);
  const account = $derived(data.account);
  const balancer = $derived(data.balancer);
  const providerRow = (p: 'tavily' | 'brave') => audit?.byProvider.find((r) => r.provider === p) ?? null;
  const PROVIDER_NAME = { tavily: 'Tavily', brave: 'Brave' } as const;

  /**
   * Plain-English names for the purposes the code writes. A purpose not listed
   * here still shows, by its raw label — a new caller is visible before anyone
   * describes it.
   */
  const PURPOSES: Record<string, string> = {
    'research.phase1': 'Deep research: first-pass searches',
    'research.phase2.source': 'Deep research: reading a source in full',
    'research.phase2.linkedin': 'Deep research: people look-ups',
    'research.phase3': 'Deep research: verification searches',
    'research.brief': 'Brief research run',
    'research.scan': 'Quick scan research run',
    'research.source-summary': 'Opening a source summary',
    'research.source-index': 'Indexing source text for search',
    'research.keep-in-drive': 'Keep in Drive',
    'tool.tavily_search': 'tavily_search tool (chat or a workflow agent; always Tavily)',
    'wishlist': 'Wishlist price sweep',
    'trips.guide': 'Trips: destination guide',
    'trips.pack': 'Trips: packing list',
    'workflow.tavily-search': 'Workflow web search node',
    'admin.key-test': 'Key test on /admin/ai/keys',
  };
  const describe = (purpose: string) => PURPOSES[purpose] ?? purpose;

  const fmt = (v: number) => (v ?? 0).toLocaleString('en-GB', { maximumFractionDigits: 1 });
  const when = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
      : '—';
  const share = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—');

  function href(params: { days?: number; purpose?: string | null; provider?: string | null }) {
    const q = new URLSearchParams();
    q.set('days', String(params.days ?? data.days));
    const p = params.purpose === undefined ? data.purpose : params.purpose;
    if (p) q.set('purpose', p);
    const pr = params.provider === undefined ? data.provider : params.provider;
    if (pr) q.set('provider', pr);
    return `?${q.toString()}`;
  }

  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const resetIn = (seconds: number | null, at: string | null) => {
    if (seconds === null || !at) return null;
    const ms = new Date(at).getTime() + seconds * 1000 - Date.now();
    if (ms <= 0) return 'reset since';
    const d = Math.floor(ms / 86_400_000);
    return d >= 1 ? `resets in ${d}d` : `resets in ${Math.ceil(ms / 3_600_000)}h`;
  };

  const purposeMax = $derived(Math.max(1, ...(audit?.byPurpose ?? []).map((p) => p.credits)));
  const dayPeak = $derived(Math.max(1, ...(audit?.perDay ?? []).map((d) => d.credits)));

  /**
   * Credits the account reports that the ledger never saw. Only meaningful once
   * the ledger has covered the whole of Tavily's period; before that the gap is
   * mostly "before recording began", and the note says so.
   */
  const gap = $derived(account && audit ? Math.max(0, account.used - audit.monthCredits) : null);
  const recordingThisMonth = $derived.by(() => {
    if (!audit?.recordingSince) return true;
    const start = new Date();
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    return new Date(audit.recordingSince) > start;
  });
</script>

<svelte:head><title>Web search usage — Admin</title></svelte:head>

<PageWrap width="wide">
  <PageHeader
    kicker="Ops"
    title="Web search usage"
    sub="Every search the site makes goes through the search balancer to Tavily or Brave. Which provider answered, which process asked, what it searched for, and when."
  />

  <div class="filter-row">
    <span class="tele-days">
      {#each [1, 7, 30, 90] as d (d)}
        <a class="day-pill" class:active={data.days === d} href={href({ days: d })} data-sveltekit-noscroll>{d}d</a>
      {/each}
      <span class="pill-gap"></span>
      {#each [null, 'tavily', 'brave'] as const as p (p ?? 'all')}
        <a class="day-pill" class:active={data.provider === p} href={href({ provider: p })} data-sveltekit-noscroll>{p ? PROVIDER_NAME[p] : 'Both'}</a>
      {/each}
    </span>
    <span class="host-note">
      {audit?.recordingSince
        ? `recording since ${new Date(audit.recordingSince).toLocaleDateString('en-GB')}`
        : 'nothing recorded yet'}
    </span>
  </div>

  <!-- The balancer: both providers side by side -->
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Search balancer</span>
      <span class="nm-sec-meta">by how much of each month is left</span>
    </div>
    <div class="nm-table-scroll">
      <table class="nm-table fit">
        <thead>
          <tr><th>Provider</th><th class="num">Left this month</th><th class="num">Share now</th><th class="num">This month</th><th class="num">Last {data.days}d</th><th class="num minor">Failed</th><th class="num minor">Retries</th><th class="when minor">Last</th></tr>
        </thead>
        <tbody>
          {#each ['tavily', 'brave'] as const as p (p)}
            {@const row = providerRow(p)}
            <tr>
              <td>
                <span class="proc-sm">{PROVIDER_NAME[p]}</span>
                <span class="proc-id mono">
                  {#if !balancer.configured[p]}
                    no key · <a href="/admin/ai/keys">add one</a>
                  {:else if balancer.restingUntil[p]}
                    <span class="warn">resting until {when(balancer.restingUntil[p])} · {balancer.restReason[p]}</span>
                  {:else if p === 'brave' && audit?.braveQuota}
                    {resetIn(audit.braveQuota.resetSeconds, audit.braveQuota.at) ?? 'allowance reported'} · {balancer.braveBurst.limit}/{balancer.braveBurst.windowSeconds}s burst
                  {:else if p === 'tavily' && account?.plan}
                    {account.plan} plan
                  {:else}
                    configured
                  {/if}
                </span>
              </td>
              <td class="num mono">
                {#if !balancer.configured[p]}—
                {:else if p === 'tavily'}
                  {account?.limit != null ? `${fmt(Math.max(0, account.limit - account.used))} / ${fmt(account.limit)}` : account ? 'no cap' : '—'}
                {:else if audit?.braveQuota?.limit != null}
                  {fmt(audit.braveQuota.remaining ?? 0)} / {fmt(audit.braveQuota.limit)}
                {:else}
                  <span title="Brave reports its allowance on each response; none recorded yet">not reported yet</span>
                {/if}
              </td>
              <td class="num mono">{balancer.configured[p] ? pct(balancer.share[p]) : '—'}</td>
              <td class="num mono">{fmt(row?.monthCalls ?? 0)}</td>
              <td class="num mono">{fmt(row?.calls ?? 0)}</td>
              <td class="num mono minor" class:warn={(row?.failed ?? 0) > 0}>{row?.failed || ''}</td>
              <td class="num mono minor">{row?.retries || ''}</td>
              <td class="when mono minor">{when(row?.lastAt ?? null)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <p class="empty-note small">
      "Share now" is the proportion of ordinary searches each provider is drawing at the moment. Searches that need a
      written answer or advanced depth, and queries too long for Brave, go to Tavily first; a search over Brave's burst
      limit goes to Tavily; a provider that fails hands the search to the other. Retries count those second attempts.
      Extraction is Tavily-only.
    </p>
  </section>

  <!-- Account against ledger -->
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Tavily monthly allowance</span>
      <span class="nm-sec-meta">{account?.plan ? `${account.plan} plan` : 'account'}</span>
    </div>
    <div class="stat-grid">
      <div class="stat">
        <span class="stat-v">{account ? `${fmt(account.used)}${account.limit ? ` / ${fmt(account.limit)}` : ''}` : '—'}</span>
        <span class="stat-l">used, per Tavily</span>
      </div>
      <div class="stat">
        <span class="stat-v">{audit ? fmt(audit.monthCredits) : '—'}</span>
        <span class="stat-l">Tavily, recorded here this month</span>
      </div>
      <div class="stat">
        <span class="stat-v" class:warn={gap !== null && gap > 0 && !recordingThisMonth}>{gap === null ? '—' : fmt(gap)}</span>
        <span class="stat-l">not recorded here</span>
      </div>
    </div>
    {#if !account}
      <p class="empty-note small">The account figure is unavailable: no Tavily key is configured here, or Tavily's usage endpoint did not answer.</p>
    {:else if recordingThisMonth}
      <p class="empty-note small">
        Recording began this month, so the part of the month before it is not recorded here, and that is most of the gap.
        From next month the gap shows spending by anything outside this site's code that holds the same key.
      </p>
    {:else}
      <p class="empty-note small">
        "Not recorded here" is spending by anything outside this site's code that holds the same key. Tavily's
        period may not start on the 1st, so a small gap near the start of a month is expected.
      </p>
    {/if}
  </section>

  {#if !audit}
    <section class="nm-sec"><p class="empty-note">Could not read the search ledger.</p></section>
  {:else if audit.totals.calls === 0}
    <section class="nm-sec">
      <p class="empty-note">No {data.provider ? PROVIDER_NAME[data.provider] : 'search'} requests recorded in the last {data.days} day{data.days === 1 ? '' : 's'}.</p>
    </section>
  {:else}
    <div class="stat-grid">
      <div class="stat"><span class="stat-v">{fmt(audit.totals.credits)}</span><span class="stat-l">credits, last {data.days}d</span></div>
      <div class="stat"><span class="stat-v">{fmt(audit.totals.searches)}</span><span class="stat-l">searches</span></div>
      <div class="stat"><span class="stat-v">{fmt(audit.totals.extracts)}</span><span class="stat-l">extracts</span></div>
      <div class="stat"><span class="stat-v" class:warn={audit.totals.failed > 0}>{fmt(audit.totals.failed)}</span><span class="stat-l">failed (not billed)</span></div>
    </div>

    <!-- By process -->
    <section class="nm-sec">
      <div class="nm-sec-hd"><span class="sr-label-tight">What is spending it</span><span class="nm-sec-meta">by process, last {data.days}d</span></div>
      <div class="nm-table-scroll">
        <table class="nm-table fit">
          <thead>
            <tr><th>Process</th><th class="bar-col">Credits</th><th class="num">Share</th><th class="num">Calls</th><th class="num minor">Failed</th><th class="when minor">Last</th></tr>
          </thead>
          <tbody>
            {#each audit.byPurpose as p (p.app + p.provider + p.purpose)}
              <tr>
                <td>
                  <a class="proc" href={href({ purpose: p.purpose })} data-sveltekit-noscroll>{describe(p.purpose)}</a>
                  <span class="proc-id mono">{p.app} · {PROVIDER_NAME[p.provider]} · {p.purpose}</span>
                </td>
                <td class="bar-col">
                  <span class="hbar-track"><span class="hbar-fill" style={`width:${Math.max(2, Math.round((p.credits / purposeMax) * 100))}%`}></span></span>
                  <span class="mono hbar-val">{fmt(p.credits)}</span>
                </td>
                <td class="num mono">{share(p.credits, audit.totals.credits)}</td>
                <td class="num mono" title={`${p.searches} searches, ${p.extracts} extracts`}>{fmt(p.calls)}</td>
                <td class="num mono minor" class:warn={p.failed > 0}>{p.failed || ''}</td>
                <td class="when mono minor">{when(p.lastAt)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>

    <div class="two-col">
      <!-- By trigger -->
      <section class="nm-sec">
        <div class="nm-sec-hd"><span class="sr-label-tight">On whose behalf</span><span class="nm-sec-meta">top 25</span></div>
        <div class="nm-table-scroll">
          <table class="nm-table fit">
            <thead><tr><th>Run, workflow or chat</th><th class="num">Credits</th><th class="num">Calls</th><th class="when minor">Last</th></tr></thead>
            <tbody>
              {#each audit.byTrigger as t (t.kind + (t.id ?? ''))}
                <tr>
                  <td class="trigger">{#if t.href}<a href={t.href}>{t.label}</a>{:else}{t.label}{/if}</td>
                  <td class="num mono">{fmt(t.credits)}</td>
                  <td class="num mono">{fmt(t.calls)}</td>
                  <td class="when mono minor">{when(t.lastAt)}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>

      <!-- Repeats -->
      <section class="nm-sec">
        <div class="nm-sec-hd"><span class="sr-label-tight">Searched more than once</span><span class="nm-sec-meta">same query text</span></div>
        {#if audit.repeats.length === 0}
          <p class="empty-note">No query was repeated in this window.</p>
        {:else}
          <div class="nm-table-scroll">
            <table class="nm-table fit">
              <thead><tr><th>Query</th><th class="num">Times</th><th class="num">Credits</th><th class="when minor">Last</th></tr></thead>
              <tbody>
                {#each audit.repeats as r (r.query)}
                  <tr>
                    <td class="query" title={`${r.query}\n${r.purposes.map(describe).join(', ')}`}>{r.query}</td>
                    <td class="num mono">{r.calls}</td>
                    <td class="num mono">{fmt(r.credits)}</td>
                    <td class="when mono minor">{when(r.lastAt)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </section>
    </div>

    <!-- Per day -->
    <section class="nm-sec">
      <div class="nm-sec-hd"><span class="sr-label-tight">Credits per day</span><span class="nm-sec-meta">UTC days</span></div>
      <div class="spark" role="img" aria-label="Search credits per day">
        {#each audit.perDay as d (d.day)}
          <div class="spark-col" title={`${d.day}: ${fmt(d.credits)} credits, ${d.calls} calls — mostly ${describe(d.top ?? 'unlabelled')}`}>
            <div class="spark-bar" style={`height:${Math.max(4, Math.round((d.credits / dayPeak) * 100))}%`}></div>
          </div>
        {/each}
      </div>
      <div class="spark-cap mono">{audit.perDay[0]?.day} → {audit.perDay[audit.perDay.length - 1]?.day}</div>
    </section>

    <!-- Recent -->
    <section class="nm-sec">
      <div class="nm-sec-hd">
        <span class="sr-label-tight">Requests</span>
        <span class="nm-sec-meta">
          {#if data.purpose}
            {describe(data.purpose)} · <a href={href({ purpose: null })} data-sveltekit-noscroll>show all</a>
          {:else}
            newest {audit.recent.length}
          {/if}
        </span>
      </div>
      {#if audit.recent.length === 0}
        <p class="empty-note">No requests for this process in the window.</p>
      {:else}
        <div class="nm-table-scroll">
          <table class="nm-table calls">
            <thead>
              <tr><th class="when">When</th><th>Process</th><th>Searched for</th><th>For</th><th class="num">Credits</th><th class="num">Results</th><th class="num">Time</th></tr>
            </thead>
            <tbody>
              {#each audit.recent as c (c.id)}
                <tr class:failed={!c.ok}>
                  <td class="when mono">{when(c.at)}</td>
                  <td>
                    <span class="proc-sm">{describe(c.purpose)}</span>
                    <span class="proc-id mono">{c.app} · {PROVIDER_NAME[c.provider]} · {c.kind}{c.depth === 'advanced' ? ' · advanced' : ''}{c.attempt > 1 ? ' · retry' : ''}</span>
                  </td>
                  <td class="query">
                    {#if c.query !== null}
                      <span title={c.query}>{c.query}</span>
                    {:else if c.urls.length}
                      <span class="mono url" title={c.urls.join('\n')}>{c.urls[0]}{c.urlCount > 1 ? ` +${c.urlCount - 1}` : ''}</span>
                    {:else}—{/if}
                    {#if !c.ok}<span class="err-msg" title={c.error ?? ''}>{c.error ?? 'failed'}</span>{/if}
                  </td>
                  <td class="trigger">{#if c.trigger.href}<a href={c.trigger.href}>{c.trigger.label}</a>{:else}{c.trigger.label}{/if}</td>
                  <td class="num mono">{c.credits}</td>
                  <td class="num mono">{c.resultCount ?? '—'}</td>
                  <td class="num mono">{c.durationMs === null ? '—' : `${(c.durationMs / 1000).toFixed(1)}s`}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
      <p class="empty-note small">
        Tavily credits use its published rates (search 1, advanced search 2, extract 1 per 5 URLs) at the time of the
        request, so they are an estimate. A Brave request counts 1, its plan's own unit. A failed request is not billed
        and counts 0.
      </p>
    </section>
  {/if}
</PageWrap>

<style>
  .filter-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.2rem; gap: 1rem; flex-wrap: wrap; }
  .tele-days { display: inline-flex; gap: 0.3rem; flex-wrap: wrap; }
  .pill-gap { width: 0.6rem; }
  .proc-id a { color: var(--accent-ink); }
  .day-pill { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.05em; padding: 0.2rem 0.55rem; border: 1px solid var(--card-border); border-radius: var(--radius-round); color: var(--text-secondary); text-decoration: none; }
  .day-pill.active { color: var(--bg); background: var(--accent); border-color: var(--accent); }
  .host-note { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); }

  .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 0.6rem; margin-bottom: 1.2rem; }
  .nm-sec .stat-grid { margin-bottom: 0.4rem; }
  .stat { display: flex; flex-direction: column; gap: 0.2rem; padding: 0.7rem 0.85rem; border: 1px solid var(--card-border); border-radius: var(--radius-round); background: var(--bg-section); }
  .stat-v { font-family: var(--font-mono); font-size: 1.2rem; color: var(--text-primary); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .stat-l { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }
  .warn { color: var(--warn); }

  .nm-sec { border: 1px solid var(--card-border); border-radius: var(--radius-round); padding: 0.9rem 1rem 1rem; margin-bottom: 1.2rem; background: var(--bg); min-width: 0; }
  .nm-sec-hd { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 0.8rem; gap: 0.8rem; }
  .nm-sec-meta { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); }
  .nm-sec-meta a { color: var(--accent-ink); }
  .two-col { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr)); gap: 0 1.2rem; }

  .nm-table .num { text-align: right; white-space: nowrap; }
  .nm-table .when { white-space: nowrap; color: var(--text-ghost); }
  .proc { color: var(--text-primary); text-decoration: none; display: block; }
  .proc:hover { color: var(--accent-ink); text-decoration: underline; }
  .proc-sm { display: block; color: var(--text-primary); white-space: nowrap; }
  .proc-id { display: block; font-size: var(--fs-label-xs); color: var(--text-ghost); white-space: nowrap; }
  .trigger { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .trigger a { color: var(--accent-ink); }
  .query { max-width: 360px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-primary); }
  .query .url { font-size: var(--fs-label-xs); }
  .err-msg { display: block; font-size: var(--fs-label-xs); color: var(--error); overflow: hidden; text-overflow: ellipsis; }
  tr.failed td { opacity: 0.75; }

  .bar-col { min-width: 160px; white-space: nowrap; }
  .hbar-track { display: inline-block; vertical-align: middle; width: calc(100% - 3.2rem); height: 12px; background: var(--bg-section); border-radius: 2px; overflow: hidden; }
  .hbar-fill { display: block; height: 100%; background: var(--accent); border-radius: 0 2px 2px 0; }
  .hbar-val { display: inline-block; width: 2.8rem; text-align: right; font-size: var(--fs-label-xs); color: var(--text-primary); }

  .spark { display: flex; align-items: flex-end; gap: 2px; height: 70px; }
  .spark-col { flex: 1; height: 100%; display: flex; align-items: flex-end; min-width: 3px; }
  .spark-bar { width: 100%; background: var(--accent); border-radius: 2px 2px 0 0; opacity: 0.85; }
  .spark-cap { font-size: var(--fs-label-xs); color: var(--text-ghost); margin-top: 0.4rem; }

  .empty-note { font-size: var(--fs-label); color: var(--text-muted); margin: 0.2rem 0 0.8rem; }
  .empty-note.small { font-size: var(--fs-label-xs); margin: 0.6rem 0 0; }
  .mono { font-family: var(--font-mono); }

  /* Phone: the credit figure is the point of every table, so the names wrap
     and the secondary columns go rather than pushing it off-screen. */
  @media (max-width: 640px) {
    .proc-id, .proc-sm { white-space: normal; overflow-wrap: anywhere; }
    .minor { display: none; }
    /* admin.css sizes tables to max-content so they scroll; the summaries should fit instead. */
    .nm-table.fit { min-width: 0; }
    .nm-table.fit th, .nm-table.fit td { padding-left: 6px; padding-right: 6px; }
    .bar-col { min-width: 0; }
    .hbar-track { display: none; }
    .trigger, .query { max-width: 150px; }
  }
</style>
