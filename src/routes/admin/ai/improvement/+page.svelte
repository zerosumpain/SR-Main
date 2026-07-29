<svelte:head><title>Self-Improvement — Admin</title></svelte:head>
<script lang="ts">
  import { getContext } from 'svelte';
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';

  type PhaseRecord = { status: string; detail?: string; ms?: number };
  type RunAction = { kind: string; detail: string };
  type RunData = {
    status: string;
    trigger: string;
    startedAt?: string;
    finishedAt?: string;
    phases?: Record<string, PhaseRecord>;
    llmCalls?: number;
    tokensIn?: number;
    tokensOut?: number;
    costUsd?: number;
    actions?: RunAction[];
    report?: string;
  };
  type RunView = { runId: string | null; createdAt: string | Date; data: RunData };
  type ApiView = {
    key: string | null;
    updatedAt: string | Date;
    data: {
      name?: string;
      baseUrl?: string;
      description?: string;
      status?: string;
      lastVerifiedAt?: string;
      auth?: { kind?: string };
      capabilities?: string[];
      tags?: string[];
    };
  };
  type ToolView = {
    name: string;
    description: string;
    toolset: string;
    enabled: boolean;
    runCount: number;
    errorCount: number;
    lastRunAt: string | Date | null;
    createdAt: string | Date | null;
  };
  type Intent = {
    intent: string;
    count?: number;
    examples?: string[];
    servedWell?: boolean;
    missingCapability?: string;
  };
  type Insights = {
    period?: string;
    generatedAt?: string;
    intents?: Intent[];
    topUnmet?: string[];
    summary?: string;
  };
  type BacklogView = {
    slug: string;
    title: string;
    detail?: string;
    kind: string;
    status: string;
    priority: number;
    attempts: number;
    lastError?: string;
    prUrl?: string;
  };

  let { data } = $props();
  const adminToken = getContext<string>('adminToken');
  const tokenQs = adminToken ? `?token=${adminToken}` : '';

  const insights = $derived((data.insights ?? null) as Insights | null);
  const schedule = $derived(data.schedule);

  let enabled = $state<boolean>(data.enabled);
  let running = $state<boolean>(data.status.running);
  let runs = $state<RunView[]>(data.runs as RunView[]);
  let apis = $state<ApiView[]>(data.apis as ApiView[]);
  let tools = $state<ToolView[]>(data.tools as ToolView[]);
  const backlog = $derived((data.backlog ?? []) as BacklogView[]);
  const openBacklog = $derived(backlog.filter((b) => b.status === 'open'));

  function backlogState(status: string): string {
    if (status === 'shipped') return 'success';
    if (status === 'abandoned') return 'error';
    return 'draft';
  }

  let expandedRunId = $state<string | null>(null);
  let starting = $state(false);
  let runError = $state('');
  let toggling = $state(false);
  let verifyingKey = $state<string | null>(null);
  let busyTool = $state<string | null>(null);

  const latestReport = $derived(runs.length > 0 ? (runs[0].data.report ?? '') : '');

  // Poll the runs endpoint every 10s ONLY while a run is live. The interval
  // handle is a local const inside the effect (never $state) and torn down on
  // cleanup / when `running` flips false — svelte5-pitfalls rule 1.
  $effect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      void refreshRuns();
    }, 10_000);
    return () => clearInterval(timer);
  });

  async function refreshRuns() {
    try {
      const res = await fetch(`/api/admin/improvement/runs${tokenQs}`);
      if (!res.ok) return;
      const body = await res.json();
      if (Array.isArray(body.runs)) runs = body.runs as RunView[];
      if (body.status && typeof body.status.running === 'boolean') running = body.status.running;
    } catch {
      /* transient — the next tick retries */
    }
  }

  async function runNow() {
    starting = true;
    runError = '';
    try {
      const res = await fetch(`/api/admin/improvement/run${tokenQs}`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        running = true; // starts the poll effect
        await refreshRuns();
      } else {
        runError = body.error ?? `Error ${res.status}`;
      }
    } catch {
      runError = 'Network error';
    } finally {
      starting = false;
    }
  }

  async function toggleEnabled() {
    const next = !enabled;
    toggling = true;
    try {
      const res = await fetch(`/api/admin/improvement/toggle${tokenQs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      if (res.ok) enabled = next;
    } catch {
      /* leave the toggle as-is on failure */
    } finally {
      toggling = false;
    }
  }

  async function verifyApi(key: string | null) {
    if (!key) return;
    verifyingKey = key;
    try {
      const res = await fetch(`/api/admin/improvement/verify-api${tokenQs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      const body = await res.json().catch(() => ({}));
      if (body.status) {
        apis = apis.map((a) =>
          a.key === key
            ? { ...a, data: { ...a.data, status: body.status, lastVerifiedAt: body.lastVerifiedAt ?? a.data.lastVerifiedAt } }
            : a,
        );
      }
    } catch {
      /* ignore — status simply won't update */
    } finally {
      verifyingKey = null;
    }
  }

  async function setToolEnabled(name: string, next: boolean) {
    busyTool = name;
    try {
      const res = await fetch(`/api/admin/tools/${encodeURIComponent(name)}${tokenQs}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      if (res.ok) tools = tools.map((t) => (t.name === name ? { ...t, enabled: next } : t));
    } catch {
      /* ignore */
    } finally {
      busyTool = null;
    }
  }

  async function deleteTool(name: string) {
    if (!confirm(`Delete the self-built tool "${name}"? This cannot be undone.`)) return;
    busyTool = name;
    try {
      const res = await fetch(`/api/admin/tools/${encodeURIComponent(name)}${tokenQs}`, { method: 'DELETE' });
      if (res.ok) tools = tools.filter((t) => t.name !== name);
    } catch {
      /* ignore */
    } finally {
      busyTool = null;
    }
  }

  function toggleRun(runId: string | null) {
    if (!runId) return;
    expandedRunId = expandedRunId === runId ? null : runId;
  }

  // ——— Helpers ———
  function runState(s: string | undefined): string {
    switch (s) {
      case 'complete':
        return 'success';
      case 'running':
        return 'running';
      case 'partial':
      case 'budget_exceeded':
        return 'warn';
      case 'aborted_user_active':
        return 'info';
      case 'failed':
        return 'error';
      default:
        return 'info';
    }
  }
  function apiState(s: string | undefined): string {
    switch (s) {
      case 'verified':
        return 'success';
      case 'candidate':
        return 'warn';
      case 'broken':
        return 'error';
      case 'seeded':
      default:
        return 'info';
    }
  }
  function phaseState(s: string | undefined): string {
    if (s === 'ok') return 'success';
    if (s === 'failed') return 'error';
    return 'info';
  }
  function duration(d: RunData): string {
    if (!d.startedAt) return '—';
    const start = new Date(d.startedAt).getTime();
    const end = d.finishedAt ? new Date(d.finishedAt).getTime() : Date.now();
    const ms = Math.max(0, end - start);
    if (ms < 1000) return `${ms}ms`;
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  }
  function money(n: number | undefined): string {
    return `$${(n ?? 0).toFixed(3)}`;
  }
  function fmtDateTime(d: string | Date | null | undefined): string {
    if (!d) return '—';
    return new Date(d).toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  function fmtDate(d: string | Date | null | undefined): string {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
</script>

<PageWrap width="wide">
  <PageHeader
    kicker="AI"
    title="Self-Improvement"
    sub="The nightly idle-time engine learns from your questions, grows the API catalogue, and builds runtime tools. Budget-capped and kill-switched. Every run is recorded here."
  >
    {#snippet actions()}
      {#if running}<span class="nm-pill" data-state="running">running</span>{/if}
      <a class="nm-btn-ghost" href="/jkai/improvement">Explore the ledger →</a>
    {/snippet}
  </PageHeader>

  <!-- Controls -->
  <section class="nm-sec">
    <div class="nm-sec-hd"><span class="sr-label-tight">Engine</span></div>
    <div class="controls">
      <div class="ctl-block">
        <span class="ctl-label">Nightly runs</span>
        <button
          class="nm-toggle"
          role="switch"
          aria-checked={enabled}
          aria-label="Toggle nightly self-improvement runs"
          onclick={toggleEnabled}
          disabled={toggling}
        ></button>
        <span class="ctl-state">{enabled ? 'Enabled' : 'Paused'}</span>
      </div>

      <div class="ctl-block">
        <span class="ctl-label">Schedule</span>
        <span class="ctl-value mono">{schedule.display}</span>
      </div>

      <div class="ctl-block grow">
        <span class="ctl-label">Manual</span>
        <button class="nm-save-btn" onclick={runNow} disabled={running || starting}>
          {running ? 'Run in progress…' : starting ? 'Starting…' : 'Run now'}
        </button>
        {#if runError}<span class="result-bad">{runError}</span>{/if}
        <span class="ctl-hint">Bypasses the idle gate, keeps budget caps.</span>
      </div>
    </div>
  </section>

  <!-- Latest report -->
  <section class="nm-sec">
    <div class="nm-sec-hd"><span class="sr-label-tight">Latest report</span></div>
    {#if latestReport}
      <pre class="report">{latestReport}</pre>
    {:else if runs.length > 0}
      <div class="nm-empty">The latest run has no report yet — it appears when the run finishes.</div>
    {:else}
      <div class="nm-empty">No runs yet. Trigger one with “Run now”, or wait for the nightly schedule.</div>
    {/if}
  </section>

  <!-- Runs -->
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Runs</span>
      <span class="nm-sec-meta">{runs.length}</span>
    </div>
    {#if runs.length === 0}
      <div class="nm-empty">No runs recorded.</div>
    {:else}
      <div class="table-scroll">
        <table class="nm-table">
          <thead>
            <tr><th>Status</th><th>Trigger</th><th>Started</th><th>Duration</th><th>Cost</th><th>Actions</th><th></th></tr>
          </thead>
          <tbody>
            {#each runs as run (run.runId)}
              <tr class="run-row" onclick={() => toggleRun(run.runId)}>
                <td><span class="nm-pill" data-state={runState(run.data.status)}>{run.data.status}</span></td>
                <td class="mono small">{run.data.trigger}</td>
                <td class="small">{fmtDateTime(run.data.startedAt ?? run.createdAt)}</td>
                <td class="mono small">{duration(run.data)}</td>
                <td class="mono small">{money(run.data.costUsd)}</td>
                <td class="mono small">{run.data.actions?.length ?? 0}</td>
                <td class="mono small chevron">{expandedRunId === run.runId ? '▾' : '▸'}</td>
              </tr>
              {#if expandedRunId === run.runId}
                <tr class="run-detail-row">
                  <td colspan="7">
                    <div class="run-detail">
                      <div class="detail-col">
                        <span class="sr-label-tight">Phases</span>
                        <ul class="phase-list">
                          {#each Object.entries(run.data.phases ?? {}) as [name, p]}
                            <li>
                              <span class="nm-pill" data-state={phaseState(p.status)}>{p.status}</span>
                              <span class="phase-name">{name}</span>
                              {#if p.ms}<span class="phase-ms">{p.ms}ms</span>{/if}
                              {#if p.detail}<span class="phase-detail">{p.detail}</span>{/if}
                            </li>
                          {/each}
                        </ul>
                        <div class="budget mono">
                          {run.data.llmCalls ?? 0} LLM calls · {run.data.tokensIn ?? 0}+{run.data.tokensOut ?? 0} tokens · {money(run.data.costUsd)}
                        </div>
                      </div>
                      <div class="detail-col">
                        <span class="sr-label-tight">Actions</span>
                        {#if (run.data.actions?.length ?? 0) === 0}
                          <div class="nm-empty compact">No actions.</div>
                        {:else}
                          <ul class="action-list">
                            {#each run.data.actions ?? [] as a}
                              <li>
                                <span class="action-kind">{a.kind}</span>
                                <span class="action-detail">{a.detail}</span>
                              </li>
                            {/each}
                          </ul>
                        {/if}
                      </div>
                    </div>
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>

  <!-- Question insights -->
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Question insights</span>
      {#if insights?.period}<span class="nm-sec-meta">{insights.period}</span>{/if}
    </div>
    {#if !insights || ((insights.intents?.length ?? 0) === 0 && (insights.topUnmet?.length ?? 0) === 0)}
      <div class="nm-empty">No insights yet — they’re learned on the first run.</div>
    {:else}
      {#if insights.summary}<p class="insights-summary">{insights.summary}</p>{/if}
      {#if (insights.intents?.length ?? 0) > 0}
        <div class="table-scroll">
          <table class="nm-table">
            <thead>
              <tr><th>Intent</th><th>Count</th><th>Served</th><th>Missing capability</th></tr>
            </thead>
            <tbody>
              {#each insights.intents ?? [] as it}
                <tr>
                  <td>{it.intent}</td>
                  <td class="mono small">{it.count ?? 0}</td>
                  <td>
                    <span class="nm-pill" data-state={it.servedWell ? 'success' : 'warn'}>
                      {it.servedWell ? 'yes' : 'no'}
                    </span>
                  </td>
                  <td class="small muted">{it.missingCapability ?? '—'}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
      {#if (insights.topUnmet?.length ?? 0) > 0}
        <div class="unmet">
          <span class="sr-label-tight">Top unmet needs</span>
          <ul class="unmet-list">
            {#each insights.topUnmet ?? [] as need}
              <li>{need}</li>
            {/each}
          </ul>
        </div>
      {/if}
    {/if}
  </section>

  <!-- API catalogue -->
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">API catalogue</span>
      <span class="nm-sec-meta">{apis.length}</span>
    </div>
    {#if apis.length === 0}
      <div class="nm-empty">Catalogue empty — it’s seeded when the engine first boots.</div>
    {:else}
      <div class="table-scroll">
        <table class="nm-table">
          <thead>
            <tr><th>Name</th><th>Status</th><th>Auth</th><th>Verified</th><th></th></tr>
          </thead>
          <tbody>
            {#each apis as api (api.key)}
              <tr>
                <td>
                  <span class="api-name">{api.data.name ?? api.key}</span>
                  {#if api.data.baseUrl}<span class="api-base mono">{api.data.baseUrl}</span>{/if}
                </td>
                <td><span class="nm-pill" data-state={apiState(api.data.status)}>{api.data.status ?? 'seeded'}</span></td>
                <td class="mono small">{api.data.auth?.kind ?? 'none'}</td>
                <td class="mono small">{api.data.lastVerifiedAt ? fmtDate(api.data.lastVerifiedAt) : '—'}</td>
                <td>
                  <button
                    class="nm-btn-ghost sm"
                    onclick={() => verifyApi(api.key)}
                    disabled={verifyingKey === api.key}
                  >
                    {verifyingKey === api.key ? 'Verifying…' : 'Verify'}
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>

  <!-- Self-built tools -->
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Self-built tools</span>
      <span class="nm-sec-meta">{tools.length}</span>
    </div>
    {#if tools.length === 0}
      <div class="nm-empty">The engine hasn’t built any runtime tools yet.</div>
    {:else}
      <div class="table-scroll">
        <table class="nm-table">
          <thead>
            <tr><th>Name</th><th>Toolset</th><th>Runs</th><th>Errors</th><th>State</th><th></th></tr>
          </thead>
          <tbody>
            {#each tools as t (t.name)}
              <tr>
                <td>
                  <span class="tool-name mono">{t.name}</span>
                  {#if t.description}<span class="tool-desc">{t.description}</span>{/if}
                </td>
                <td class="mono small">{t.toolset}</td>
                <td class="mono small">{t.runCount}</td>
                <td class="mono small">{t.errorCount}</td>
                <td><span class="nm-pill" data-state={t.enabled ? 'success' : 'draft'}>{t.enabled ? 'enabled' : 'disabled'}</span></td>
                <td class="tool-actions">
                  <button class="nm-link-btn" onclick={() => setToolEnabled(t.name, !t.enabled)} disabled={busyTool === t.name}>
                    {t.enabled ? 'Disable' : 'Enable'}
                  </button>
                  <button class="nm-link-btn danger" onclick={() => deleteTool(t.name)} disabled={busyTool === t.name}>Delete</button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p class="muted note">
        Tools the engine ships are enabled and registered live. Manually re-enabling a disabled tool
        takes effect after the next process restart (in-memory registry).
      </p>
    {/if}
  </section>

  <!-- Backlog — the engine's memory between nights -->
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Backlog</span>
      <span class="nm-sec-meta">{openBacklog.length} open / {backlog.length}</span>
    </div>
    {#if backlog.length === 0}
      <div class="nm-empty">Nothing queued yet — the next run will populate this from unmet needs.</div>
    {:else}
      <div class="table-scroll">
        <table class="nm-table">
          <thead>
            <tr><th>Idea</th><th>Kind</th><th>Pri</th><th>Tries</th><th>State</th><th>Last failure</th></tr>
          </thead>
          <tbody>
            {#each backlog as b (b.slug)}
              <tr>
                <td>
                  <span class="tool-name mono">{b.title}</span>
                  {#if b.detail}<span class="tool-desc">{b.detail}</span>{/if}
                  {#if b.prUrl}
                    <a class="nm-link-btn" href={b.prUrl} target="_blank" rel="noreferrer">View PR</a>
                  {/if}
                </td>
                <td class="mono small">{b.kind}</td>
                <td class="mono small">{b.priority}</td>
                <td class="mono small">{b.attempts}</td>
                <td>
                  <span class="nm-pill" data-state={backlogState(b.status)}>{b.status}</span>
                </td>
                <td class="small muted">{b.lastError ?? '—'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>
</PageWrap>

<style>
  .controls { display: flex; flex-wrap: wrap; gap: 1.75rem; align-items: flex-start; }
  .ctl-block { display: flex; flex-direction: column; gap: 0.45rem; }
  .ctl-block.grow { flex: 1; min-width: 220px; }
  .ctl-label {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    color: var(--text-ghost);
  }
  .ctl-value { font-size: 0.9rem; color: var(--text-primary); }
  .ctl-state { font-size: 0.8rem; color: var(--text-muted); }
  .ctl-hint { font-size: 0.75rem; color: var(--text-ghost); }
  .mono { font-family: var(--font-mono); }
  .small { font-size: 0.8rem; }
  .nm-toggle:disabled { opacity: 0.5; cursor: default; }

  .result-bad { font-family: var(--font-mono); font-size: 11px; color: var(--error); }

  .report {
    margin: 0;
    max-height: 320px;
    overflow: auto;
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 1.55;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--text-secondary);
    background: var(--card-bg);
    border: 1px solid var(--divider);
    border-radius: 4px;
    padding: 0.9rem 1rem;
  }

  .table-scroll { overflow-x: auto; }

  .run-row { cursor: pointer; }
  .run-row:hover td { background: var(--accent-tint-08); }
  .chevron { color: var(--text-ghost); text-align: right; }
  .run-detail-row td { background: var(--card-bg); }
  .run-detail {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.5rem;
    padding: 0.85rem 0.5rem 1rem;
  }
  .detail-col { display: flex; flex-direction: column; gap: 0.5rem; min-width: 0; }
  .phase-list, .action-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.4rem; }
  .phase-list li { display: flex; align-items: center; gap: 0.55rem; font-size: 0.8rem; flex-wrap: wrap; }
  .phase-name { color: var(--text-primary); }
  .phase-ms { font-family: var(--font-mono); font-size: 10px; color: var(--text-ghost); }
  .phase-detail { font-size: 0.75rem; color: var(--text-muted); }
  .budget { font-size: 10px; color: var(--text-ghost); margin-top: 0.3rem; }
  .action-list li { display: flex; gap: 0.6rem; font-size: 0.8rem; align-items: baseline; }
  .action-kind {
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--accent);
    white-space: nowrap;
  }
  .action-detail { color: var(--text-secondary); min-width: 0; }

  .insights-summary { margin: 0 0 0.9rem; font-size: 0.9rem; color: var(--text-secondary); max-width: 70ch; }
  .unmet { margin-top: 1rem; }
  .unmet-list { margin: 0.5rem 0 0; padding-left: 1.1rem; display: flex; flex-direction: column; gap: 0.35rem; }
  .unmet-list li { font-size: 0.85rem; color: var(--text-secondary); }

  .api-name, .tool-name { display: block; color: var(--text-primary); font-size: 0.9rem; }
  .api-base { display: block; font-size: 10px; color: var(--text-ghost); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 360px; }
  .tool-desc { display: block; font-size: 0.78rem; color: var(--text-muted); max-width: 480px; }
  .tool-actions { display: flex; gap: 0.75rem; white-space: nowrap; }

  .nm-btn-ghost.sm { padding: 0.25rem 0.6rem; font-size: 0.75rem; }
  .muted { color: var(--text-muted); }
  .muted.note { margin: 0.6rem 0 0; font-size: 0.75rem; }
  .nm-empty.compact { padding: 0.4rem 0; }

  @media (max-width: 640px) {
    .run-detail { grid-template-columns: 1fr; }
  }
</style>
