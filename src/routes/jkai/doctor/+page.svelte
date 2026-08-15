<svelte:head><title>Workflow Doctor — JKAI</title></svelte:head>
<script lang="ts">
  import { formatGbp } from '$lib/canvas/stats/costFormat';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  type Story = PageData['stories'][number];
  type Signature = PageData['signatures'][number];

  // ── Plain-English cards ───────────────────────────────────────────────────
  // Every sentence on a card was composed server-side in narrative.ts. Nothing
  // here rewords, re-derives or re-ranks them; the component only chooses which
  // cards to show and which chip to hang off them.
  //
  // Default is `all`, not `fixed`: on a shadow night the doctor applies nothing,
  // and a page that opens on an empty tab would read as "no problems".
  type StoryFilter = 'fixed' | 'proposed' | 'all';
  let storyFilter = $state<StoryFilter>('all');
  let showTech = $state(false);
  let expandedRun = $state<string | null>(null);
  let expandedSig = $state<string | null>(null);

  const stories = $derived(data.stories ?? []);
  /** What the doctor actually changed. */
  const fixedStories = $derived(
    stories.filter((s: Story) => s.status === 'auto_fixed' || s.status === 'reverted'),
  );
  /** What is waiting on a human — a refusal is the loudest member of this set. */
  const proposedStories = $derived(
    stories.filter(
      (s: Story) =>
        s.status === 'proposed' || s.status === 'refused_sensitive' || s.status === 'accepted',
    ),
  );
  const visibleStories = $derived(
    storyFilter === 'fixed' ? fixedStories : storyFilter === 'proposed' ? proposedStories : stories,
  );

  const prime = $derived(data.prime);
  const stats = $derived(data.stats);
  const lastRun = $derived(data.lastRun);
  /** The specific silent failure this page exists to prevent. */
  const bridgeDown = $derived(lastRun !== null && !lastRun.whatsappDelivered);

  /** Why a cause can be trusted — shown, never hidden. */
  const CAUSE_NOTE: Record<string, string> = {
    signature: 'Read straight off the recorded error text.',
    linter: 'The graph checker found this in the saved config — a fact about the canvas, not a guess.',
    llm: 'A model’s reading of the error. Nothing recorded proves it; treat it as a lead.',
  };
  const CAUSE_LABEL: Record<string, string> = {
    signature: 'from the error',
    linter: 'from the checker',
    llm: 'model guess',
  };
  const OUTCOME_LABEL: Record<string, string> = {
    measured: 'measured',
    expected: 'expected — not yet proven',
    unproven: 'not proven',
  };

  /** Sparkline path over failing-workflow counts per night. */
  function sparkPath(points: Array<{ failing: number }>, w = 220, h = 34): string {
    if (points.length < 2) return '';
    const vals = points.map((p) => p.failing);
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

  // Triage rows arrive per (workflow, node, signature) — that grouping is what
  // keeps a fix attributed to the right node. The tech list regroups by
  // signature text so one recurring error reads as one row across canvases.
  interface SigGroup {
    signature: string;
    count: number;
    workflows: Signature[];
    lastSeen: string;
    actionable: boolean;
    examples: string[];
  }
  const sigGroups = $derived.by<SigGroup[]>(() => {
    const groups = new Map<string, SigGroup>();
    for (const s of data.signatures ?? []) {
      let g = groups.get(s.signature);
      if (!g) {
        g = {
          signature: s.signature,
          count: 0,
          workflows: [],
          lastSeen: s.lastSeen,
          actionable: false,
          examples: [],
        };
        groups.set(s.signature, g);
      }
      g.count += s.count;
      g.workflows.push(s);
      g.actionable = g.actionable || s.actionable;
      if (s.lastSeen > g.lastSeen) g.lastSeen = s.lastSeen;
      for (const ex of s.examples) if (g.examples.length < 3) g.examples.push(ex);
    }
    return [...groups.values()].sort((a, b) => b.count - a.count);
  });

  /** Loud, watch, or below the acting threshold. */
  function sigTone(g: SigGroup): 'error' | 'warn' | 'accent' {
    if (!g.actionable) return 'accent';
    return g.count >= 10 ? 'error' : 'warn';
  }

  function toggleRun(id: string) {
    expandedRun = expandedRun === id ? null : id;
  }
  function toggleSig(sig: string) {
    expandedSig = expandedSig === sig ? null : sig;
  }

  function fmtDate(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? '—'
      : d.toLocaleString('en-GB', {
          day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
        });
  }
  function fmtMs(ms: number | undefined): string {
    if (!ms) return '—';
    return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
  }
  /** "30 Jul" — the story arc wants a date, not a timestamp. */
  function fmtDay(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? '—'
      : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }
</script>

<div class="wrap">
  <header class="page-hdr">
    <div>
      <div class="kicker">JKAI · WORKFLOW DOCTOR</div>
      <h1>The Doctor</h1>
      <p class="sub">
        Every failing canvas the nightly triage found, in plain English: the
        <strong>symptom</strong>, the <strong>cause</strong>, and the <strong>fix</strong> — applied,
        proposed, or refused. Runs at {data.schedule.display}; the raw signatures, silent failures and
        run log are under Technical detail.
      </p>
    </div>
    <div class="hdr-links">
      <a class="back-link" href="/jkai">JKAI</a>
      <a class="back-link" href="/jkai/canvas">Canvases →</a>
      <a class="back-link" href="/admin/ai/doctor">Controls →</a>
    </div>
  </header>

  <!-- A dead WhatsApp bridge is invisible on every other nightly job, because
       executeTool swallows the send failure. Say it out loud. -->
  {#if bridgeDown}
    <div class="alert">
      <strong>Last night's summary did not reach WhatsApp.</strong> The run itself completed — the
      send failed, so this page is the only place the result landed. Check the bridge before relying
      on the morning message.
    </div>
  {/if}

  {#if !data.switches.enabled}
    <div class="alert warn">
      <strong>The nightly run is switched off.</strong> Nothing below will change until the kill
      switch is back on in <a href="/admin/ai/doctor">Controls</a>.
    </div>
  {/if}

  {#if data.liveFailed}
    <div class="alert warn">
      <strong>The live triage query failed.</strong> The figures below are from the last recorded
      run, not from right now.
    </div>
  {/if}

  <!-- ── PRIME OUTCOME ──────────────────────────────────────────────────
       Workflows currently failing. Every other number on this page is a
       means to moving that one. -->
  <section class="prime">
    <div class="prime-hd">
      <div>
        <div class="sr-label-tight">Workflows currently failing</div>
        <p class="prime-sub">
          Distinct canvases with at least one real failure in the last {data.lookbackDays} days —
          reaper noise, cancellations and drain aborts excluded. This is the number the doctor is
          graded on, {prime.liveFigure ? 'read live on this page load' : 'carried over from the last run'}.
        </p>
      </div>
      <div class="prime-figure">
        <span class="prime-num" data-tone={prime.workflowsFailing > 0 ? 'bad' : 'good'}>
          {prime.workflowsFailing}
        </span>
        <span class="prime-cap mono">{prime.workflowsFailing === 1 ? 'canvas' : 'canvases'}</span>
      </div>
    </div>

    <div class="prime-grid">
      <div class="stat-tile prime-tile">
        <div class="stat-num">{prime.fixedLastNight}</div>
        <div class="stat-label">fixed last night</div>
        <div class="stat-sub">
          {prime.quarantinedLastNight} schedule{prime.quarantinedLastNight === 1 ? '' : 's'} quarantined
        </div>
      </div>
      <div class="stat-tile prime-tile">
        <div class="stat-num">{prime.openProposals}</div>
        <div class="stat-label">open proposals</div>
        <div class="stat-sub">
          {prime.refused} refused — {prime.refused === 1 ? 'needs' : 'need'} you
        </div>
      </div>
      <div class="stat-tile prime-tile">
        <div class="stat-num">{prime.stillFailingAfterFix}</div>
        <div class="stat-label">still failing after a fix</div>
        <div class="stat-sub">changed, then seen again</div>
      </div>
      <div class="stat-tile prime-tile">
        <div class="stat-num">{prime.nightsSinceClean ?? '—'}</div>
        <div class="stat-label">nights since a clean sweep</div>
        <div class="stat-sub">
          {prime.nightsSinceClean === null ? 'never had one yet' : 'nights with nothing failing'}
        </div>
      </div>
    </div>

    {#if prime.spark.length >= 2}
      <div class="spark-row">
        <!-- var() resolves in an SVG stroke attribute. It does NOT resolve in an
             SVG font-size attribute, so there is no text inside this svg. -->
        <svg class="spark" viewBox="0 0 220 34" preserveAspectRatio="none" aria-hidden="true">
          <path d={sparkPath(prime.spark)} fill="none" stroke="var(--accent)" stroke-width="1.5" />
        </svg>
        <span class="spark-meta mono">
          {prime.spark[0].day} → {prime.spark[prime.spark.length - 1].day} ·
          {prime.spark[0].failing} → {prime.spark[prime.spark.length - 1].failing} canvases failing
        </span>
      </div>
    {/if}

    <div class="live-strip">
      <span class="chip" class:zero={data.deadNodeTypes.length === 0}>
        <span class="chip-num">{data.deadNodeTypes.length}</span>
        <span class="chip-label">dead node types</span>
      </span>
      <span class="chip" class:zero={data.runaways.length === 0}>
        <span class="chip-num">{data.runaways.length}</span>
        <span class="chip-label">runaway schedules</span>
      </span>
      <span class="chip" class:zero={data.silent.length === 0}>
        <span class="chip-num">{data.silent.length}</span>
        <span class="chip-label">silent failures</span>
      </span>
      <span class="sw mono" data-on={data.switches.breaker}>
        breaker {data.switches.breaker ? 'on' : 'off'}
      </span>
      <span class="sw mono" data-on={data.switches.autoApply}>
        auto-apply {data.switches.autoApply ? 'on' : 'off — proposing only'}
      </span>
      {#if data.running}<span class="sw mono" data-on={true}><span class="live-dot"></span> running now</span>{/if}
    </div>
  </section>

  <!-- ── WHAT BROKE AND WHAT I DID ABOUT IT ──────────────────────────────
       The lead. One card per finding, each answering the same three
       questions in the same order, so the page reads top to bottom without
       knowing what a "signature" or a "phase" is. -->
  <section class="block stories-block">
    <div class="block-hd">
      <span class="sr-label-tight">What broke, and what I did about it</span>
      <div class="seg" role="group" aria-label="Filter findings">
        <button type="button" class="seg-btn" class:on={storyFilter === 'fixed'}
          aria-pressed={storyFilter === 'fixed'} onclick={() => (storyFilter = 'fixed')}>
          fixed ({fixedStories.length})
        </button>
        <button type="button" class="seg-btn" class:on={storyFilter === 'proposed'}
          aria-pressed={storyFilter === 'proposed'} onclick={() => (storyFilter = 'proposed')}>
          proposed ({proposedStories.length})
        </button>
        <button type="button" class="seg-btn" class:on={storyFilter === 'all'}
          aria-pressed={storyFilter === 'all'} onclick={() => (storyFilter = 'all')}>
          all ({stories.length})
        </button>
      </div>
    </div>

    {#if stories.length > 0}
      <p class="stories-lede">{data.storySummary}</p>
    {/if}

    {#if visibleStories.length === 0}
      <div class="empty">
        {#if stories.length === 0}
          {prime.workflowsFailing === 0
            ? `No failing workflows in the last ${data.lookbackDays} days.`
            : 'Nothing explained yet — after the first nightly run each failure is written up here.'}
        {:else if storyFilter === 'fixed'}
          Nothing was fixed automatically — everything found so far is a proposal.
        {:else}
          Nothing is waiting on you.
        {/if}
      </div>
    {:else}
      <div class="story-grid">
        {#each visibleStories as s (s.id)}
          <article class="story st-{s.status}">
            <header class="story-hd">
              <div class="story-id">
                <span class="story-title mono">{s.subject}</span>
                <span class="story-sub">
                  {s.fixKindLabel}
                  {#if s.canvasSlug}
                    · <a class="canvas-link" href="/jkai/canvas/{s.canvasSlug}">open canvas →</a>
                  {/if}
                </span>
              </div>
              <span class="story-pill">{s.statusLabel}</span>
            </header>

            <dl class="story-body">
              <dt>Symptom</dt>
              <dd>
                <p>{s.symptom}</p>
                {#if s.symptomEvidence}
                  <p class="evidence mono">{s.symptomEvidence}</p>
                {/if}
              </dd>

              <dt>Cause</dt>
              <dd>
                <p>{s.cause}</p>
                <span class="conf conf-{s.causeSource}" title={CAUSE_NOTE[s.causeSource]}>
                  {CAUSE_LABEL[s.causeSource]}
                </span>
              </dd>

              <dt>Fix</dt>
              <dd>
                <p>{s.fix}</p>
                <p class="outcome">{s.outcome}</p>
                <span class="okind ok-{s.outcomeKind}">{OUTCOME_LABEL[s.outcomeKind]}</span>
              </dd>
            </dl>

            <!-- Names only. The whole point of a refusal is that the value never
                 travels — not to this page, not to the record behind it. -->
            {#if s.status === 'refused_sensitive' && s.sensitiveFields?.length}
              <p class="story-fields">
                <span class="sr-label-tight">
                  {s.sensitiveFields.length === 1 ? 'Field' : 'Fields'} to look at
                </span>
                {#each s.sensitiveFields as f}<code class="mono">{f}</code>{/each}
                <span class="fields-note">field names only — the value is never shown or stored here</span>
              </p>
            {/if}

            {#if s.note}
              <p class="story-note">{s.note}</p>
            {/if}

            <footer class="story-arc mono">
              {#each s.arc as e, i}
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
       still the truth of record, but it is not how you find out what broke. -->
  <button class="tech-toggle" onclick={() => (showTech = !showTech)} aria-expanded={showTech}>
    <span class="chevron">{showTech ? '▾' : '▸'}</span>
    <span class="sr-label-tight">Technical detail</span>
    <span class="tech-meta mono">signatures, silent failures, runs, phases, budget</span>
  </button>

  {#if showTech}
  <!-- ── Summary statistics ─────────────────────────────────────────────── -->
  <section class="stats">
    <div class="stat-tile">
      <div class="stat-num">{stats.totalRuns}</div>
      <div class="stat-label">runs logged</div>
      <div class="stat-sub">{stats.lastRunAt ? `last ${fmtDate(stats.lastRunAt)}` : 'none yet'}</div>
    </div>
    <div class="stat-tile">
      <div class="stat-num">{stats.openFindings}</div>
      <div class="stat-label">findings open</div>
      <div class="stat-sub">{stories.length} in total</div>
    </div>
    <div class="stat-tile">
      <div class="stat-num">{stats.fixesApplied}</div>
      <div class="stat-label">auto-fixes applied</div>
      <div class="stat-sub">{stats.schedulesQuarantined} schedules quarantined</div>
    </div>
    <div class="stat-tile">
      <div class="stat-num">{stats.fixesReverted}</div>
      <div class="stat-label">rolled back</div>
      <div class="stat-sub">graph did not come out cleaner</div>
    </div>
    <div class="stat-tile">
      <div class="stat-num">{formatGbp(stats.costUsd)}</div>
      <div class="stat-label">total spend</div>
      <div class="stat-sub">{stats.llmCalls} LLM calls</div>
    </div>
    <div class="stat-tile schedule">
      <div class="stat-num sched-time">{data.schedule.display.split(' ')[0]}</div>
      <div class="stat-label">nightly schedule</div>
      <div class="stat-sub">
        {#if data.running}<span class="live-dot"></span> running now{:else}{data.schedule.tz}{/if}
      </div>
    </div>
  </section>

  <!-- ── Failure signatures (live) ──────────────────────────────────────── -->
  <section class="block">
    <div class="block-hd">
      <span class="sr-label-tight">Failure signatures</span>
      <span class="block-meta">live · last {data.lookbackDays} days</span>
    </div>
    {#if sigGroups.length === 0}
      <div class="empty">No failing workflows in the last {data.lookbackDays} days.</div>
    {:else}
      <div class="rows">
        {#each sigGroups as g (g.signature)}
          <div class="row">
            <button class="row-head" onclick={() => toggleSig(g.signature)} aria-expanded={expandedSig === g.signature}>
              <span class="status-dot" data-status={sigTone(g)}></span>
              <span class="row-title mono">{g.signature}</span>
              <span class="row-tags mono">
                <span>{g.count} failure{g.count === 1 ? '' : 's'}</span>
                <span>{g.workflows.length} workflow{g.workflows.length === 1 ? '' : 's'}</span>
                <span>{fmtDate(g.lastSeen)}</span>
              </span>
              <span class="chevron">{expandedSig === g.signature ? '▾' : '▸'}</span>
            </button>
            {#if expandedSig === g.signature}
              <div class="row-body">
                <ul class="affected">
                  {#each g.workflows as w}
                    <li>
                      {#if w.canvasSlug}
                        <a class="canvas-link" href="/jkai/canvas/{w.canvasSlug}">{w.workflowName}</a>
                      {:else}
                        <span class="mono">{w.workflowName}</span>
                      {/if}
                      <span class="aff-meta mono">
                        {w.nodeLabel ?? w.nodeType ?? w.level} · {w.count}×{w.actionable ? '' : ' · below threshold'}
                      </span>
                    </li>
                  {/each}
                </ul>
                {#each g.examples as ex}
                  <div class="err-line mono">{ex}</div>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <!-- ── Silent failures ────────────────────────────────────────────────── -->
  <section class="block">
    <div class="block-hd">
      <span class="sr-label-tight">Silently failing</span>
      <span class="block-meta">runs that report success</span>
    </div>
    <p class="block-note">
      These runs are <strong>green everywhere else</strong> — status <code class="mono">completed</code>,
      no error, a 100% success rate on the canvas. Their last node returned a 4xx/5xx or carried on past
      its own error, so the result lied.
    </p>
    {#if data.silent.length === 0}
      <div class="empty">Nothing reporting a false success.</div>
    {:else}
      <div class="rows">
        {#each data.silent as s (s.runId + s.nodeId)}
          <div class="row static">
            <div class="row-head as-row">
              <span class="status-dot" data-status="warn"></span>
              <span class="row-title">
                {#if s.canvasSlug}
                  <a class="canvas-link" href="/jkai/canvas/{s.canvasSlug}">{s.workflowName}</a>
                {:else}{s.workflowName}{/if}
              </span>
              <span class="row-tags mono">
                <span>{s.nodeLabel ?? s.nodeType}</span>
                <span>{s.httpStatus ?? 'error'}</span>
                <span>{fmtDate(s.at)}</span>
              </span>
            </div>
            {#if s.errorText}
              <div class="row-body"><div class="err-line mono">{s.errorText}</div></div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <!-- ── Runs ───────────────────────────────────────────────────────────── -->
  <section class="block">
    <div class="block-hd">
      <span class="sr-label-tight">Runs</span>
      <span class="block-meta">{data.runs.length} shown</span>
    </div>
    {#if data.runs.length === 0}
      <div class="empty">
        No runs yet — the first nightly run is at {data.schedule.display}, or trigger one from Controls.
      </div>
    {:else}
      <div class="rows">
        {#each data.runs as run (run.runId)}
          <div class="row">
            <button class="row-head" onclick={() => toggleRun(run.runId)} aria-expanded={expandedRun === run.runId}>
              <span class="status-pill s-{run.data.status}">{run.data.status.replace(/_/g, ' ')}</span>
              <span class="row-title">{fmtDate(run.createdAt)}</span>
              <span class="row-tags mono">
                <span>{run.data.trigger}</span>
                <span>{run.data.workflowsFailing ?? 0} failing</span>
                <span>{formatGbp(run.data.costUsd ?? 0)}</span>
                {#if !run.data.whatsappDelivered}<span class="tag-bad">no whatsapp</span>{/if}
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
                <div class="budget mono">
                  {run.data.llmCalls ?? 0} calls · {run.data.tokensIn ?? 0} in / {run.data.tokensOut ?? 0} out ·
                  {formatGbp(run.data.costUsd ?? 0)} · auto-apply {run.data.autoApplyEnabled ? 'on' : 'off'} ·
                  breaker {run.data.breakerEnabled ? 'on' : 'off'} ·
                  whatsapp {run.data.whatsappDelivered ? 'delivered' : 'NOT delivered'}
                </div>
                {#if (run.data.actions?.length ?? 0) === 0}
                  <div class="empty compact">No actions recorded.</div>
                {:else}
                  <ul class="actions">
                    {#each run.data.actions ?? [] as a}
                      <li>
                        <span class="action-kind ak-{a.kind}">{a.kind.replace(/_/g, ' ')}</span>
                        <span class="action-detail">{a.detail}</span>
                      </li>
                    {/each}
                  </ul>
                {/if}
                {#if run.data.report}
                  <div class="report-label">Report</div>
                  <pre class="report mono">{run.data.report}</pre>
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </section>
  {/if}
</div>

<style>
  /* ── Plain-English finding cards ──────────────────────────────────────────
     A card is a three-row definition list so Symptom / Cause / Fix line up down
     the page and can be scanned column-wise. The status colour lives on the left
     rule only — the SR system has no shadows and no filled cards, and every
     status colour is a token, not a literal. */
  .stories-block { margin-bottom: 1.5rem; }
  .stories-lede { margin: 0 0 0.9rem; font-size: var(--fs-nav); line-height: 1.6; color: var(--text-secondary); }

  .story-grid { display: flex; flex-direction: column; gap: 0.5rem; }
  .story { border: 1px solid var(--card-border); border-left: 3px solid var(--text-muted); background: var(--bg-section); padding: 0.85rem 1rem 0.75rem; }
  .st-auto_fixed { border-left-color: var(--success); }
  .st-resolved { border-left-color: var(--success); }
  .st-proposed { border-left-color: var(--accent); }
  .st-accepted { border-left-color: var(--accent-ink); }
  .st-refused_sensitive { border-left-color: var(--error); }
  .st-reverted { border-left-color: var(--warn); }
  .st-dismissed { border-left-color: var(--text-ghost); }

  .story-hd { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; margin-bottom: 0.7rem; }
  .story-id { min-width: 0; }
  .story-title { display: block; font-size: var(--fs-body-sm); font-weight: 700; color: var(--text-primary); overflow-wrap: anywhere; }
  .story-sub { display: block; margin-top: 0.2rem; font-size: var(--fs-label); line-height: 1.45; color: var(--text-muted); }
  .story-pill { flex: none; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.1em; padding: 0.15rem 0.45rem; border: 1px solid var(--card-border); color: var(--text-secondary); white-space: nowrap; }
  .st-auto_fixed .story-pill, .st-resolved .story-pill { color: var(--success); border-color: var(--success); }
  .st-proposed .story-pill { color: var(--accent); border-color: var(--accent); }
  .st-refused_sensitive .story-pill { color: var(--error); border-color: var(--error); }
  .st-reverted .story-pill { color: var(--warn); border-color: var(--warn); }

  .story-body { display: grid; grid-template-columns: 5.5rem 1fr; gap: 0.35rem 0.9rem; margin: 0; }
  .story-body dt { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-muted); padding-top: 0.1rem; }
  .story-body dd { margin: 0; min-width: 0; }
  .story-body dd p { margin: 0; font-size: var(--fs-body-sm); line-height: 1.55; color: var(--text-secondary); }
  .story-body dd p.evidence { margin-top: 0.25rem; font-size: var(--fs-label-xs); color: var(--text-ghost); overflow-wrap: anywhere; }
  .story-body dd p.outcome { margin-top: 0.35rem; color: var(--text-muted); }

  /* A linter fact and a model's guess must not render the same weight. */
  .conf, .okind { display: inline-block; margin-top: 0.3rem; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-ghost); border-bottom: 1px dotted var(--card-border); cursor: help; }
  .conf-signature, .conf-linter { color: var(--success); }
  .conf-llm { color: var(--warn); }
  .okind { cursor: default; }
  .ok-measured { color: var(--success); }
  .ok-expected { color: var(--accent); }
  .ok-unproven { color: var(--text-ghost); }

  .story-fields { margin: 0.7rem 0 0; padding: 0.5rem 0.65rem; border-left: 2px solid var(--error); background: var(--error-bg); display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.45rem; }
  .story-fields code { font-size: var(--fs-label); color: var(--text-primary); border: 1px solid var(--card-border); padding: 0.05rem 0.3rem; }
  .fields-note { font-size: var(--fs-label-xs); color: var(--text-muted); font-style: italic; }

  .story-note { margin: 0.7rem 0 0; padding: 0.5rem 0.65rem; border-left: 2px solid var(--warn); background: var(--card-bg); font-size: var(--fs-label); line-height: 1.5; color: var(--text-secondary); }
  .story-arc { margin-top: 0.7rem; padding-top: 0.55rem; border-top: 1px solid var(--divider); display: flex; flex-wrap: wrap; gap: 0.4rem; font-size: var(--fs-label-xs); color: var(--text-ghost); }
  .arc-sep { color: var(--card-border); }
  .canvas-link { color: var(--accent); text-decoration: none; }
  .canvas-link:hover { text-decoration: underline; }

  /* Technical detail toggle */
  .tech-toggle { display: flex; align-items: center; gap: 0.6rem; width: 100%; padding: 0.7rem 0.85rem; margin-bottom: 1.25rem; background: none; border: 1px dashed var(--card-border); cursor: pointer; text-align: left; color: inherit; font: inherit; }
  .tech-toggle:hover { border-color: var(--accent); }
  .tech-meta { margin-left: auto; font-size: var(--fs-label-xs); color: var(--text-ghost); }

  /* Banners. A dead bridge is an error, a switched-off engine is a state. */
  .alert { margin-bottom: 1rem; padding: 0.6rem 0.8rem; border-left: 2px solid var(--error); background: var(--error-bg); font-size: var(--fs-body-sm); line-height: 1.55; color: var(--text-secondary); }
  .alert.warn { border-left-color: var(--warn); background: var(--warn-bg); }
  .alert strong { color: var(--text-primary); font-weight: 700; }
  .alert a { color: var(--accent); }

  /* Prime outcome */
  .prime { border: 2px solid var(--text-primary); padding: 1rem 1.1rem 1.1rem; margin-bottom: 1.25rem; background: var(--bg-section); }
  .prime-hd { display: flex; justify-content: space-between; align-items: flex-start; gap: 1.25rem; margin-bottom: 0.9rem; }
  .prime-sub { margin: 0.5rem 0 0; font-size: 0.88rem; line-height: 1.5; color: var(--text-secondary); max-width: 62ch; }
  .prime-figure { flex: none; text-align: right; }
  .prime-num { display: block; font-family: var(--font-display); font-size: 3rem; font-weight: 900; line-height: 1; color: var(--text-primary); }
  .prime-num[data-tone='bad'] { color: var(--error); }
  .prime-num[data-tone='good'] { color: var(--success); }
  .prime-cap { display: block; margin-top: 0.25rem; font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-muted); }
  .prime-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 0.6rem; }
  .prime-tile { background: var(--bg); }

  .spark-row { display: flex; align-items: center; gap: 0.75rem; margin-top: 0.8rem; }
  .spark { width: 220px; height: 34px; flex: none; }
  .spark-meta { font-size: var(--fs-label-xs); color: var(--text-ghost); }

  .live-strip { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; margin-top: 0.9rem; padding-top: 0.8rem; border-top: 1px solid var(--divider); }
  .sw { font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-ghost); border: 1px solid var(--card-border); padding: 0.25rem 0.5rem; }
  .sw[data-on='true'] { color: var(--accent); border-color: var(--accent); }

  .wrap { max-width: 980px; margin: 2rem auto 4rem; padding: 0 1.5rem; color: var(--text-primary); font-family: var(--font-body); }
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
  .stat-tile { border: 1px solid var(--card-border); padding: 0.85rem 0.95rem; background: var(--bg-section); }
  .stat-num { font-family: var(--font-display); font-size: 1.9rem; font-weight: 900; line-height: 1; color: var(--text-primary); }
  .stat-num.sched-time { font-size: 1.5rem; }
  .stat-label { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-muted); margin-top: 0.4rem; }
  .stat-sub { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); margin-top: 0.25rem; }
  .live-dot { display: inline-block; width: 7px; height: 7px; border-radius: 100px; background: var(--accent); animation: pulse 1.4s ease-in-out infinite; }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }

  .chip { display: inline-flex; align-items: baseline; gap: 0.4rem; border: 1px solid var(--card-border); padding: 0.25rem 0.6rem; background: var(--bg); }
  .chip.zero { opacity: 0.45; }
  .chip-num { font-family: var(--font-display); font-weight: 900; font-size: 0.95rem; }
  .chip-label { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); }

  .sr-label-tight { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.16em; color: var(--text-muted); }

  .block { margin-bottom: 2rem; }
  .block-hd { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; }
  .block-meta { font-family: var(--font-mono); font-size: var(--fs-label-xs); color: var(--text-ghost); }
  .block-note { margin: 0 0 0.9rem; font-size: 0.88rem; line-height: 1.5; color: var(--text-secondary); max-width: 66ch; }
  .block-note strong { color: var(--text-primary); font-weight: 700; }
  .block-note code { font-size: var(--fs-label); }
  .empty { padding: 1.5rem; text-align: center; font-family: var(--font-mono); font-size: var(--fs-label); color: var(--text-ghost); font-style: italic; border: 1px dashed var(--card-border); line-height: 1.5; }
  .empty.compact { padding: 0.75rem; }

  .rows { display: flex; flex-direction: column; gap: 0.4rem; }
  .row { border: 1px solid var(--card-border); background: var(--bg-section); }
  .row-head { display: flex; align-items: center; gap: 0.75rem; width: 100%; padding: 0.65rem 0.85rem; background: none; border: none; cursor: pointer; text-align: left; color: inherit; font: inherit; }
  .row-head.as-row { cursor: default; }
  .row-head:not(.as-row):hover { background: var(--card-bg); }
  .row-title { font-weight: 700; font-size: 0.9rem; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row-tags { margin-left: auto; display: flex; gap: 0.85rem; font-size: var(--fs-label); color: var(--text-muted); align-items: center; white-space: nowrap; }
  .tag-bad { color: var(--error); }
  .chevron { color: var(--text-ghost); font-size: 0.8rem; }

  .status-dot { flex: none; width: 8px; height: 8px; border-radius: 100px; background: var(--text-ghost); }
  .status-dot[data-status='error'] { background: var(--error); }
  .status-dot[data-status='warn'] { background: var(--warn); }
  .status-dot[data-status='accent'] { background: var(--accent); }

  .status-pill { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.08em; padding: 0.15rem 0.4rem; border: 1px solid var(--card-border); white-space: nowrap; }
  .s-complete { color: var(--success); border-color: var(--success); }
  .s-partial, .s-budget_exceeded { color: var(--warn); border-color: var(--warn); }
  .s-failed, .s-aborted_user_active { color: var(--error); border-color: var(--error); }
  .s-running { color: var(--accent); border-color: var(--accent); }

  .row-body { padding: 0 0.85rem 0.85rem; border-top: 1px solid var(--card-border); }
  .affected { list-style: none; margin: 0.75rem 0 0; padding: 0; display: flex; flex-direction: column; gap: 0.3rem; }
  .affected li { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: baseline; font-size: 0.85rem; }
  .aff-meta { font-size: var(--fs-label-xs); color: var(--text-ghost); }
  .err-line { margin-top: 0.5rem; padding: 0.45rem 0.6rem; border-left: 2px solid var(--error); background: var(--error-bg); font-size: var(--fs-label-xs); line-height: 1.5; color: var(--error); overflow-wrap: anywhere; }

  .phases { display: flex; flex-wrap: wrap; gap: 0.4rem; margin: 0.75rem 0; }
  .phase { font-family: var(--font-mono); font-size: var(--fs-label-xs); padding: 0.2rem 0.45rem; border: 1px solid var(--card-border); color: var(--text-muted); }
  .p-ok { color: var(--success); }
  .p-failed { color: var(--error); }
  .p-skipped { opacity: 0.55; }
  .budget { font-size: var(--fs-label-xs); color: var(--text-ghost); line-height: 1.6; }

  .actions { list-style: none; margin: 0.5rem 0 0; padding: 0; display: flex; flex-direction: column; gap: 0.35rem; }
  .actions li { display: flex; gap: 0.6rem; align-items: baseline; font-size: 0.85rem; }
  .action-kind { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.06em; padding: 0.1rem 0.35rem; border: 1px solid var(--card-border); color: var(--text-muted); flex-shrink: 0; min-width: 112px; text-align: center; }
  .ak-fix_applied, .ak-schedule_quarantined { color: var(--success); border-color: var(--success); }
  .ak-fix_reverted { color: var(--warn); border-color: var(--warn); }
  .ak-fix_refused_sensitive { color: var(--error); border-color: var(--error); }
  .ak-proposal { color: var(--accent); border-color: var(--accent); }
  .action-detail { color: var(--text-secondary); overflow-wrap: anywhere; }

  .report-label { font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-muted); margin: 0.9rem 0 0.35rem; }
  .report { margin: 0; padding: 0.75rem; background: var(--card-bg); border: 1px solid var(--card-border); font-size: var(--fs-label); white-space: pre-wrap; line-height: 1.6; color: var(--text-secondary); overflow-x: auto; }

  .seg { display: inline-flex; border: 1px solid var(--card-border); }
  .seg-btn { background: none; border: none; padding: 0.25rem 0.6rem; font-family: var(--font-mono); font-size: var(--fs-label-xs); text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-muted); cursor: pointer; }
  .seg-btn.on { background: var(--accent); color: var(--bg); }

  @media (max-width: 640px) {
    .row-tags { display: none; }
    .page-hdr { flex-direction: column; align-items: flex-start; }
    .hdr-links { flex-direction: row; align-items: flex-start; }
    .prime-hd { flex-direction: column; }
    .prime-figure { text-align: left; }
  }
  @media (max-width: 560px) {
    .story-body { grid-template-columns: 1fr; gap: 0.15rem; }
    .story-body dt { padding-top: 0.5rem; }
    .tech-meta { display: none; }
  }
</style>
