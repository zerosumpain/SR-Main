<script lang="ts">
  import type { ImprovementDashboardData } from '$lib/dashboard/improvement.server';

  let { data, embedded = false }: { data: ImprovementDashboardData; embedded?: boolean } = $props();

  type Run = ImprovementDashboardData['runs'][number];
  type Attempt = ImprovementDashboardData['attempts'][number];

  let expandedRun = $state<string | null>(null);
  let expandedAttempt = $state<string | null>(null);
  let attemptFilter = $state<'all' | 'created' | 'rejected'>('all');

  // ── Plain-English narrative ───────────────────────────────────────────────
  // `changes` leads because it answers the question the page is for: what is
  // different now, and why. Queued ideas are real but they are intentions, not
  // changes, and there are usually many more of them.
  type StoryFilter = 'changes' | 'queued' | 'all';
  let storyFilter = $state<StoryFilter>('changes');
  let showTech = $state(false);

  const stories = $derived(data.stories ?? []);
  const storySummary = $derived(data.storySummary);
  const changeStories = $derived(stories.filter((s) => s.status !== 'queued'));
  const queuedStories = $derived(stories.filter((s) => s.status === 'queued'));
  const visibleStories = $derived(
    storyFilter === 'changes' ? changeStories : storyFilter === 'queued' ? queuedStories : stories,
  );
  // Ideas that a shipped tool appears to cover already. Surfaced on the default
  // view rather than left behind the "queued" filter, because it is a finding
  // about the ENGINE — it is not closing these out, so it may rebuild them.
  const staleQueued = $derived(queuedStories.filter((s) => s.note).length);

  /** Why a driver can be trusted — shown, never hidden. */
  const CONFIDENCE_NOTE: Record<string, string> = {
    recorded: 'The engine recorded this reason when it did the work.',
    inferred:
      'Matched to the week’s unmet needs after the fact — the engine did not record the link itself.',
    unknown: 'No reason was recorded and none could be matched.',
  };

  const stats = $derived(data.stats);
  const insights = $derived(data.insights);

  // ── Prime outcome: tool calls per answered question ──────────────────────
  const eff = $derived(data.efficiency?.latest ?? null);
  const history = $derived(data.efficiency?.history ?? []);
  const activePolicy = $derived(data.activePolicy);

  let measuring = $state(false);
  let measureError = $state<string | null>(null);
  let reverting = $state<number | null>(null);

  async function measureNow() {
    measuring = true;
    measureError = null;
    try {
      const res = await fetch('/api/admin/improvement/efficiency', { method: 'POST' });
      if (!res.ok) {
        measureError = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'measurement failed';
      } else {
        location.reload();
      }
    } catch {
      measureError = 'measurement failed';
    } finally {
      measuring = false;
    }
  }

  async function revertTo(version: number) {
    if (!confirm(`Roll the tool-call policy back to v${version}${version === 0 ? ' (no overlay at all)' : ''}?`)) return;
    reverting = version;
    try {
      const res = await fetch('/api/admin/improvement/policy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version }),
      });
      if (res.ok) location.reload();
    } finally {
      reverting = null;
    }
  }

  /** Sparkline path over the persisted daily means. */
  function sparkPath(points: Array<{ meanCalls: number }>, w = 220, h = 34): string {
    if (points.length < 2) return '';
    const vals = points.map((p) => p.meanCalls);
    const max = Math.max(...vals, 1);
    const min = Math.min(...vals, 0);
    const span = max - min || 1;
    return vals
      .map((v, i) => {
        const x = (i / (vals.length - 1)) * w;
        const y = h - ((v - min) / span) * h;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }

  function trialLabel(p: NonNullable<typeof activePolicy>): string {
    if (!p.trial) return 'no trial';
    if (p.trial.status === 'running') return `on trial · ${p.trial.turnsObserved}/30 turns`;
    return p.trial.status;
  }

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
  /** "30 Jul" — the story arc wants a date, not a timestamp. */
  function fmtDay(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? '—'
      : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
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

<svelte:head><title>{embedded ? 'Daydreams — JKAI' : 'Self-Improvement — JKAI'}</title></svelte:head>

<div class="wrap" class:embedded>
  {#if !embedded}<header class="page-hdr">
    <div>
      <div class="kicker">JKAI · Self-Improvement</div>
      <h1>The Ledger</h1>
      <p class="sub">
        Every change the nightly engine has made to itself, in plain English: what
        <strong>drove</strong> it, what it <strong>did</strong> about it, and what
        <strong>came of it</strong>. The raw runs, rejected code and phase timings are still here,
        under Technical detail.
      </p>
    </div>
    <div class="hdr-links">
      <a class="back-link" href="/jkai">JKAI</a>
      <a class="back-link" href="/admin/ai/improvement">Controls →</a>
    </div>
  </header>{/if}

  <!-- ── PRIME OUTCOME ──────────────────────────────────────────────────
       Leads the page: every other number here is a means to this end. -->
  <section class="prime">
    <div class="prime-hd">
      <div>
        <div class="sr-label-tight">Prime outcome · tool calls per answered question</div>
        <p class="prime-sub">
          Fewer calls per answer is the metric the engine is graded on. The headline is
          <strong>ordinary chat turns</strong>; agentic work (browser, terminal, delegation) is tracked
          beside it but never optimised against — its step count belongs to the task.
        </p>
      </div>
      <button class="measure-btn" onclick={measureNow} disabled={measuring}>
        {measuring ? 'Measuring…' : 'Measure now'}
      </button>
    </div>

    {#if measureError}
      <div class="empty err">{measureError}</div>
    {/if}

    {#if !eff}
      <div class="empty">
        Not measured yet — run the nightly engine or press <strong>Measure now</strong>.
      </div>
    {:else}
      <div class="prime-grid">
        <div class="stat-tile prime-tile">
          <div class="stat-num">{eff.chat.meanCalls}</div>
          <div class="stat-label">calls / chat turn</div>
          <div class="stat-sub">
            median {eff.chat.medianCalls} · p90 {eff.chat.p90Calls} · {eff.chat.turns} turns
          </div>
        </div>
        <div class="stat-tile prime-tile">
          <div class="stat-num">{eff.chat.repeatCalls}</div>
          <div class="stat-label">repeat calls</div>
          <div class="stat-sub">
            same tool twice in one turn · {eff.chat.duplicateCalls} byte-identical
          </div>
        </div>
        <div class="stat-tile prime-tile muted">
          <div class="stat-num">{eff.agentic.meanCalls}</div>
          <div class="stat-label">calls / agentic turn</div>
          <div class="stat-sub">{eff.agentic.turns} turns · tracked, not optimised</div>
        </div>
        <div class="stat-tile prime-tile muted">
          <div class="stat-num">{eff.discoveryCalls}</div>
          <div class="stat-label">discovery calls</div>
          <div class="stat-sub">jkai_extended list/schema round-trips</div>
        </div>
      </div>

      {#if history.length >= 2}
        <div class="spark-row">
          <svg class="spark" viewBox="0 0 220 34" preserveAspectRatio="none" aria-hidden="true">
            <path d={sparkPath(history)} fill="none" stroke="var(--accent)" stroke-width="1.5" />
          </svg>
          <span class="spark-meta mono">
            {history[0].day} → {history[history.length - 1].day} ·
            {history[0].meanCalls} → {history[history.length - 1].meanCalls} calls/turn
          </span>
        </div>
      {/if}

      {#if eff.patterns?.length}
        <div class="patterns">
          <div class="sr-label-tight">Biggest repeat patterns (chat turns) — the engine's work list</div>
          <div class="rows tight">
            {#each eff.patterns.slice(0, 6) as pat (pat.tool)}
              <div class="pat-row">
                <span class="pat-tool mono">{pat.tool}</span>
                <span class="pat-bar" style="--w:{Math.min(100, (pat.repeatCalls / (eff.patterns[0].repeatCalls || 1)) * 100)}%"></span>
                <span class="pat-num mono">
                  {pat.repeatCalls} wasted · {pat.turns} turn{pat.turns === 1 ? '' : 's'} · worst {pat.worstInOneTurn}×
                </span>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    {/if}
  </section>

  <!-- ── WHAT CHANGED AND WHY ────────────────────────────────────────────
       The lead. One card per improvement, each answering the same three
       questions in the same order, so the page can be read top to bottom
       without knowing what a "phase" or an "overlay" is. -->
  <section class="block stories-block">
    <div class="block-hd">
      <span class="sr-label-tight">What changed and why</span>
      <div class="seg" role="group" aria-label="Filter improvements">
        <button type="button" class="seg-btn" class:on={storyFilter === 'changes'}
          aria-pressed={storyFilter === 'changes'} onclick={() => (storyFilter = 'changes')}>
          changes ({changeStories.length})
        </button>
        <button type="button" class="seg-btn" class:on={storyFilter === 'queued'}
          aria-pressed={storyFilter === 'queued'} onclick={() => (storyFilter = 'queued')}>
          queued ({queuedStories.length})
        </button>
        <button type="button" class="seg-btn" class:on={storyFilter === 'all'}
          aria-pressed={storyFilter === 'all'} onclick={() => (storyFilter = 'all')}>
          all ({stories.length})
        </button>
      </div>
    </div>

    {#if storySummary && stories.length > 0}
      <p class="stories-lede">
        <strong>{storySummary.live}</strong> new {storySummary.live === 1 ? 'capability' : 'capabilities'} live ·
        <strong>{storySummary.fixed}</strong> repaired ·
        <strong>{storySummary.onTrial}</strong> on trial ·
        <strong>{storySummary.queued}</strong> queued ·
        <strong>{storySummary.rejected}</strong> tried and dropped
      </p>
    {/if}

    {#if staleQueued > 0}
      <p class="stale-warn">
        <strong>{staleQueued}</strong> queued {staleQueued === 1 ? 'idea looks' : 'ideas look'} already
        served by a tool that has shipped, but {staleQueued === 1 ? 'it is' : 'they are'} still marked
        open — so the engine may build the same thing twice.
        <button type="button" class="link-btn" onclick={() => (storyFilter = 'queued')}>Show them</button>
      </p>
    {/if}

    {#if visibleStories.length === 0}
      <div class="empty">
        {stories.length === 0
          ? 'Nothing yet. After the first nightly run this is where each improvement is explained.'
          : storyFilter === 'changes'
            ? 'Nothing has changed yet — only queued ideas so far.'
            : 'No queued ideas.'}
      </div>
    {:else}
      <div class="story-grid">
        {#each visibleStories as s (s.id)}
          <article class="story st-{s.status}">
            <header class="story-hd">
              <div class="story-id">
                <span class="story-title mono">{s.title}</span>
                {#if s.subtitle}<span class="story-sub">{s.subtitle}</span>{/if}
              </div>
              <span class="story-pill">{s.statusLabel}</span>
            </header>

            <dl class="story-body">
              <dt>Driver</dt>
              <dd>
                <p>{s.driver}</p>
                {#if s.driverEvidence}
                  <p class="evidence mono">{s.driverEvidence}</p>
                {/if}
                {#if s.driverQuotes?.length}
                  <ul class="quotes">
                    {#each s.driverQuotes as q}<li>“{q}”</li>{/each}
                  </ul>
                {/if}
                <span class="conf conf-{s.linkConfidence}" title={CONFIDENCE_NOTE[s.linkConfidence]}>
                  {s.linkConfidence}
                </span>
              </dd>

              <dt>Solution</dt>
              <dd><p>{s.solution}</p></dd>

              <dt>Outcome</dt>
              <dd>
                <p>{s.outcome}</p>
                <span class="okind ok-{s.outcomeKind}">
                  {s.outcomeKind === 'measured'
                    ? 'measured'
                    : s.outcomeKind === 'expected'
                      ? 'expected — not yet proven'
                      : 'too early to tell'}
                </span>
              </dd>
            </dl>

            {#if s.note}
              <p class="story-note">{s.note}</p>
            {/if}

            <footer class="story-arc mono">
              {#each s.events as e, i}
                {#if i > 0}<span class="arc-sep">→</span>{/if}
                <span class="arc-step">{fmtDay(e.at)} {e.label}</span>
              {/each}
            </footer>
          </article>
        {/each}
      </div>
    {/if}
  </section>

  <!-- ── Technical detail ─────────────────────────────────────────────────
       Everything below is the raw audit trail. Collapsed by default: it is
       still the truth of record, but it is not how you find out what changed. -->
  <button class="tech-toggle" onclick={() => (showTech = !showTech)} aria-expanded={showTech}>
    <span class="chevron">{showTech ? '▾' : '▸'}</span>
    <span class="sr-label-tight">Technical detail</span>
    <span class="tech-meta mono">runs, phases, generated code, policy versions, raw insights</span>
  </button>

  {#if showTech}
  <!-- ── Tool-call policy: the non-destructive lever + its history ───────── -->
  <section class="block">
    <div class="block-hd">
      <span class="sr-label-tight">Tool-call policy</span>
      <span class="block-meta">
        {activePolicy ? `v${activePolicy.version} live` : 'no overlay'} · {data.policyVersions.length} version{data.policyVersions.length === 1 ? '' : 's'}
      </span>
    </div>
    <p class="policy-note">
      Description overlays the engine publishes to make tools cheaper to call. These are
      <strong>data, not code</strong> — no deploy to apply, no revert to undo. Each change goes live on
      trial against the baseline above and rolls itself back if it doesn't beat it.
    </p>
    {#if data.policyVersions.length === 0}
      <div class="empty">No policy versions yet — the base tool descriptions are in force.</div>
    {:else}
      <div class="rows">
        {#each data.policyVersions as v (v.version)}
          <div class="row policy-row" class:live={activePolicy?.version === v.version}>
            <div class="policy-head">
              <span class="ver mono">v{v.version}</span>
              <span class="status-pill s-{v.trial?.status ?? 'none'}">{trialLabel(v)}</span>
              <span class="row-title">{v.targetTool ?? '—'}</span>
              <span class="row-tags mono">
                <span>{fmtDate(v.createdAt)}</span>
                <span>{v.createdBy}</span>
              </span>
              {#if activePolicy?.version !== v.version}
                <button class="revert-btn" onclick={() => revertTo(v.version)} disabled={reverting === v.version}>
                  {reverting === v.version ? '…' : 'Revert to this'}
                </button>
              {:else}
                <span class="live-tag mono">LIVE</span>
              {/if}
            </div>
            <div class="policy-body">
              <div class="rationale">{v.rationale}</div>
              {#if v.trial?.verdict}<div class="verdict mono">{v.trial.verdict}</div>{/if}
              {#each Object.entries(v.overrides) as [tool, o] (tool)}
                <div class="ovr">
                  <span class="ovr-tool mono">{tool}</span>
                  <span class="ovr-text">{o.description ?? ''}{o.guidance ? ` ${o.guidance}` : ''}</span>
                </div>
              {/each}
            </div>
          </div>
        {/each}
      </div>
      {#if activePolicy && activePolicy.version > 0}
        <button class="revert-btn base" onclick={() => revertTo(0)} disabled={reverting === 0}>
          Remove all overlays (back to base descriptions)
        </button>
      {/if}
    {/if}
  </section>

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
  {/if}
</div>

<style>
  /* ── Plain-English improvement cards ──────────────────────────────────────
     A card is a three-row definition list so Driver / Solution / Outcome line
     up down the page and can be scanned column-wise. The status colour lives on
     the left rule only — the SR system has no shadows and no filled cards. */
  .stories-block { margin-bottom: 1.5rem; }
  .stories-lede { margin: 0 0 0.9rem; font-size: var(--fs-nav); line-height: 1.6; color: var(--text-secondary); }
  .stories-lede strong { color: var(--text-primary); font-weight: 700; }

  .stale-warn { margin: 0 0 0.9rem; padding: 0.55rem 0.7rem; border-left: 2px solid var(--warn, #b0892a); background: var(--card-bg); font-size: var(--fs-label); line-height: 1.55; color: var(--text-secondary); }
  .stale-warn strong { color: var(--text-primary); font-weight: 700; }
  .link-btn { background: none; border: none; padding: 0; font: inherit; color: var(--accent); text-decoration: underline; cursor: pointer; }

  .story-grid { display: flex; flex-direction: column; gap: 0.5rem; }
  .story { border: 1px solid var(--line-strong); border-left: 3px solid var(--text-muted); background: var(--surface-sunken); padding: 0.85rem 1rem 0.75rem; }
  .story.st-live { border-left-color: var(--success, #2d7a3a); }
  .story.st-fixed { border-left-color: var(--success, #2d7a3a); }
  .story.st-kept { border-left-color: var(--success, #2d7a3a); }
  .story.st-trial { border-left-color: var(--accent); }
  .story.st-catalogued { border-left-color: var(--accent-ink); }
  .story.st-reverted { border-left-color: var(--warn, #b0892a); }
  .story.st-rejected { border-left-color: var(--error, #c44); }
  .story.st-queued { border-left-color: var(--text-ghost); }

  .story-hd { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; margin-bottom: 0.7rem; }
  .story-id { min-width: 0; }
  .story-title { display: block; font-size: var(--fs-body-sm); font-weight: 700; color: var(--text-primary); overflow-wrap: anywhere; }
  .story-sub { display: block; margin-top: 0.2rem; font-size: var(--fs-label); line-height: 1.45; color: var(--text-muted); }
  .story-pill { flex: none; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.1em; padding: 0.15rem 0.45rem; border: 1px solid var(--line-strong); color: var(--text-secondary); white-space: nowrap; }
  .st-live .story-pill, .st-fixed .story-pill, .st-kept .story-pill { color: var(--success, #2d7a3a); border-color: var(--success, #2d7a3a); }
  .st-trial .story-pill { color: var(--accent); border-color: var(--accent); }
  .st-rejected .story-pill { color: var(--error, #c44); border-color: var(--error, #c44); }
  .st-reverted .story-pill { color: var(--warn, #b0892a); border-color: var(--warn, #b0892a); }

  .story-body { display: grid; grid-template-columns: 5.5rem 1fr; gap: 0.35rem 0.9rem; margin: 0; }
  .story-body dt { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-muted); padding-top: 0.1rem; }
  .story-body dd { margin: 0; min-width: 0; }
  .story-body dd p { margin: 0; font-size: var(--fs-body-sm); line-height: 1.55; color: var(--text-secondary); }
  .story-body dd p.evidence { margin-top: 0.25rem; font-size: var(--fs-label-xs); color: var(--text-ghost); }

  .quotes { margin: 0.35rem 0 0; padding-left: 0.9rem; list-style: none; }
  .quotes li { position: relative; font-size: var(--fs-label); line-height: 1.5; color: var(--text-muted); font-style: italic; }
  .quotes li::before { content: ''; position: absolute; left: -0.9rem; top: 0.35em; bottom: 0.35em; width: 2px; background: var(--line); }

  .conf, .okind { display: inline-block; margin-top: 0.3rem; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-ghost); border-bottom: 1px dotted var(--line-strong); cursor: help; }
  .conf-recorded { color: var(--success, #2d7a3a); }
  .conf-inferred { color: var(--warn, #b0892a); }
  .okind { cursor: default; }
  .ok-measured { color: var(--success, #2d7a3a); }
  .ok-expected { color: var(--accent); }

  .story-note { margin: 0.7rem 0 0; padding: 0.5rem 0.65rem; border-left: 2px solid var(--warn, #b0892a); background: var(--card-bg); font-size: var(--fs-label); line-height: 1.5; color: var(--text-secondary); }
  .story-arc { margin-top: 0.7rem; padding-top: 0.55rem; border-top: 1px solid var(--line-hair); display: flex; flex-wrap: wrap; gap: 0.4rem; font-size: var(--fs-label-xs); color: var(--text-ghost); }
  .arc-sep { color: var(--card-border); }

  /* Technical detail toggle */
  .tech-toggle { display: flex; align-items: center; gap: 0.6rem; width: 100%; padding: 0.7rem 0.85rem; margin-bottom: 1.25rem; background: none; border: 1px dashed var(--line-strong); cursor: pointer; text-align: left; color: inherit; font: inherit; }
  .tech-toggle:hover { border-color: var(--accent); }
  .tech-meta { margin-left: auto; font-size: var(--fs-label-xs); color: var(--text-ghost); }

  @media (max-width: 560px) {
    .story-body { grid-template-columns: 1fr; gap: 0.15rem; }
    .story-body dt { padding-top: 0.5rem; }
    .tech-meta { display: none; }
  }

  /* Prime outcome */
  .prime { border: 2px solid var(--text-primary); padding: 1rem 1.1rem 1.1rem; margin-bottom: 1.25rem; background: var(--surface-sunken); }
  .prime-hd { display: flex; justify-content: space-between; align-items: flex-start; gap: 1.25rem; margin-bottom: 0.9rem; }
  .prime-sub { margin: 0.5rem 0 0; font-size: 0.88rem; line-height: 1.5; color: var(--text-secondary); max-width: 62ch; }
  .prime-sub strong { color: var(--text-primary); font-weight: 700; }
  .prime-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 0.6rem; }
  .prime-tile { background: var(--bg); }
  .prime-tile.muted .stat-num { color: var(--text-muted); }
  .measure-btn, .revert-btn { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.12em; padding: 0.5rem 0.8rem; border: 1px solid var(--line-strong); background: var(--bg); color: var(--text-primary); cursor: pointer; white-space: nowrap; }
  .measure-btn:hover:not(:disabled), .revert-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  .measure-btn:disabled, .revert-btn:disabled { opacity: 0.5; cursor: default; }
  .revert-btn.base { margin-top: 0.6rem; }
  .empty.err { color: var(--accent); }

  .spark-row { display: flex; align-items: center; gap: 0.75rem; margin-top: 0.8rem; }
  .spark { width: 220px; height: 34px; flex: none; }
  .spark-meta { font-size: var(--fs-label-xs); color: var(--text-ghost); }

  .patterns { margin-top: 1rem; }
  .rows.tight { margin-top: 0.4rem; }
  .pat-row { display: grid; grid-template-columns: minmax(140px, 1fr) 90px minmax(180px, auto); align-items: center; gap: 0.6rem; padding: 0.35rem 0; border-bottom: 1px solid var(--line-hair); }
  .pat-tool { font-size: var(--fs-label); color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pat-bar { height: 6px; background: var(--accent); width: var(--w); min-width: 2px; }
  .pat-num { font-size: var(--fs-label-xs); color: var(--text-ghost); text-align: right; }

  /* Policy history */
  .policy-note { margin: 0.5rem 0 0.9rem; font-size: 0.88rem; line-height: 1.5; color: var(--text-secondary); max-width: 66ch; }
  .policy-note strong { color: var(--text-primary); font-weight: 700; }
  .policy-row.live { border-left: 3px solid var(--accent); }
  .policy-head { display: flex; align-items: center; gap: 0.6rem; padding: 0.6rem 0.75rem; flex-wrap: wrap; }
  .ver { font-size: var(--fs-label); font-weight: 700; color: var(--accent); }
  .live-tag { font-size: var(--fs-label-xs); letter-spacing: 0.14em; color: var(--accent); }
  .policy-body { padding: 0 0.75rem 0.7rem; }
  .rationale { font-size: 0.88rem; line-height: 1.45; color: var(--text-secondary); }
  .verdict { font-size: var(--fs-label-xs); color: var(--text-ghost); margin-top: 0.3rem; }
  .ovr { display: flex; gap: 0.5rem; margin-top: 0.45rem; font-size: 0.82rem; line-height: 1.4; }
  .ovr-tool { flex: none; font-size: var(--fs-label-xs); color: var(--accent); padding-top: 0.15rem; }
  .ovr-text { color: var(--text-secondary); }
  .status-pill.s-running { background: var(--accent-tint-25, rgba(196,87,10,0.18)); }
  .status-pill.s-kept { background: rgba(40, 120, 60, 0.18); }
  .status-pill.s-reverted { background: rgba(150, 40, 40, 0.18); }
  .status-pill.s-none { background: var(--line); }

  .wrap { max-width: 980px; margin: 2rem auto 4rem; padding: 0 1.5rem; color: var(--text-primary); font-family: var(--font-body); }
  .wrap.embedded { max-width: none; margin: 0; padding: 0; }
  .page-hdr { display: flex; justify-content: space-between; align-items: flex-end; gap: 1.5rem; margin-bottom: 1.75rem; padding-bottom: 1rem; border-bottom: 2px solid var(--text-primary); }
  .kicker { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.18em; color: var(--accent); margin-bottom: 0.35rem; }
  .page-hdr h1 { margin: 0; font-family: var(--font-display); font-size: 2.2rem; font-weight: 900; line-height: 1.05; }
  .sub { margin: 0.6rem 0 0; font-size: 0.95rem; line-height: 1.5; color: var(--text-secondary); max-width: 64ch; }
  .sub strong { color: var(--text-primary); font-weight: 700; }
  .hdr-links { display: flex; flex-direction: column; gap: 0.4rem; align-items: flex-end; flex-shrink: 0; }
  .back-link { font-family: var(--font-mono); font-size: var(--fs-label); text-transform: uppercase; letter-spacing: 0.12em; color: var(--accent); text-decoration: none; white-space: nowrap; }
  .back-link:hover { text-decoration: underline; }
  .mono { font-family: var(--font-mono); }

  /* Stat tiles */
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 0.6rem; margin-bottom: 1.25rem; }
  .stat-tile { border: 1px solid var(--line-strong); padding: 0.85rem 0.95rem; background: var(--surface-sunken); }
  .stat-num { font-family: var(--font-display); font-size: 1.9rem; font-weight: 900; line-height: 1; color: var(--text-primary); }
  .stat-num.sched-time { font-size: 1.5rem; }
  .stat-label { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-muted); margin-top: 0.4rem; }
  .stat-sub { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); margin-top: 0.25rem; }
  .live-dot { display: inline-block; width: 7px; height: 7px; border-radius: 100px; background: var(--accent); animation: pulse 1.4s ease-in-out infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }

  /* Breakdown chips */
  .breakdown { margin-bottom: 2rem; }
  .chips { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.6rem; }
  .chip { display: inline-flex; align-items: baseline; gap: 0.4rem; border: 1px solid var(--line-strong); padding: 0.3rem 0.6rem; background: var(--surface-sunken); }
  .chip.zero { opacity: 0.45; }
  .chip-num { font-family: var(--font-display); font-weight: 900; font-size: 0.95rem; }
  .chip-label { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); }

  .sr-label-tight { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.16em; color: var(--text-muted); }

  .block { margin-bottom: 2rem; }
  .block-hd { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; }
  .block-meta { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); }
  .empty { padding: 1.5rem; text-align: center; font-family: var(--font-mono); font-size: var(--fs-label); color: var(--text-ghost); font-style: italic; border: 1px dashed var(--line-strong); line-height: 1.5; }
  .empty.compact { padding: 0.75rem; }

  .rows { display: flex; flex-direction: column; gap: 0.4rem; }
  .row { border: 1px solid var(--line-strong); background: var(--surface-sunken); }
  .row-head { display: flex; align-items: center; gap: 0.75rem; width: 100%; padding: 0.65rem 0.85rem; background: none; border: none; cursor: pointer; text-align: left; color: inherit; font: inherit; }
  .row-head:hover { background: var(--card-bg); }
  .row-title { font-weight: 700; font-size: 0.9rem; }
  .row-tags { margin-left: auto; display: flex; gap: 0.85rem; font-size: var(--fs-label); color: var(--text-muted); align-items: center; }
  .att-desc { max-width: 42ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chevron { color: var(--text-ghost); font-size: 0.8rem; }

  .status-pill { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.08em; padding: 0.15rem 0.4rem; border: 1px solid var(--line-strong); white-space: nowrap; }
  .s-complete { color: var(--accent); border-color: var(--accent); }
  .s-partial, .s-budget_exceeded { color: #b0821f; border-color: #b0821f; }
  .s-failed, .s-aborted_user_active { color: #b3452f; border-color: #b3452f; }
  .s-running { color: var(--text-secondary); }

  .row-body { padding: 0 0.85rem 0.85rem; border-top: 1px solid var(--line-strong); }
  .phases { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 0.75rem 0; }
  .phase { font-family: var(--font-mono); font-size: var(--fs-label-xs); padding: 0.2rem 0.45rem; border: 1px solid var(--line-strong); color: var(--text-muted); }
  .p-ok { color: var(--accent); }
  .p-failed { color: #b3452f; }
  .p-skipped { opacity: 0.55; }

  .actions { list-style: none; margin: 0.5rem 0 0; padding: 0; display: flex; flex-direction: column; gap: 0.35rem; }
  .actions li { display: flex; gap: 0.6rem; align-items: baseline; font-size: 0.85rem; }
  .action-kind { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.06em; padding: 0.1rem 0.35rem; border: 1px solid var(--line-strong); color: var(--text-muted); flex-shrink: 0; min-width: 92px; text-align: center; }
  .ak-tool_created { color: var(--accent); border-color: var(--accent); }
  .ak-tool_rejected { color: #b3452f; border-color: #b3452f; }
  .ak-api_verified, .ak-api_registered { color: #2f7fb3; border-color: #2f7fb3; }
  .action-detail { color: var(--text-secondary); }

  .report-label, .code-label, .unmet-label { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-muted); margin: 0.9rem 0 0.35rem; }
  .report { margin: 0; padding: 0.75rem; background: var(--card-bg); border: 1px solid var(--line-strong); font-family: var(--font-body); font-size: 0.85rem; white-space: pre-wrap; line-height: 1.5; color: var(--text-secondary); }
  .att-meta { display: flex; gap: 1rem; font-size: var(--fs-label-xs); color: var(--text-ghost); margin: 0.75rem 0 0; }
  .reject-reason { margin: 0.6rem 0; padding: 0.55rem 0.7rem; border-left: 2px solid #b3452f; background: var(--card-bg); font-size: 0.85rem; color: var(--text-secondary); }
  .rr-label { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.08em; color: #b3452f; }
  .code { margin: 0; padding: 0.75rem; background: var(--card-bg); border: 1px solid var(--line-strong); overflow-x: auto; font-family: var(--font-code); font-size: var(--fs-label); line-height: 1.5; color: var(--text-primary); }
  .code.small { font-size: var(--fs-label); }
  .code code { font: inherit; }

  .seg { display: inline-flex; border: 1px solid var(--line-strong); }
  .seg-btn { background: none; border: none; padding: 0.25rem 0.6rem; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); cursor: pointer; }
  .seg-btn.on { background: var(--accent); color: var(--bg); }

  .ins-summary { font-size: 0.9rem; line-height: 1.55; color: var(--text-secondary); margin: 0 0 0.9rem; }
  .intents { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  .intents th { text-align: left; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); padding: 0.35rem 0.5rem; border-bottom: 1px solid var(--line-strong); }
  .intents td { padding: 0.4rem 0.5rem; border-bottom: 1px solid var(--line-strong); color: var(--text-secondary); }
  .intents .num { text-align: right; }
  .intents .muted { color: var(--text-ghost); }
  .unmet { margin: 0.4rem 0 0; padding-left: 1.1rem; font-size: 0.85rem; color: var(--text-secondary); line-height: 1.6; }

  @media (max-width: 640px) {
    .row-tags { display: none; }
    .page-hdr { flex-direction: column; align-items: flex-start; }
    .hdr-links { flex-direction: row; align-items: flex-start; }
  }
</style>
