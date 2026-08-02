<svelte:head><title>Workflow Doctor — Admin</title></svelte:head>
<script lang="ts">
  import { getContext } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import PageWrap from '$lib/components/admin/PageWrap.svelte';
  import PageHeader from '$lib/components/admin/PageHeader.svelte';
  import type { PageData } from './$types';

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
    workflowsFailing?: number;
    autoApplyEnabled?: boolean;
    breakerEnabled?: boolean;
    fixesApplied?: number;
    fixesReverted?: number;
    schedulesQuarantined?: number;
    proposalsOpened?: number;
    whatsappDelivered?: boolean;
    actions?: RunAction[];
    report?: string;
  };
  type RunView = { runId: string | null; createdAt: string | Date; data: RunData };
  type FindingView = PageData['findings'][number];
  type Switch = 'enabled' | 'autoApply' | 'breaker';

  let { data }: { data: PageData } = $props();
  const adminToken = getContext<string>('adminToken');
  const tokenQs = adminToken ? `?token=${adminToken}` : '';

  const schedule = $derived(data.schedule);
  const caps = $derived(data.caps);
  const runs = $derived(data.runs as RunView[]);
  const findings = $derived(data.findings);
  const latestReport = $derived(runs.length > 0 ? (runs[0].data.report ?? '') : '');

  // The undo list: only a fix that is still in effect can be taken back.
  const applied = $derived(findings.filter((f) => f.status === 'auto_fixed'));
  const open = $derived(
    findings.filter((f) => f.status === 'proposed' || f.status === 'refused_sensitive'),
  );

  // The switches render from server truth and are re-read after every write, so
  // a change made in another tab (or by the engine's own settings read) cannot
  // be masked by a stale local copy of a boolean that governs writes.
  const enabled = $derived(data.enabled);
  const breaker = $derived(data.breaker);
  const autoApply = $derived(data.autoApply);

  let toggling = $state<Switch | null>(null);
  let toggleError = $state('');
  let starting = $state(false);
  let runError = $state('');
  let busyKey = $state<string | null>(null);
  let findingError = $state('');
  let findingNote = $state('');
  /** Which of the two finding tables the last verdict came from — the result
   *  belongs next to the button that was pressed, not at the top of the page. */
  let noteScope = $state<'applied' | 'open' | null>(null);
  let expandedRunId = $state<string | null>(null);

  // `data.running` is the server's truth; `startedHere` covers the gap between
  // clicking Run now and the first reload landing. Both feed one derived flag so
  // the poll effect below reads exactly one thing.
  let startedHere = $state(false);
  const running = $derived(data.running || startedHere);

  // Re-load the page data every 10s ONLY while a run is live. The interval
  // handle is a local const inside the effect (never $state) and torn down on
  // cleanup / when `running` flips false — svelte5-pitfalls rule 1.
  $effect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      void refresh();
    }, 10_000);
    return () => clearInterval(timer);
  });

  async function refresh() {
    try {
      await invalidateAll();
      // Server truth takes over from the optimistic flag once it has arrived.
      startedHere = false;
    } catch {
      /* transient — the next tick retries */
    }
  }

  async function setSwitch(field: Switch, next: boolean) {
    if (field === 'autoApply' && next) {
      const ok = confirm(
        'Arm auto-apply?\n\nThe doctor will edit workflow node configuration unattended at ' +
          `${schedule.display}, without asking. It stays inside the fix whitelist and reverts ` +
          'anything that does not measurably improve, but the writes are real.',
      );
      if (!ok) return;
    }
    toggling = field;
    toggleError = '';
    try {
      const res = await fetch(`/api/admin/doctor/toggle${tokenQs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) await invalidateAll();
      else toggleError = body.error ?? `Error ${res.status}`;
    } catch {
      toggleError = 'Network error';
    } finally {
      toggling = null;
    }
  }

  async function runNow() {
    starting = true;
    runError = '';
    try {
      const res = await fetch(`/api/admin/doctor/run${tokenQs}`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        startedHere = true; // starts the poll effect
        await invalidateAll();
      } else {
        runError = body.error ?? `Error ${res.status}`;
      }
    } catch {
      runError = 'Network error';
    } finally {
      starting = false;
    }
  }

  async function act(f: FindingView, action: 'accept' | 'dismiss' | 'revert') {
    if (action === 'revert') {
      const what =
        f.revertKind === 'schedule'
          ? `Re-enable the schedule on ${subject(f)}?\n\nIt was paused because it failed every run. If the canvas is still broken it will start failing again immediately.`
          : `Undo this fix on ${subject(f)}?\n\nIt restores ${f.changedFields.join(', ') || 'the previous config'} and will 409 rather than overwrite any edit you have made since.`;
      if (!confirm(what)) return;
    }
    busyKey = f.key;
    findingError = '';
    findingNote = '';
    noteScope = action === 'revert' ? 'applied' : 'open';
    try {
      const res = await fetch(`/api/admin/doctor/finding${tokenQs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: f.key, action }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        findingNote = body.message ?? `Marked ${body.status ?? action}.`;
        await invalidateAll();
      } else {
        findingError = body.error ?? `Error ${res.status}`;
      }
    } catch {
      findingError = 'Network error';
    } finally {
      busyKey = null;
    }
  }

  function toggleRun(runId: string | null) {
    if (!runId) return;
    expandedRunId = expandedRunId === runId ? null : runId;
  }

  // ——— Helpers ———
  function subject(f: FindingView): string {
    return f.canvasSlug ?? f.workflowName;
  }
  function target(f: FindingView): string {
    return f.nodeLabel ?? f.nodeType ?? (f.revertKind === 'schedule' ? 'schedule' : 'run');
  }
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
  function findingState(s: string): string {
    switch (s) {
      case 'auto_fixed':
      case 'resolved':
        return 'success';
      case 'accepted':
        return 'done';
      case 'reverted':
        return 'warn';
      case 'refused_sensitive':
        return 'error';
      case 'dismissed':
        return 'draft';
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
</script>

<PageWrap width="wide">
  <PageHeader
    kicker="AI"
    title="Workflow Doctor"
    sub="Nightly triage of failed workflow runs: it groups the failures, lints the saved graph, explains each one in plain English, and repairs what it can safely repair. Two of its three switches govern whether it may write."
  >
    {#snippet actions()}
      {#if running}<span class="nm-pill" data-state="running">running</span>{/if}
      <a class="nm-btn-ghost" href="/jkai/doctor">Read the report →</a>
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
          aria-label="Toggle nightly workflow doctor runs"
          onclick={() => setSwitch('enabled', !enabled)}
          disabled={toggling !== null}
        ></button>
        <span class="ctl-state">{enabled ? 'Enabled' : 'Paused'}</span>
      </div>

      <div class="ctl-block">
        <span class="ctl-label">Schedule</span>
        <span class="ctl-value mono">{schedule.display}</span>
        <span class="ctl-hint">Skipped if you were active in the last hour.</span>
      </div>

      <div class="ctl-block grow">
        <span class="ctl-label">Manual</span>
        <button class="nm-save-btn" onclick={runNow} disabled={running || starting}>
          {running ? 'Run in progress…' : starting ? 'Starting…' : 'Run now'}
        </button>
        {#if runError}<span class="result-bad">{runError}</span>{/if}
        <span class="ctl-hint">Bypasses the idle gate, keeps every budget and write cap.</span>
      </div>
    </div>
    {#if toggleError}<p class="banner banner-error">{toggleError}</p>{/if}
  </section>

  <!-- Write permissions — the two switches that decide whether a night can change anything -->
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Write permissions</span>
      <span class="nm-sec-meta">what the doctor may change without you</span>
    </div>

    <div class="perm">
      <div class="perm-hd">
        <button
          class="nm-toggle"
          role="switch"
          aria-checked={breaker}
          aria-label="Toggle the runaway-schedule circuit breaker"
          onclick={() => setSwitch('breaker', !breaker)}
          disabled={toggling !== null}
        ></button>
        <span class="perm-title">Circuit breaker</span>
        <span class="nm-pill" data-state={breaker ? 'success' : 'draft'}>
          {breaker ? 'armed' : 'off'}
        </span>
        <span class="perm-default mono">on by default</span>
      </div>
      <p class="perm-copy">
        Pauses a cron schedule that has failed {caps.breakerFailures} times in a row with no
        successes in between, by setting <code>workflow_schedules.enabled = false</code>. It never
        touches node configuration, and every pause is listed below with an undo.
      </p>
    </div>

    <div class="perm perm-danger">
      <div class="perm-hd">
        <button
          class="nm-toggle"
          role="switch"
          aria-checked={autoApply}
          aria-label="Toggle unattended auto-apply of node config fixes"
          onclick={() => setSwitch('autoApply', !autoApply)}
          disabled={toggling !== null}
        ></button>
        <span class="perm-title">Auto-apply config fixes</span>
        <span class="nm-pill" data-state={autoApply ? 'warn' : 'draft'}>
          {autoApply ? 'armed' : 'off'}
        </span>
        <span class="perm-default mono">off by default</span>
      </div>
      <p class="banner banner-warn">
        Permits unattended writes to workflow definitions. With this on, the {schedule.display} run
        edits <code>workflow_nodes.config</code> on live canvases with no approval step.
      </p>
      <p class="perm-copy">
        Only an explicit switch-on arms it — unset reads as off, and it re-reads that every night.
        Writes stay inside the fix whitelist, are capped at {caps.workflows} canvases /
        {caps.fixes} fixes a night, skip any canvas a human touched in the last {caps.quietHours}
        hours, refuse outright on a node holding a credential, and are reverted immediately if the
        lint error count does not fall. With it off the doctor still triages, lints, diagnoses and
        proposes — the full report, no blast radius.
      </p>
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
            <tr>
              <th>Status</th><th>Trigger</th><th>Started</th><th>Duration</th>
              <th>Failing</th><th>Fixed</th><th>Cost</th><th>Writes</th><th></th>
            </tr>
          </thead>
          <tbody>
            {#each runs as run (run.runId)}
              <tr class="run-row" onclick={() => toggleRun(run.runId)}>
                <td><span class="nm-pill" data-state={runState(run.data.status)}>{run.data.status}</span></td>
                <td class="mono small">{run.data.trigger}</td>
                <td class="small">{fmtDateTime(run.data.startedAt ?? run.createdAt)}</td>
                <td class="mono small">{duration(run.data)}</td>
                <td class="mono small">{run.data.workflowsFailing ?? 0}</td>
                <td class="mono small">
                  {(run.data.fixesApplied ?? 0) + (run.data.schedulesQuarantined ?? 0)}
                </td>
                <td class="mono small">{money(run.data.costUsd)}</td>
                <td class="mono small">
                  <!-- A shadow night looked identical to a night with nothing to
                       fix until this column existed. -->
                  {run.data.autoApplyEnabled ? 'auto' : run.data.breakerEnabled ? 'breaker' : 'none'}
                </td>
                <td class="mono small chevron">{expandedRunId === run.runId ? '▾' : '▸'}</td>
              </tr>
              {#if expandedRunId === run.runId}
                <tr class="run-detail-row">
                  <td colspan="9">
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
                        <div class="budget mono">
                          summary to WhatsApp: {run.data.whatsappDelivered ? 'delivered' : 'not delivered'}
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

  <!-- Applied fixes — the undo list -->
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Applied fixes</span>
      <span class="nm-sec-meta">{applied.length} in effect</span>
    </div>
    {#if noteScope === 'applied' && findingNote}<p class="banner banner-success">{findingNote}</p>{/if}
    {#if noteScope === 'applied' && findingError}<p class="banner banner-error">{findingError}</p>{/if}
    {#if applied.length === 0}
      <div class="nm-empty">Nothing has been changed automatically.</div>
    {:else}
      <div class="table-scroll">
        <table class="nm-table">
          <thead>
            <tr><th>Canvas</th><th>Fix</th><th>Changed</th><th>Lint</th><th>Applied</th><th></th></tr>
          </thead>
          <tbody>
            {#each applied as f (f.key)}
              <tr>
                <td>
                  <span class="subject">{subject(f)}</span>
                  <span class="target mono">{target(f)}</span>
                </td>
                <td>
                  <span class="nm-pill" data-state={findingState(f.status)}>{f.fixKindLabel}</span>
                  <span class="fix-text">{f.fix}</span>
                </td>
                <td class="mono small">
                  <!-- Field NAMES only. The old values stay on the server: a
                       before-image is the exact payload we refuse to republish. -->
                  {f.revertKind === 'schedule' ? 'schedule paused' : f.changedFields.join(', ') || '—'}
                </td>
                <td class="mono small">
                  {#if f.verifyBefore !== undefined && f.verifyAfter !== undefined}
                    {f.verifyBefore} → {f.verifyAfter}
                  {:else}
                    —
                  {/if}
                </td>
                <td class="small">{fmtDateTime(f.updatedAt)}</td>
                <td>
                  <button
                    class="nm-link-btn danger"
                    onclick={() => act(f, 'revert')}
                    disabled={busyKey === f.key || !f.revertKind}
                  >
                    {f.revertKind === 'schedule' ? 'Re-enable' : 'Revert'}
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>

  <!-- Open findings — everything the doctor would not touch on its own -->
  <section class="nm-sec">
    <div class="nm-sec-hd">
      <span class="sr-label-tight">Open findings</span>
      <span class="nm-sec-meta">{open.length}</span>
    </div>
    {#if noteScope === 'open' && findingNote}<p class="banner banner-success">{findingNote}</p>{/if}
    {#if noteScope === 'open' && findingError}<p class="banner banner-error">{findingError}</p>{/if}
    {#if open.length === 0}
      <div class="nm-empty">Nothing open. A finding closes itself when its failure stops arriving.</div>
    {:else}
      <div class="table-scroll">
        <table class="nm-table">
          <thead>
            <tr><th>Canvas</th><th>Kind</th><th>Symptom</th><th>Seen</th><th>Last</th><th></th></tr>
          </thead>
          <tbody>
            {#each open as f (f.key)}
              <tr>
                <td>
                  <span class="subject">{subject(f)}</span>
                  <span class="target mono">{target(f)}</span>
                </td>
                <td>
                  <span class="nm-pill" data-state={findingState(f.status)}>{f.fixKindLabel}</span>
                </td>
                <td class="cell-prose">
                  <span class="fix-text">{f.symptom}</span>
                  {#if f.status === 'refused_sensitive'}
                    <span class="refusal">
                      Refused: this node holds a credential{f.sensitiveFields?.length
                        ? ` in ${f.sensitiveFields.join(', ')}`
                        : ''}. Delete the node and recreate it — patching it republishes the value
                      through the workflow audit log.
                    </span>
                  {:else}
                    <span class="muted small">{f.fix}</span>
                  {/if}
                </td>
                <td class="mono small">{f.occurrences}</td>
                <td class="small">{fmtDateTime(f.lastSeen)}</td>
                <td class="row-actions">
                  <button class="nm-link-btn" onclick={() => act(f, 'accept')} disabled={busyKey === f.key}>
                    Accept
                  </button>
                  <button class="nm-link-btn" onclick={() => act(f, 'dismiss')} disabled={busyKey === f.key}>
                    Dismiss
                  </button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p class="muted note">
        Accept records that you intend to fix it yourself; Dismiss stops it being re-proposed. Both
        verdicts stick — a later run updates the occurrence count but not the status.
      </p>
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

  .perm { padding: 0.9rem 0; }
  .perm + .perm { border-top: 1px solid var(--divider); }
  .perm-hd { display: flex; align-items: center; gap: 0.7rem; flex-wrap: wrap; }
  .perm-title { font-size: 0.95rem; color: var(--text-primary); }
  .perm-default {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-ghost);
  }
  .perm-copy {
    margin: 0.55rem 0 0;
    font-size: 0.8rem;
    line-height: 1.55;
    color: var(--text-muted);
    max-width: 78ch;
  }
  .perm-danger .perm-title { color: var(--warn); }
  .perm .banner { margin: 0.6rem 0 0; }
  code {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--text-secondary);
  }

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

  .subject { display: block; color: var(--text-primary); font-size: 0.9rem; }
  .target { display: block; font-size: 10px; color: var(--text-ghost); }
  .fix-text { display: block; font-size: 0.78rem; color: var(--text-muted); max-width: 52ch; }
  .cell-prose { min-width: 260px; }
  .refusal {
    display: block;
    margin-top: 0.3rem;
    padding-left: 0.6rem;
    border-left: 2px solid var(--error);
    font-size: 0.78rem;
    color: var(--error);
    max-width: 52ch;
  }
  .row-actions { display: flex; gap: 0.75rem; white-space: nowrap; }

  .muted { color: var(--text-muted); }
  .muted.note { margin: 0.6rem 0 0; font-size: 0.75rem; }
  .nm-empty.compact { padding: 0.4rem 0; }

  @media (max-width: 640px) {
    .run-detail { grid-template-columns: 1fr; }
  }
</style>
