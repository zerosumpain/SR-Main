<script lang="ts">
  // The assessment, read as a dashboard rather than as a report.
  //
  // The reader is a policy professional deciding whether a paper is safe to send
  // out — often NOT the person who wrote it, which is the assumption this page
  // now makes everywhere. So the page opens the way `/research` opens: an ink
  // lede band carrying the title, the standing frame and a ledger of the figures
  // that decide whether to read on, then the workspaces, then one drill that
  // reaches every artefact's provenance.
  //
  // Nothing here decides what matters. The shaping lives in
  // `$lib/policy-analysis/{view,actors,network}`, so it is testable without
  // mounting anything, and `AssessmentBody` is shared with the anonymous shared
  // copy so the two cannot drift into different reports.
  import { onMount } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import type { PageData } from './$types';
  import * as view from '$lib/policy-analysis/view';
  import AssessmentBody from '$lib/components/policy-analysis/AssessmentBody.svelte';
  import { printNow, wirePrint } from '$lib/policy-analysis/print';
  import PolicyGraph from '$lib/components/policy-analysis/PolicyGraph.svelte';
  import ArtefactValue from '$lib/components/policy-analysis/ArtefactValue.svelte';
  import { formatGbp, formatTokens } from '$lib/canvas/stats/costFormat';

  let { data }: { data: PageData } = $props();

  let busy = $state(false);
  let message = $state('');
  let refreshError = $state('');
  let now = $state(Date.now());
  let audit = $state<unknown>(null);
  let openLog = $state(false);
  let confirmDelete = $state(false);
  let exporting = $state(false);

  const active = $derived(['queued', 'running'].includes(data.analysis.status));
  const finished = $derived(['completed', 'completed_with_gaps'].includes(data.analysis.status));
  const completed = $derived(data.stages.filter((s) => s.status === 'completed').length);
  const artefacts = $derived(data.artefacts);
  const warnings = $derived(data.stages.flatMap((s) => s.warnings.map((w) => ({ stage: s.name, text: w }))));
  const crossUnavailable = $derived(warnings.some((w) => w.text.includes('No other completed policy assessment')));
  const running = $derived(data.stages.find((s) => s.status === 'running') ?? null);
  // A stage that fans out over twenty passages sat on "2 of 13" for its whole
  // life. The model-call rows already knew how far in it was.
  const runningCalls = $derived(
    running ? data.calls.filter((c) => data.executions.some((e) => e.id === c.executionId && e.stageId === running.id)).length : 0,
  );
  const cost = $derived(view.runCost(data.calls));
  const plays = $derived(view.plays(artefacts));
  const elapsed = $derived(
    Math.max(
      0,
      Math.floor(
        ((data.analysis.completedAt ? new Date(data.analysis.completedAt).getTime() : now) -
          new Date(data.analysis.createdAt).getTime()) /
          60000,
      ),
    ),
  );
  // What the reader ASKED for, which is not always what answered — a submission
  // that named no model resolves the research-deep workload, and the run log
  // below carries the model each call actually used.
  const commissioned = $derived(
    [
      data.analysis.model ? data.analysis.model.replace(/^codex\//, '') : null,
      data.analysis.thinkingLevel ? `thinking ${data.analysis.thinkingLevel}` : null,
    ]
      .filter(Boolean)
      .join(' · '),
  );

  const fmt = (v: Date | string | null) => (v ? new Date(v).toLocaleString() : 'Not yet');
  const hhmm = (minutes: number) => (minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`);

  async function destroy() {
    busy = true;
    message = '';
    try {
      const response = await fetch(`/api/policy-analysis/${data.analysis.id}`, { method: 'DELETE' });
      if (!response.ok) {
        message = 'Could not delete this assessment.';
        return;
      }
      window.location.href = '/policy-analysis';
    } catch {
      message = 'Connection interrupted. The assessment may not have been deleted.';
    } finally {
      busy = false;
    }
  }

  async function refresh() {
    try {
      await invalidateAll();
      refreshError = '';
    } catch {
      refreshError = 'Progress could not refresh. The background run is independent of this connection.';
    }
  }

  /**
   * Download the Word copy.
   *
   * Rendered server-side, so this is a navigation rather than a fetch — the
   * browser's own save dialog is a better download UI than anything built here,
   * and `docx` is a server dependency that would blow the client budget.
   * `exporting` exists only so the button can say something during the round
   * trip; a 400-page assessment takes a moment to render.
   */
  function exportDoc(format: 'docx' | 'md') {
    exporting = true;
    window.location.href = `/api/policy-analysis/${data.analysis.id}/export?format=${format}`;
    setTimeout(() => (exporting = false), 4000);
  }

  onMount(() => {
    // Timer handles are deliberately plain `let`: nothing reactive reads them,
    // and making them $state would subscribe this effect to its own writes.
    let stopped = false;
    const ticker = setInterval(() => {
      now = Date.now();
    }, 1000);
    let polling: ReturnType<typeof setTimeout>;
    async function poll() {
      if (stopped) return;
      if (active && !document.hidden) await refresh();
      if (!stopped) polling = setTimeout(poll, 6000);
    }
    polling = setTimeout(poll, 6000);
    // Ctrl+P must get the same document the button produces.
    const unwirePrint = wirePrint();
    return () => {
      stopped = true;
      clearInterval(ticker);
      clearTimeout(polling);
      unwirePrint();
    };
  });

  async function control(action: 'cancel' | 'resume') {
    busy = true;
    message = '';
    try {
      const response = await fetch(`/api/policy-analysis/${data.analysis.id}/${action}`, { method: 'POST' });
      if (!response.ok) {
        message = (await response.json()).error ?? 'Could not update this run.';
        return;
      }
      await refresh();
    } catch {
      message = 'Connection interrupted. Refresh to check the saved run state.';
    } finally {
      busy = false;
    }
  }

  /**
   * Share links.
   *
   * The RAW token exists for exactly one moment — the response to the mint — and
   * is never stored, so `justMinted` is the only place the URL will ever appear.
   * Say so on the page rather than letting somebody navigate away and come back
   * looking for it.
   */
  let shares = $state<
    { id: string; label: string | null; createdAt: string; expiresAt: string; revokedAt: string | null; lastUsedAt: string | null; useCount: number; live: boolean }[]
  >([]);
  let sharesLoaded = $state(false);
  let justMinted = $state<{ url: string; expiresAt: string } | null>(null);
  let shareLabel = $state('');
  let shareDays = $state(30);
  let copied = $state(false);

  async function loadShares() {
    try {
      const response = await fetch(`/api/policy-analysis/${data.analysis.id}/shares`);
      if (!response.ok) return;
      shares = (await response.json()).shares ?? [];
      sharesLoaded = true;
    } catch {
      /* the panel simply stays empty */
    }
  }

  async function mintShare() {
    busy = true;
    message = '';
    copied = false;
    try {
      const response = await fetch(`/api/policy-analysis/${data.analysis.id}/shares`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: shareLabel.trim() || null, expiresInDays: shareDays }),
      });
      const body = await response.json();
      if (!response.ok) {
        message = body.error ?? 'The link could not be created.';
        return;
      }
      justMinted = { url: body.url, expiresAt: body.expiresAt };
      shareLabel = '';
      await loadShares();
    } catch {
      message = 'Connection interrupted. Refresh to see whether the link was created.';
    } finally {
      busy = false;
    }
  }

  async function revokeShare(shareId: string) {
    busy = true;
    message = '';
    try {
      const response = await fetch(`/api/policy-analysis/${data.analysis.id}/shares`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ shareId }),
      });
      if (!response.ok) {
        message = 'The link could not be revoked.';
        return;
      }
      await loadShares();
    } catch {
      message = 'Connection interrupted. Refresh to check whether the link was revoked.';
    } finally {
      busy = false;
    }
  }

  async function showAudit(id: string) {
    try {
      const response = await fetch(`/api/policy-analysis/${data.analysis.id}/audit?call=${id}`);
      if (!response.ok) throw new Error();
      audit = await response.json();
    } catch {
      message = 'Could not load this model call.';
    }
  }
</script>

<svelte:head>
  <title>{data.analysis.title} — Policy analysis</title>
  <meta name="robots" content="noindex,nofollow" />
</svelte:head>

<!--
  THE LEDE BAND. `/research` opens the same way and for the same reason: the
  three things a reader needs before deciding to read on — what this is, what it
  found, and whether it finished — belong above everything, on ink, in one
  eyeful. The ledger cells are counts, never machinery: "eleven of thirteen
  stages" tells a reader nothing they can act on.
-->
<div class="pa-lede" role="banner">
  <div class="pa-lede-inner">
    <div class="pa-lede-copy">
      <p class="pa-eyebrow">
        {data.analysis.jurisdiction ?? 'Jurisdiction not specified'} · {data.analysis.policyArea ?? 'Policy assessment'} ·
        {data.analysis.depth === 'deep' ? 'Deep enquiry' : 'Standard enquiry'}
      </p>
      <h1>{data.analysis.title}</h1>
      <p class="pa-standfirst">
        A red-team assessment — how this paper can be beaten, by whom, and what the evidence does and does
        not support.
      </p>
    </div>

    <dl class="pa-ledger">
      <div>
        <dt>Status</dt>
        <dd class:state-done={finished} class:state-failed={data.analysis.status === 'failed'}>
          {data.analysis.status.replaceAll('_', ' ')}
        </dd>
        <small>{completed} of {data.stages.length} stages · {hhmm(elapsed)}</small>
      </div>
      <div>
        <dt>Ways to beat it</dt>
        <dd>{plays.length}</dd>
        <small>
          {plays.filter((p) => p.band === 'severe' || p.band === 'significant').length} above moderate
        </small>
      </div>
      <div>
        <dt>Bodies profiled</dt>
        <dd>{view.of(artefacts, 'profile').length}</dd>
        <small>{view.of(artefacts, 'actor').filter((a) => a.id.startsWith('s2_')).length} named in the paper</small>
      </div>
      <div>
        <dt>Open questions</dt>
        <dd>{warnings.length}</dd>
        <small>things it could not establish</small>
      </div>
    </dl>
  </div>
</div>

<!--
  THE ACTION BAR. Every control the page has, in one strip, in the order a reader
  reaches for them: take it away, share it, then the run's own machinery. Export
  and print lead because they are what a finished assessment is FOR.
-->
<div class="pa-bar">
  <div class="pa-bar-group">
    <button class="pa-btn pa-primary" disabled={exporting} onclick={() => exportDoc('docx')}>
      {exporting ? 'Rendering…' : '↓ Word (.docx)'}
    </button>
    <button class="pa-btn" onclick={printNow}>Print or save as PDF</button>
    <button class="pa-btn pa-ghost" onclick={() => exportDoc('md')}>Markdown</button>
  </div>
  <div class="pa-bar-group pa-bar-right">
    {#if active}
      <span class="pa-live" role="status">
        <span class="pa-dot"></span>
        {running ? running.name : 'running'}{#if runningCalls}
          · {runningCalls} call{runningCalls === 1 ? '' : 's'} so far{/if}
      </span>
      <button class="pa-btn" onclick={refresh}>Refresh</button>
      <button class="pa-btn" disabled={busy} onclick={() => control('cancel')}>Cancel run</button>
    {:else if ['failed', 'cancelled'].includes(data.analysis.status)}
      <button class="pa-btn" disabled={busy} onclick={() => control('resume')}>Resume from the last completed stage</button>
    {/if}
    {#if cost.calls}
      <span class="pa-cost">
        {formatTokens(cost.total)} tokens ·
        {cost.cash === null ? 'on subscription quota' : formatGbp(cost.cash)}
        {#if commissioned}· {commissioned}{/if}
      </span>
    {/if}
  </div>
</div>

{#if data.analysis.error}<p class="pa-alert" role="alert">{data.analysis.error}</p>{/if}
{#if message || refreshError}<p class="pa-alert" role="alert">{message || refreshError}</p>{/if}
{#if active}
  <p class="pa-progress-note">
    <progress max={data.stages.length} value={completed} aria-label="Completed stages"></progress>
    You can close this page. Every stage is saved as it finishes and the run recovers from a restart on its
    own.
  </p>
{/if}

{#snippet runLog()}
  <section id="run-log" class="pa-section">
    <p class="pa-kicker">Run log and provenance</p>
    <h2>Everything behind the page</h2>
    <p class="pa-strap">
      Every completed stage has an immutable execution record; every model call keeps its prompt version,
      input, output, provider and reported usage. Provider secrets and raw errors are excluded.
    </p>

    <ol class="pa-stages">
      {#each data.stages as stage (stage.id)}
        <li class:done={stage.status === 'completed'} class:failed={stage.status === 'failed'}>
          <strong>{stage.name}</strong>
          <span>
            {stage.status === 'pending' ? 'not started' : stage.status}{stage.attempts
              ? ` · ${stage.attempts} failed attempt${stage.attempts === 1 ? '' : 's'}`
              : ''}
          </span>
          {#if stage.startedAt}
            <span class="pa-muted">{fmt(stage.startedAt)}{#if stage.completedAt} → {fmt(stage.completedAt)}{/if}</span>
          {/if}
          {#if stage.error}<span class="pa-alert-inline">{stage.error}</span>{/if}
        </li>
      {/each}
    </ol>

    {#if warnings.length}
      <details>
        <summary>{warnings.length} thing{warnings.length === 1 ? '' : 's'} this assessment could not establish</summary>
        <ul class="pa-gaps">
          {#each warnings as w, i (i)}<li><span class="pa-muted">{w.stage}</span> {w.text}</li>{/each}
        </ul>
      </details>
    {/if}

    <details>
      <summary>The policy as a graph</summary>
      <PolicyGraph {artefacts} inspect={() => {}} />
    </details>

    {#each data.documents as document (document.id)}
      <div class="ruled">
        <a href={`/api/policy-analysis/${data.analysis.id}/document`}>Download {document.filename}</a>
        <p class="pa-muted">{document.mimeType} · {document.size.toLocaleString()} bytes · SHA-256 {document.sha256}</p>
        <details>
          <summary>Document structure and extraction metadata</summary>
          <ArtefactValue value={document.metadata} all={artefacts} inspect={() => {}} />
        </details>
      </div>
    {/each}

    {#if cost.models.length}
      <div class="ruled">
        <p class="pa-label">Tokens by model</p>
        <table class="pa-table">
          <thead><tr><th scope="col">Model</th><th scope="col">Calls</th><th scope="col">In</th><th scope="col">Out</th></tr></thead>
          <tbody>
            {#each cost.models as m (m.model)}
              <tr><td>{m.model}</td><td>{m.calls}</td><td>{formatTokens(m.input)}</td><td>{formatTokens(m.output)}</td></tr>
            {/each}
          </tbody>
          <tfoot>
            <tr>
              <td>Total across {cost.calls} call{cost.calls === 1 ? '' : 's'}</td>
              <td>{cost.models.reduce((n, m) => n + m.calls, 0)}</td>
              <td>{formatTokens(cost.input)}</td>
              <td>{formatTokens(cost.output)}</td>
            </tr>
          </tfoot>
        </table>
        <!-- Codex prices as null, never zero: it is subscription quota, not cash,
             and "£0.00" would read as free money rather than as a bill nobody sent. -->
        <p class="pa-muted">
          {cost.cash === null
            ? 'Every call was served on subscription quota, so there is no cash figure to report — that is not the same as zero.'
            : `Reported cost ${formatGbp(cost.cash)}, converted from USD at the site rate.`}
        </p>
      </div>
    {/if}

    <details bind:open={openLog}>
      <summary>{data.calls.length} model calls across {data.executions.length} executions</summary>
      {#if openLog}
        {#each data.executions as execution (execution.id)}
          <div class="ruled">
            <strong>{data.stages.find((s) => s.id === execution.stageId)?.name}</strong>
            <p class="pa-muted">{execution.status} · {fmt(execution.startedAt)} → {fmt(execution.completedAt)}</p>
            {#if execution.error}<p>{execution.error}</p>{/if}
          </div>
        {/each}
        {#each data.calls as call (call.id)}
          <div class="ruled">
            <button class="pa-link" onclick={() => showAudit(call.id)}>{call.callKey} · {call.status}</button>
            <p class="pa-muted">
              {call.promptVersion} · {call.provider ?? 'provider not reported'} · {call.model ?? 'model not resolved'} ·
              {fmt(call.startedAt)}
            </p>
            {#if call.error}<p class="pa-alert-inline">{call.error}</p>{/if}
          </div>
        {/each}
        {#if audit}
          <details open><summary>Model call audit</summary><pre>{JSON.stringify(audit, null, 2)}</pre></details>
        {/if}
      {/if}
    </details>

    {#if finished}
      <div class="pa-share">
        <p class="pa-label">Send it to someone</p>
        <p class="pa-muted">
          A link lets a colleague read this assessment without an account. It carries the report, the
          playbook, the actors, the checks and the stress test — never the uploaded paper, never your other
          assessments, never this run log. Every link has an expiry date and can be revoked here.
        </p>
        <div class="toolbar">
          <label class="pa-label" for="share-label">Who is it for</label>
          <input class="nm-text-input" id="share-label" bind:value={shareLabel} maxlength="80" placeholder="A note to yourself — the recipient never sees it" />
          <label class="pa-label" for="share-days">Expires in</label>
          <select class="nm-text-input" id="share-days" bind:value={shareDays}>
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
            <option value={365}>a year</option>
          </select>
          <button class="pa-btn" disabled={busy} onclick={mintShare}>Create a link</button>
          {#if !sharesLoaded}<button class="pa-link" onclick={loadShares}>Show existing links</button>{/if}
        </div>

        {#if justMinted}
          <div class="pa-minted">
            <p class="pa-label">Copy it now — it is not shown again</p>
            <p class="pa-url">{justMinted.url}</p>
            <div class="toolbar">
              <button
                class="pa-btn"
                onclick={async () => {
                  await navigator.clipboard.writeText(justMinted!.url);
                  copied = true;
                }}>{copied ? 'Copied' : 'Copy link'}</button
              >
              <span class="pa-muted">
                Stops working on {fmt(justMinted.expiresAt)}. Only the link is a secret; nothing else identifies
                the reader.
              </span>
            </div>
          </div>
        {/if}

        {#if shares.length}
          <table class="pa-table">
            <thead>
              <tr><th scope="col">Label</th><th scope="col">Created</th><th scope="col">Expires</th><th scope="col">Opened</th><th scope="col"></th></tr>
            </thead>
            <tbody>
              {#each shares as share (share.id)}
                <tr class:dead={!share.live}>
                  <td>{share.label ?? 'unlabelled'}</td>
                  <td>{fmt(share.createdAt)}</td>
                  <td>{share.revokedAt ? 'revoked' : fmt(share.expiresAt)}</td>
                  <td>{share.useCount}{#if share.lastUsedAt}, last {fmt(share.lastUsedAt)}{/if}</td>
                  <td>{#if share.live}<button class="pa-link" disabled={busy} onclick={() => revokeShare(share.id)}>Revoke</button>{/if}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        {:else if sharesLoaded}
          <p class="pa-muted">No link has been created for this assessment.</p>
        {/if}
      </div>
    {/if}

    <div class="pa-danger">
      <p class="pa-label">Remove it</p>
      <p class="pa-muted">
        Deletes the uploaded paper, every artefact, the provenance graph and the model-call audit. It cannot
        be undone.
      </p>
      {#if confirmDelete}
        <div class="toolbar">
          <button class="pa-btn" disabled={busy} onclick={destroy}>Yes, delete “{data.analysis.title}” permanently</button>
          <button class="pa-link" onclick={() => (confirmDelete = false)}>Keep it</button>
        </div>
      {:else}
        <button class="pa-link" onclick={() => (confirmDelete = true)}>Delete this assessment and its document</button>
      {/if}
    </div>
  </section>
{/snippet}

<AssessmentBody
  {artefacts}
  status={data.analysis.status}
  personas={data.personas ?? []}
  cross={{ inbound: data.inbound ?? [], unavailable: crossUnavailable }}
  provenance={data.artefactMetadata}
  {runLog}
/>

<style>
  /* ——— the ink lede band ——————————————————————————————————————— */
  .pa-lede {
    /* Bleeds to the page edge through the wrapper's own padding, the way the
       research report's does — a band inset by 2.75rem reads as a card. */
    margin: calc(clamp(1rem, 3vw, 2.75rem) * -1) calc(clamp(1rem, 3vw, 2.75rem) * -1) 0;
    padding: clamp(26px, 3.4vw, 46px) clamp(20px, 3vw, 44px);
    background: var(--text-primary);
    color: var(--bg);
    border-bottom: 1px solid rgba(237, 228, 212, 0.16);
  }
  .pa-lede-inner {
    display: grid;
    grid-template-columns: minmax(0, 1.15fr) minmax(360px, 0.85fr);
    align-items: end;
    gap: clamp(28px, 5vw, 64px);
  }
  .pa-lede-copy {
    min-width: 0;
  }
  .pa-eyebrow {
    margin: 0 0 12px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label-wide);
    text-transform: uppercase;
    color: var(--accent-on-dark);
  }
  .pa-lede h1 {
    margin: 0;
    font-family: var(--font-display);
    font-size: clamp(2rem, 4.2vw, 4rem);
    font-weight: 900;
    line-height: 0.94;
    letter-spacing: -0.03em;
    color: var(--bg);
    overflow-wrap: anywhere;
    text-wrap: balance;
  }
  .pa-standfirst {
    margin: 15px 0 0;
    font-size: var(--fs-body-sm);
    line-height: 1.55;
    color: rgba(237, 228, 212, 0.72);
    max-width: 56ch;
  }

  .pa-ledger {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0;
    margin: 0;
    border-top: 1px solid rgba(237, 228, 212, 0.16);
    border-left: 1px solid rgba(237, 228, 212, 0.16);
  }
  .pa-ledger > div {
    min-width: 0;
    padding: 12px 14px;
    border-right: 1px solid rgba(237, 228, 212, 0.16);
    border-bottom: 1px solid rgba(237, 228, 212, 0.16);
    background: rgba(237, 228, 212, 0.04);
  }
  .pa-ledger dt {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label-wide);
    text-transform: uppercase;
    color: rgba(237, 228, 212, 0.52);
  }
  .pa-ledger dd {
    margin: 7px 0 4px;
    overflow: hidden;
    font-family: var(--font-display);
    font-size: clamp(1.4rem, 2.1vw, 2rem);
    line-height: 0.95;
    letter-spacing: -0.025em;
    text-transform: uppercase;
    color: var(--bg);
    text-overflow: ellipsis;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .pa-ledger dd.state-done {
    color: var(--good-on-dark);
  }
  .pa-ledger dd.state-failed {
    color: #e08b8b;
  }
  .pa-ledger small {
    display: block;
    overflow: hidden;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    line-height: 1.3;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--accent-on-dark);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ——— the action bar ——————————————————————————————————————— */
  .pa-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 12px 20px;
    padding: 12px 0;
    border-bottom: 1px solid var(--line-strong);
  }
  .pa-bar-group {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 9px;
  }
  .pa-bar-right {
    margin-left: auto;
  }
  .pa-btn {
    font: inherit;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    background: none;
    border: 1px solid var(--line-strong);
    border-radius: 0;
    padding: 8px 13px;
    color: var(--text-primary);
    cursor: pointer;
  }
  .pa-btn:hover:not(:disabled),
  .pa-btn:focus-visible {
    border-color: var(--accent);
    color: var(--accent);
  }
  .pa-btn:disabled {
    color: var(--text-ghost);
    border-color: var(--divider);
    cursor: default;
  }
  .pa-primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg);
  }
  .pa-primary:hover:not(:disabled),
  .pa-primary:focus-visible {
    background: var(--accent-hover);
    border-color: var(--accent-hover);
    color: var(--bg);
  }
  .pa-ghost {
    border-color: transparent;
    color: var(--accent-ink);
    text-decoration: underline;
    padding-inline: 4px;
  }

  .pa-live {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--accent);
  }
  .pa-dot {
    width: 5px;
    height: 5px;
    border-radius: 100px;
    background: var(--accent);
    animation: pa-pulse 1.6s ease-in-out infinite;
  }
  @keyframes pa-pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.3;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .pa-dot {
      animation: none;
    }
  }
  .pa-cost {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.05em;
    color: var(--text-ghost);
  }

  .pa-alert {
    background: var(--surface-sunken);
    border-left: 3px solid var(--accent);
    padding: 11px 14px;
    margin: 14px 0 0;
  }
  .pa-alert-inline {
    color: var(--accent);
  }
  .pa-progress-note {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    margin: 14px 0 0;
    font-size: var(--fs-label);
    color: var(--text-muted);
  }
  progress {
    width: 12rem;
    height: 0.55rem;
    accent-color: var(--accent);
  }

  /* ——— the run log ——————————————————————————————————————— */
  .pa-section {
    padding-top: 20px;
  }
  .pa-kicker,
  .pa-label {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--accent);
    margin: 0 0 9px;
  }
  .pa-label {
    color: var(--text-muted);
  }
  .pa-strap {
    color: var(--text-secondary);
    max-width: 66ch;
  }
  .pa-muted {
    color: var(--text-muted);
    font-size: var(--fs-label);
    line-height: 1.55;
    max-width: 76ch;
  }
  .pa-stages {
    list-style: none;
    padding: 0;
    margin: 20px 0 0;
    border-top: 1px solid var(--line-strong);
  }
  .pa-stages li {
    border-bottom: 1px solid var(--line);
    padding: 9px 0;
  }
  .pa-stages li.done {
    color: var(--text-secondary);
  }
  .pa-stages li.failed strong {
    color: var(--accent);
  }
  .pa-stages span {
    display: block;
    margin-top: 4px;
    font-size: var(--fs-label);
  }
  .pa-gaps {
    padding-left: 20px;
    margin: 0;
  }
  .pa-gaps li {
    padding: 6px 0;
  }

  .pa-table {
    border-collapse: collapse;
    margin: 9px 0;
    width: 100%;
    font-size: var(--fs-label);
  }
  .pa-table th,
  .pa-table td {
    text-align: left;
    padding: 6px 14px 6px 0;
    border-bottom: 1px solid var(--line);
  }
  .pa-table thead th {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: var(--tracking-label);
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .pa-table tfoot td {
    border-bottom: none;
    border-top: 1px solid var(--line-strong);
    font-weight: 600;
  }
  .pa-table tr.dead {
    color: var(--text-muted);
  }

  .pa-share {
    border-top: 1px solid var(--line-strong);
    margin-top: 26px;
    padding-top: 18px;
  }
  .pa-share input,
  .pa-share select {
    max-width: 22rem;
  }
  .pa-minted {
    border-left: 3px solid var(--accent);
    padding: 9px 0 9px 16px;
    margin: 13px 0;
  }
  .pa-url {
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    overflow-wrap: anywhere;
    margin: 0;
  }

  .pa-danger {
    border: 1px solid var(--line-strong);
    border-left: 3px solid var(--error);
    padding: 15px 17px;
    margin: 26px 0 0;
  }
  .pa-link {
    font: inherit;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    background: none;
    border: 0;
    border-radius: 0;
    padding: 0;
    color: var(--accent-ink);
    text-decoration: underline;
    cursor: pointer;
    text-align: left;
    overflow-wrap: anywhere;
  }
  pre {
    max-height: 32rem;
    overflow: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-family: var(--font-code);
    font-size: var(--fs-label);
  }
  summary {
    cursor: pointer;
    padding: 11px 0;
    font-weight: 600;
  }

  @media (max-width: 1000px) {
    .pa-lede-inner {
      grid-template-columns: minmax(0, 1fr);
      gap: 26px;
    }
    .pa-ledger {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }
  @media (max-width: 720px) {
    .pa-ledger {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .pa-bar-right {
      margin-left: 0;
    }
  }

  /*
   * PRINT. The band, the controls and the run log go; the argument stays. The
   * ledger survives as plain figures — a printed assessment still has to say
   * what it found on page one.
   */
  @media print {
    .pa-lede {
      margin: 0;
      padding: 0 0 12pt;
      background: #fff !important;
      color: #000;
      border-bottom: 2px solid #000;
    }
    .pa-lede h1,
    .pa-ledger dd {
      color: #000;
    }
    .pa-eyebrow,
    .pa-ledger small {
      color: #000;
    }
    .pa-standfirst,
    .pa-ledger dt {
      color: #333;
    }
    .pa-ledger > div {
      background: none;
      border-color: #999;
    }
    .pa-ledger {
      border-color: #999;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      break-inside: avoid;
    }
    /* No strip to fit on paper, so nothing is clipped: "completed" and
       "9 named in the paper" print in full rather than as an ellipsis. */
    .pa-ledger dd,
    .pa-ledger small {
      overflow: visible;
      white-space: normal;
      text-overflow: clip;
    }
    .pa-bar,
    .pa-progress-note,
    .pa-share,
    .pa-danger {
      display: none !important;
    }
    #run-log {
      display: none !important;
    }
  }
</style>
