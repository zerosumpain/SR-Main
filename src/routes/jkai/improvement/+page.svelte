<svelte:head><title>Self-Improvement — JKAI</title></svelte:head>
<script lang="ts">
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  type Run = PageData['runs'][number];
  type Attempt = PageData['attempts'][number];

  let expandedRun = $state<string | null>(null);
  let expandedAttempt = $state<string | null>(null);
  let attemptFilter = $state<'all' | 'created' | 'rejected'>('all');

  const stats = $derived(data.stats);
  const insights = $derived(data.insights);

  const visibleAttempts = $derived(
    attemptFilter === 'all'
      ? data.attempts
      : data.attempts.filter((a: Attempt) => a.data.status === attemptFilter),
  );

  function toggleRun(id: string) {
    expandedRun = expandedRun === id ? null : id;
  }
  function toggleAttempt(id: string) {
    expandedAttempt = expandedAttempt === id ? null : id;
  }

  function fmtDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleString('en-GB', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  }
  function fmtMs(ms: number | undefined): string {
    if (!ms) return '—';
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
  }
  function fmtCost(n: number): string {
    return `$${(n ?? 0).toFixed(n < 1 ? 4 : 2)}`;
  }

  // Action-kind chips shown in the breakdown, in a sensible reading order.
  const KIND_LABELS: Record<string, string> = {
    insight: 'insights',
    api_registered: 'APIs registered',
    api_verified: 'APIs verified',
    tool_created: 'tools built',
    tool_rejected: 'tools rejected',
    proposal: 'proposals',
  };
  const kindOrder = ['insight', 'api_verified', 'api_registered', 'tool_created', 'tool_rejected', 'proposal'];
</script>

<div class="wrap">
  <header class="page-hdr">
    <div>
      <div class="kicker">JKAI · Self-Improvement</div>
      <h1>The Ledger</h1>
      <p class="sub">
        What the nightly engine <strong>learned</strong>, the APIs it <strong>found</strong>, and every tool
        it <strong>tried to build</strong> — including the ones it rejected, with their code and the reason.
      </p>
    </div>
    <div class="hdr-links">
      <a class="back-link" href="/jkai">← JKAI</a>
      <a class="back-link" href="/admin/ai/improvement">Controls →</a>
    </div>
  </header>

  <!-- ── Summary statistics ─────────────────────────────────────────────── -->
  <section class="stats">
    <div class="stat-tile">
      <div class="stat-num">{stats.totalRuns}</div>
      <div class="stat-label">runs logged</div>
      <div class="stat-sub">{stats.lastRunAt ? `last ${fmtDate(stats.lastRunAt)}` : 'none yet'}</div>
    </div>
    <div class="stat-tile">
      <div class="stat-num">
        {stats.toolSuccessRate === null ? '—' : `${stats.toolSuccessRate}%`}
      </div>
      <div class="stat-label">tool build success</div>
      <div class="stat-sub">{stats.toolsCreated} built · {stats.toolsRejected} rejected</div>
    </div>
    <div class="stat-tile">
      <div class="stat-num">{stats.apisTotal}</div>
      <div class="stat-label">APIs catalogued</div>
      <div class="stat-sub">{stats.apisAddedByEngine} added by engine</div>
    </div>
    <div class="stat-tile">
      <div class="stat-num">{fmtCost(stats.totalCostUsd)}</div>
      <div class="stat-label">total spend</div>
      <div class="stat-sub">{fmtCost(stats.avgCostUsd)}/run · {stats.totalLlmCalls} calls</div>
    </div>
    <div class="stat-tile">
      <div class="stat-num">{stats.insightsLogged}</div>
      <div class="stat-label">insights</div>
      <div class="stat-sub">{stats.proposals} proposals</div>
    </div>
    <div class="stat-tile schedule">
      <div class="stat-num sched-time">{data.schedule.display.split(' ')[0]}</div>
      <div class="stat-label">nightly schedule</div>
      <div class="stat-sub">
        {#if data.running}<span class="live-dot"></span> running now{:else}Europe/London{/if}
      </div>
    </div>
  </section>

  <!-- Action-kind breakdown -->
  <section class="breakdown">
    <div class="sr-label-tight">Activity breakdown (across {stats.totalRuns} run{stats.totalRuns === 1 ? '' : 's'})</div>
    <div class="chips">
      {#each kindOrder as k}
        <span class="chip" class:zero={(stats.actionKindCounts[k] ?? 0) === 0}>
          <span class="chip-num">{stats.actionKindCounts[k] ?? 0}</span>
          <span class="chip-label">{KIND_LABELS[k]}</span>
        </span>
      {/each}
    </div>
  </section>

  <!-- ── Runs ───────────────────────────────────────────────────────────── -->
  <section class="block">
    <div class="block-hd">
      <span class="sr-label-tight">Runs</span>
      <span class="block-meta">{data.runs.length} shown</span>
    </div>
    {#if data.runs.length === 0}
      <div class="empty">No runs yet — the first nightly run is at {data.schedule.display}, or trigger one from Controls.</div>
    {:else}
      <div class="rows">
        {#each data.runs as run (run.runId)}
          <div class="row">
            <button class="row-head" onclick={() => toggleRun(run.runId)} aria-expanded={expandedRun === run.runId}>
              <span class="status-pill s-{run.data.status}">{run.data.status.replace(/_/g, ' ')}</span>
              <span class="row-title">{fmtDate(run.createdAt)}</span>
              <span class="row-tags mono">
                <span>{run.data.trigger}</span>
                <span>{run.data.actions?.length ?? 0} actions</span>
                <span>{fmtCost(run.data.costUsd ?? 0)}</span>
              </span>
              <span class="chevron">{expandedRun === run.runId ? '▾' : '▸'}</span>
            </button>
            {#if expandedRun === run.runId}
              <div class="row-body">
                <div class="phases">
                  {#each Object.entries(run.data.phases ?? {}) as [name, p]}
                    <span class="phase p-{p.status}" title={p.detail ?? ''}>
                      {name} · {p.status}{#if p.ms} · {fmtMs(p.ms)}{/if}
                    </span>
                  {/each}
                </div>
                {#if (run.data.actions?.length ?? 0) === 0}
                  <div class="empty compact">No actions recorded.</div>
                {:else}
                  <ul class="actions">
                    {#each run.data.actions ?? [] as a}
                      <li><span class="action-kind ak-{a.kind}">{a.kind}</span><span class="action-detail">{a.detail}</span></li>
                    {/each}
                  </ul>
                {/if}
                {#if run.data.report}
                  <div class="report-label">Report</div>
                  <pre class="report">{run.data.report}</pre>
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <!-- ── Tool attempts ──────────────────────────────────────────────────── -->
  <section class="block">
    <div class="block-hd">
      <span class="sr-label-tight">Tool build attempts</span>
      <div class="seg" role="group" aria-label="Filter attempts">
        {#each ['all', 'created', 'rejected'] as f}
          <button type="button" class="seg-btn" class:on={attemptFilter === f}
            aria-pressed={attemptFilter === f} onclick={() => (attemptFilter = f as typeof attemptFilter)}>{f}</button>
        {/each}
      </div>
    </div>
    {#if visibleAttempts.length === 0}
      <div class="empty">
        {data.attempts.length === 0
          ? 'No tool build attempts yet. When the engine tries to author a tool, both successes and rejections land here with their code.'
          : `No ${attemptFilter} attempts.`}
      </div>
    {:else}
      <div class="rows">
        {#each visibleAttempts as att (att.key)}
          <div class="row">
            <button class="row-head" onclick={() => toggleAttempt(att.key)} aria-expanded={expandedAttempt === att.key}>
              <span class="status-pill s-{att.data.status === 'created' ? 'complete' : 'failed'}">{att.data.status}</span>
              <span class="row-title mono">{att.data.name}</span>
              <span class="row-tags"><span class="att-desc">{att.data.description}</span></span>
              <span class="chevron">{expandedAttempt === att.key ? '▾' : '▸'}</span>
            </button>
            {#if expandedAttempt === att.key}
              <div class="row-body">
                <div class="att-meta mono">
                  <span>toolset: {att.data.toolset}</span>
                  <span>{fmtDate(att.data.attemptedAt)}</span>
                </div>
                {#if att.data.status === 'rejected' && att.data.reason}
                  <div class="reject-reason"><span class="rr-label">Rejected:</span> {att.data.reason}</div>
                {/if}
                <div class="code-label">Generated handler</div>
                <pre class="code"><code>{att.data.handlerCode}</code></pre>
                <div class="code-label">Sample args (smoke test)</div>
                <pre class="code small"><code>{JSON.stringify(att.data.sampleArgs, null, 2)}</code></pre>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <!-- ── Question insights ──────────────────────────────────────────────── -->
  <section class="block">
    <div class="block-hd">
      <span class="sr-label-tight">Latest question insights</span>
      {#if insights?.period}<span class="block-meta">{insights.period}</span>{/if}
    </div>
    {#if !insights || ((insights.intents?.length ?? 0) === 0 && (insights.topUnmet?.length ?? 0) === 0)}
      <div class="empty">No insights yet — they’re learned on the first run.</div>
    {:else}
      {#if insights.summary}<p class="ins-summary">{insights.summary}</p>{/if}
      {#if (insights.intents?.length ?? 0) > 0}
        <table class="intents">
          <thead><tr><th>Intent</th><th class="num">Count</th><th>Served</th><th>Missing capability</th></tr></thead>
          <tbody>
            {#each insights.intents as it}
              <tr>
                <td>{it.intent}</td>
                <td class="num mono">{it.count}</td>
                <td>{it.servedWell === false ? '⚠︎ gap' : it.servedWell ? 'yes' : '—'}</td>
                <td class="muted">{it.missingCapability ?? ''}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
      {#if (insights.topUnmet?.length ?? 0) > 0}
        <div class="unmet-label">Top unmet needs</div>
        <ul class="unmet">{#each insights.topUnmet as u}<li>{u}</li>{/each}</ul>
      {/if}
    {/if}
  </section>
</div>

<style>
  .wrap { max-width: 980px; margin: 2rem auto 4rem; padding: 0 1.5rem; color: var(--text-primary); font-family: var(--font-body); }
  .page-hdr { display: flex; justify-content: space-between; align-items: flex-end; gap: 1.5rem; margin-bottom: 1.75rem; padding-bottom: 1rem; border-bottom: 2px solid var(--text-primary); }
  .kicker { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.18em; color: var(--accent); margin-bottom: 0.35rem; }
  .page-hdr h1 { margin: 0; font-family: var(--font-display); font-size: 2.2rem; font-weight: 900; line-height: 1.05; }
  .sub { margin: 0.6rem 0 0; font-size: 0.95rem; line-height: 1.5; color: var(--text-secondary); max-width: 64ch; }
  .sub strong { color: var(--text-primary); font-weight: 700; }
  .hdr-links { display: flex; flex-direction: column; gap: 0.4rem; align-items: flex-end; flex-shrink: 0; }
  .back-link { font-family: var(--font-mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--accent); text-decoration: none; white-space: nowrap; }
  .back-link:hover { text-decoration: underline; }
  .mono { font-family: var(--font-mono); }

  /* Stat tiles */
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 0.6rem; margin-bottom: 1.25rem; }
  .stat-tile { border: 1px solid var(--card-border); padding: 0.85rem 0.95rem; background: var(--bg-section); }
  .stat-num { font-family: var(--font-display); font-size: 1.9rem; font-weight: 900; line-height: 1; color: var(--text-primary); }
  .stat-num.sched-time { font-size: 1.5rem; }
  .stat-label { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-muted); margin-top: 0.4rem; }
  .stat-sub { font-family: var(--font-mono); font-size: 10px; color: var(--text-ghost); margin-top: 0.25rem; }
  .live-dot { display: inline-block; width: 7px; height: 7px; border-radius: 100px; background: var(--accent); animation: pulse 1.4s ease-in-out infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }

  /* Breakdown chips */
  .breakdown { margin-bottom: 2rem; }
  .chips { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.6rem; }
  .chip { display: inline-flex; align-items: baseline; gap: 0.4rem; border: 1px solid var(--card-border); padding: 0.3rem 0.6rem; background: var(--bg-section); }
  .chip.zero { opacity: 0.45; }
  .chip-num { font-family: var(--font-display); font-weight: 900; font-size: 0.95rem; }
  .chip-label { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); }

  .sr-label-tight { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.16em; color: var(--text-muted); }

  .block { margin-bottom: 2rem; }
  .block-hd { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; }
  .block-meta { font-family: var(--font-mono); font-size: 10px; color: var(--text-ghost); }
  .empty { padding: 1.5rem; text-align: center; font-family: var(--font-mono); font-size: 11px; color: var(--text-ghost); font-style: italic; border: 1px dashed var(--card-border); line-height: 1.5; }
  .empty.compact { padding: 0.75rem; }

  .rows { display: flex; flex-direction: column; gap: 0.4rem; }
  .row { border: 1px solid var(--card-border); background: var(--bg-section); }
  .row-head { display: flex; align-items: center; gap: 0.75rem; width: 100%; padding: 0.65rem 0.85rem; background: none; border: none; cursor: pointer; text-align: left; color: inherit; font: inherit; }
  .row-head:hover { background: var(--card-bg); }
  .row-title { font-weight: 700; font-size: 0.9rem; }
  .row-tags { margin-left: auto; display: flex; gap: 0.85rem; font-size: 11px; color: var(--text-muted); align-items: center; }
  .att-desc { max-width: 42ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chevron { color: var(--text-ghost); font-size: 0.8rem; }

  .status-pill { font-family: var(--font-mono); font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; padding: 0.15rem 0.4rem; border: 1px solid var(--card-border); white-space: nowrap; }
  .s-complete { color: var(--accent); border-color: var(--accent); }
  .s-partial, .s-budget_exceeded { color: #b0821f; border-color: #b0821f; }
  .s-failed, .s-aborted_user_active { color: #b3452f; border-color: #b3452f; }
  .s-running { color: var(--text-secondary); }

  .row-body { padding: 0 0.85rem 0.85rem; border-top: 1px solid var(--card-border); }
  .phases { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 0.75rem 0; }
  .phase { font-family: var(--font-mono); font-size: 10px; padding: 0.2rem 0.45rem; border: 1px solid var(--card-border); color: var(--text-muted); }
  .p-ok { color: var(--accent); }
  .p-failed { color: #b3452f; }
  .p-skipped { opacity: 0.55; }

  .actions { list-style: none; margin: 0.5rem 0 0; padding: 0; display: flex; flex-direction: column; gap: 0.35rem; }
  .actions li { display: flex; gap: 0.6rem; align-items: baseline; font-size: 0.85rem; }
  .action-kind { font-family: var(--font-mono); font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em; padding: 0.1rem 0.35rem; border: 1px solid var(--card-border); color: var(--text-muted); flex-shrink: 0; min-width: 92px; text-align: center; }
  .ak-tool_created { color: var(--accent); border-color: var(--accent); }
  .ak-tool_rejected { color: #b3452f; border-color: #b3452f; }
  .ak-api_verified, .ak-api_registered { color: #2f7fb3; border-color: #2f7fb3; }
  .action-detail { color: var(--text-secondary); }

  .report-label, .code-label, .unmet-label { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-muted); margin: 0.9rem 0 0.35rem; }
  .report { margin: 0; padding: 0.75rem; background: var(--card-bg); border: 1px solid var(--card-border); font-family: var(--font-body); font-size: 0.85rem; white-space: pre-wrap; line-height: 1.5; color: var(--text-secondary); }
  .att-meta { display: flex; gap: 1rem; font-size: 10px; color: var(--text-ghost); margin: 0.75rem 0 0; }
  .reject-reason { margin: 0.6rem 0; padding: 0.55rem 0.7rem; border-left: 2px solid #b3452f; background: var(--card-bg); font-size: 0.85rem; color: var(--text-secondary); }
  .rr-label { font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #b3452f; }
  .code { margin: 0; padding: 0.75rem; background: var(--card-bg); border: 1px solid var(--card-border); overflow-x: auto; font-family: var(--font-mono); font-size: 12px; line-height: 1.5; color: var(--text-primary); }
  .code.small { font-size: 11px; }
  .code code { font: inherit; }

  .seg { display: inline-flex; border: 1px solid var(--card-border); }
  .seg-btn { background: none; border: none; padding: 0.25rem 0.6rem; font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); cursor: pointer; }
  .seg-btn.on { background: var(--accent); color: var(--bg); }

  .ins-summary { font-size: 0.9rem; line-height: 1.55; color: var(--text-secondary); margin: 0 0 0.9rem; }
  .intents { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  .intents th { text-align: left; font-family: var(--font-mono); font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); padding: 0.35rem 0.5rem; border-bottom: 1px solid var(--card-border); }
  .intents td { padding: 0.4rem 0.5rem; border-bottom: 1px solid var(--card-border); color: var(--text-secondary); }
  .intents .num { text-align: right; }
  .intents .muted { color: var(--text-ghost); }
  .unmet { margin: 0.4rem 0 0; padding-left: 1.1rem; font-size: 0.85rem; color: var(--text-secondary); line-height: 1.6; }

  @media (max-width: 640px) {
    .row-tags { display: none; }
    .page-hdr { flex-direction: column; align-items: flex-start; }
    .hdr-links { flex-direction: row; align-items: flex-start; }
  }
</style>
