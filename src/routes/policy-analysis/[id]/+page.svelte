<script lang="ts">
  // The assessment, read as a dashboard rather than as a database.
  //
  // The reader is a policy professional deciding whether a paper is safe to send
  // out, not an engineer inspecting artefacts. So the page is ordered as an
  // argument — verdict, then how the policy can be beaten, then who would beat
  // it, then where it is structurally thin, then what breaks it, then what the
  // evidence actually supports — and every section can be opened down to the
  // sentence in the document it came from through ONE inspector.
  //
  // Nothing here decides what matters: the shaping lives in
  // `$lib/policy-analysis/view`, so it is testable without mounting anything.
  import { onMount, tick } from 'svelte';
  import { invalidateAll } from '$app/navigation';
  import type { PageData } from './$types';
  import * as view from '$lib/policy-analysis/view';
  import AssessmentBody from '$lib/components/policy-analysis/AssessmentBody.svelte';
  import { printNow, wirePrint } from '$lib/policy-analysis/print';
  import PolicyGraph from '$lib/components/policy-analysis/PolicyGraph.svelte';
  import ArtefactValue from '$lib/components/policy-analysis/ArtefactValue.svelte';
  import { formatGbp, formatTokens } from '$lib/canvas/stats/costFormat';

  let { data }: { data: PageData } = $props();

  let selectedId = $state<string | null>(null);
  let busy = $state(false);
  let message = $state('');
  let refreshError = $state('');
  let now = $state(Date.now());
  let audit = $state<unknown>(null);
  let openLog = $state(false);
  let confirmDelete = $state(false);
  // Where focus was when the inspector opened. Not $state: nothing reactive
  // reads it, and a DOM node in reactive state is a proxy waiting to happen.
  let opener: HTMLElement | null = null;

  const active = $derived(['queued', 'running'].includes(data.analysis.status));
  const completed = $derived(data.stages.filter((s) => s.status === 'completed').length);
  const artefacts = $derived(data.artefacts);
  const warnings = $derived(data.stages.flatMap((s) => s.warnings.map((w) => ({ stage: s.name, text: w }))));
  const crossUnavailable = $derived(warnings.some((w) => w.text.includes('No other completed policy assessment')));
  const selected = $derived(artefacts.find((a) => a.id === selectedId) ?? null);
  const running = $derived(data.stages.find((s) => s.status === 'running') ?? null);
  // A stage that fans out over twenty passages sat on "2 of 13" for its whole
  // life. The model-call rows already knew how far in it was.
  const runningCalls = $derived(running ? data.calls.filter((c) => data.executions.some((e) => e.id === c.executionId && e.stageId === running.id)).length : 0);
  const cost = $derived(view.runCost(data.calls));
  // What the reader ASKED for, which is not always what answered — a submission
  // that named no model resolves the research-deep workload, and the run log
  // below carries the model each call actually used.
  const commissioned = $derived([
    data.analysis.model ? data.analysis.model.replace(/^codex\//, '') : null,
    data.analysis.thinkingLevel ? `thinking ${data.analysis.thinkingLevel}` : null,
  ].filter(Boolean).join(' · '));
  const provenance = $derived(data.artefactMetadata.find((a) => a.id === selectedId) ?? null);

  const fmt = (v: Date | string | null) => (v ? new Date(v).toLocaleString() : 'Not yet');
  const pct = (v: number | null) => (v === null ? 'unknown' : `${Math.round(v * 100)}%`);

  function inspect(id: string) {
    if (!selectedId && document.activeElement instanceof HTMLElement) opener = document.activeElement;
    selectedId = id;
    window.history.replaceState(null, '', `#${encodeURIComponent(id)}`);
    void tick().then(() => {
      const panel = document.getElementById('policy-inspector');
      panel?.scrollIntoView({ block: 'nearest' });
      panel?.focus({ preventScroll: true });
    });
  }

  /** Closing must hand focus back, or the keyboard reader lands at the top of the page. */
  function closeInspector() {
    selectedId = null;
    void tick().then(() => { opener?.focus(); opener = null; });
  }

  async function destroy() {
    busy = true; message = '';
    try {
      const response = await fetch(`/api/policy-analysis/${data.analysis.id}`, { method: 'DELETE' });
      if (!response.ok) { message = 'Could not delete this assessment.'; return; }
      window.location.href = '/policy-analysis';
    } catch { message = 'Connection interrupted. The assessment may not have been deleted.'; }
    finally { busy = false; }
  }

  async function refresh() {
    try { await invalidateAll(); refreshError = ''; }
    catch { refreshError = 'Progress could not refresh. The background run is independent of this connection.'; }
  }

  onMount(() => {
    // A hash is either a section — a deep link into a workspace that may not be
    // the selected one — or an artefact to open in the inspector. Never both.
    const hash = decodeURIComponent(window.location.hash.slice(1));
    if (hash && !view.isSectionHash(hash)) selectedId = hash;
    // Timer handles are deliberately plain `let`: nothing reactive reads them,
    // and making them $state would subscribe this effect to its own writes.
    let stopped = false;
    const ticker = setInterval(() => { now = Date.now(); }, 1000);
    let polling: ReturnType<typeof setTimeout>;
    async function poll() {
      if (stopped) return;
      if (active && !document.hidden) await refresh();
      if (!stopped) polling = setTimeout(poll, 6000);
    }
    polling = setTimeout(poll, 6000);
    // Ctrl+P must get the same document the button produces.
    const unwirePrint = wirePrint();
    return () => { stopped = true; clearInterval(ticker); clearTimeout(polling); unwirePrint(); };
  });

  async function control(action: 'cancel' | 'resume') {
    busy = true; message = '';
    try {
      const response = await fetch(`/api/policy-analysis/${data.analysis.id}/${action}`, { method: 'POST' });
      if (!response.ok) { message = (await response.json()).error ?? 'Could not update this run.'; return; }
      await refresh();
    } catch { message = 'Connection interrupted. Refresh to check the saved run state.'; }
    finally { busy = false; }
  }

  /**
   * Share links.
   *
   * The RAW token exists for exactly one moment — the response to the mint —
   * and is never stored, so `justMinted` is the only place the URL will ever
   * appear. Say so on the page rather than letting somebody navigate away and
   * come back looking for it.
   */
  let shares = $state<{ id: string; label: string | null; createdAt: string; expiresAt: string; revokedAt: string | null; lastUsedAt: string | null; useCount: number; live: boolean }[]>([]);
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
    } catch { /* the panel simply stays empty */ }
  }

  async function mintShare() {
    busy = true; message = ''; copied = false;
    try {
      const response = await fetch(`/api/policy-analysis/${data.analysis.id}/shares`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: shareLabel.trim() || null, expiresInDays: shareDays }),
      });
      const body = await response.json();
      if (!response.ok) { message = body.error ?? 'The link could not be created.'; return; }
      justMinted = { url: body.url, expiresAt: body.expiresAt };
      shareLabel = '';
      await loadShares();
    } catch { message = 'Connection interrupted. Refresh to see whether the link was created.'; }
    finally { busy = false; }
  }

  async function revokeShare(shareId: string) {
    busy = true; message = '';
    try {
      const response = await fetch(`/api/policy-analysis/${data.analysis.id}/shares`, {
        method: 'DELETE', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ shareId }),
      });
      if (!response.ok) { message = 'The link could not be revoked.'; return; }
      await loadShares();
    } catch { message = 'Connection interrupted. Refresh to check whether the link was revoked.'; }
    finally { busy = false; }
  }

  async function showAudit(id: string) {
    try {
      const response = await fetch(`/api/policy-analysis/${data.analysis.id}/audit?call=${id}`);
      if (!response.ok) throw new Error();
      audit = await response.json();
    } catch { message = 'Could not load this model call.'; }
  }
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape' && selectedId) { e.preventDefault(); closeInspector(); } }} />
<svelte:head><title>{data.analysis.title} — Policy analysis</title><meta name="robots" content="noindex,nofollow" /></svelte:head>

<a href="/policy-analysis">← All policy analyses</a>
<p class="eyebrow">{data.analysis.jurisdiction ?? 'Jurisdiction not specified'} · {data.analysis.policyArea ?? 'Policy assessment'} · {data.analysis.depth === 'deep' ? 'Deep enquiry' : 'Standard enquiry'}</p>
<h1>{data.analysis.title}</h1>
<p class="standfirst">
  A red-team assessment: how this policy can be beaten by the people it governs, who would do it, and what
  the evidence does and does not support. It is written to find weaknesses, not to assure the paper.
</p>

<section class="progress" aria-label="Analysis progress">
  <div class="toolbar">
    <strong role="status">{data.analysis.status.replaceAll('_', ' ')}</strong>
    <span>{completed} of {data.stages.length} stages complete</span>
    <button class="nm-save-btn" onclick={refresh}>Refresh</button>
    <button class="nm-save-btn" onclick={printNow}>Print or save as PDF</button>
    {#if active}<button class="nm-save-btn" disabled={busy} onclick={() => control('cancel')}>Cancel run</button>{/if}
    {#if ['failed', 'cancelled'].includes(data.analysis.status)}<button class="nm-save-btn" disabled={busy} onclick={() => control('resume')}>Resume from the last completed stage</button>{/if}
  </div>
  <progress max={data.stages.length} value={completed} aria-label="Completed stages"></progress>
  <p class="muted">
    {Math.max(0, Math.floor(((data.analysis.completedAt ? new Date(data.analysis.completedAt).getTime() : now) - new Date(data.analysis.createdAt).getTime()) / 60000))} minutes elapsed · {data.calls.length} model call{data.calls.length === 1 ? '' : 's'} · last update {fmt(data.heartbeat ?? data.analysis.updatedAt)}
  </p>
  {#if running}<p class="muted">Now running <strong>{running.name}</strong>{#if runningCalls}{' — '}{runningCalls} model call{runningCalls === 1 ? '' : 's'} made so far in this stage{/if}.</p>{/if}
  {#if cost.calls}
    <p class="spend">
      <span class="sr-label">{active ? 'Spent so far' : 'What it cost'}</span>
      <strong>{formatTokens(cost.total)} tokens</strong>
      <span class="muted">
        {formatTokens(cost.input)} in · {formatTokens(cost.output)} out{#if cost.reasoning} · {formatTokens(cost.reasoning)} reasoning{/if}{#if cost.cached} · {formatTokens(cost.cached)} read from cache{/if}
      </span>
      <span class="muted">·</span>
      <!-- Codex prices as null, never zero: it is subscription quota, not cash,
           and "£0.00" would read as free money rather than as a bill nobody sent. -->
      <span class="muted">{cost.cash === null ? 'on subscription quota, no cash cost' : formatGbp(cost.cash)}</span>
      {#if commissioned}<span class="muted">· {commissioned}</span>{/if}
    </p>
  {/if}
  {#if active}<p>You can close this page. Every stage is saved as it finishes and the run recovers from a restart on its own.</p>{/if}
  {#if data.analysis.error}<p class="warning" role="alert">{data.analysis.error}</p>{/if}
  {#if message || refreshError}<p class="warning" role="alert">{message || refreshError}</p>{/if}
  <details open={completed < data.stages.length}>
    <summary>Stage by stage</summary>
    <ol class="stages">
      {#each data.stages as stage (stage.id)}
        <li class:done={stage.status === 'completed'} class:failed={stage.status === 'failed'}>
          <strong>{stage.name}</strong>
          <span>{stage.status === 'pending' ? 'not started' : stage.status}{stage.attempts ? ` · ${stage.attempts} failed attempt${stage.attempts === 1 ? '' : 's'}` : ''}</span>
          {#if stage.startedAt}<span class="muted">{fmt(stage.startedAt)}{#if stage.completedAt} → {fmt(stage.completedAt)}{/if}</span>{/if}
          {#if stage.error}<span class="warning">{stage.error}</span>{/if}
        </li>
      {/each}
    </ol>
  </details>
  {#if warnings.length}
    <details>
      <summary>{warnings.length} thing{warnings.length === 1 ? '' : 's'} this assessment could not establish</summary>
      <ul class="gaps">{#each warnings as w, i (i)}<li><span class="muted">{w.stage}</span> {w.text}</li>{/each}</ul>
    </details>
  {/if}
</section>

{#if ['completed', 'completed_with_gaps'].includes(data.analysis.status)}
  <section class="share" aria-label="Share this assessment">
    <p class="sr-label">Send it to someone</p>
    <p class="muted">
      A link lets a colleague read this assessment without an account. It carries the report, the playbook,
      the actors, the checks and the stress test — never the uploaded paper, never your other assessments,
      never the run log. Every link has an expiry date and can be revoked here.
    </p>
    <div class="toolbar">
      <label class="sr-label" for="share-label">Who is it for</label>
      <input class="nm-text-input" id="share-label" bind:value={shareLabel} maxlength="80" placeholder="A note to yourself — the recipient never sees it" />
      <label class="sr-label" for="share-days">Expires in</label>
      <select class="nm-text-input" id="share-days" bind:value={shareDays}>
        <option value={7}>7 days</option>
        <option value={30}>30 days</option>
        <option value={90}>90 days</option>
        <option value={365}>a year</option>
      </select>
      <button class="nm-save-btn" disabled={busy} onclick={mintShare}>Create a link</button>
      {#if !sharesLoaded}<button class="link" onclick={loadShares}>Show existing links</button>{/if}
    </div>

    {#if justMinted}
      <div class="minted">
        <p class="sr-label">Copy it now — it is not shown again</p>
        <p class="url">{justMinted.url}</p>
        <div class="toolbar">
          <button class="nm-save-btn" onclick={async () => { await navigator.clipboard.writeText(justMinted!.url); copied = true; }}>{copied ? 'Copied' : 'Copy link'}</button>
          <span class="muted">Stops working on {fmt(justMinted.expiresAt)}. Only the link is a secret; nothing else identifies the reader.</span>
        </div>
      </div>
    {/if}

    {#if shares.length}
      <table class="shares">
        <thead><tr><th scope="col">Label</th><th scope="col">Created</th><th scope="col">Expires</th><th scope="col">Opened</th><th scope="col"></th></tr></thead>
        <tbody>
          {#each shares as share (share.id)}
            <tr class:dead={!share.live}>
              <td>{share.label ?? 'unlabelled'}</td>
              <td>{fmt(share.createdAt)}</td>
              <td>{share.revokedAt ? 'revoked' : fmt(share.expiresAt)}</td>
              <td>{share.useCount}{#if share.lastUsedAt}, last {fmt(share.lastUsedAt)}{/if}</td>
              <td>{#if share.live}<button class="link" disabled={busy} onclick={() => revokeShare(share.id)}>Revoke</button>{/if}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {:else if sharesLoaded}
      <p class="muted">No link has been created for this assessment.</p>
    {/if}
  </section>
{/if}

{#snippet runLog()}
  <section id="provenance" class="section">
    <p class="kicker">Run log and provenance</p>
    <h2>Everything behind the page</h2>
    <p class="strap">
      Every completed stage has an immutable execution record; every model call keeps its prompt version,
      input, output, provider and reported usage. Provider secrets and raw errors are excluded.
    </p>

    <details>
      <summary>The policy as a graph</summary>
      <PolicyGraph {artefacts} {inspect} />
    </details>

    {#each data.documents as document (document.id)}
      <div class="ruled">
        <a href={`/api/policy-analysis/${data.analysis.id}/document`}>Download {document.filename}</a>
        <p class="muted">{document.mimeType} · {document.size.toLocaleString()} bytes · SHA-256 {document.sha256}</p>
        <details><summary>Document structure and extraction metadata</summary><ArtefactValue value={document.metadata} all={artefacts} {inspect} /></details>
      </div>
    {/each}

    <div class="danger">
      <p class="sr-label">Remove it</p>
      <p class="muted">Deletes the uploaded paper, every artefact, the provenance graph and the model-call audit. It cannot be undone.</p>
      {#if confirmDelete}
        <div class="toolbar">
          <button class="nm-save-btn" disabled={busy} onclick={destroy}>Yes, delete “{data.analysis.title}” permanently</button>
          <button class="link" onclick={() => (confirmDelete = false)}>Keep it</button>
        </div>
      {:else}
        <button class="link" onclick={() => (confirmDelete = true)}>Delete this assessment and its document</button>
      {/if}
    </div>

    {#if cost.models.length}
      <div class="ruled">
        <p class="sr-label">Tokens by model</p>
        <table class="spend-table">
          <thead><tr><th scope="col">Model</th><th scope="col">Calls</th><th scope="col">In</th><th scope="col">Out</th></tr></thead>
          <tbody>
            {#each cost.models as m (m.model)}
              <tr><td>{m.model}</td><td>{m.calls}</td><td>{formatTokens(m.input)}</td><td>{formatTokens(m.output)}</td></tr>
            {/each}
          </tbody>
          <tfoot>
            <tr><td>Total across {cost.calls} call{cost.calls === 1 ? '' : 's'}</td><td>{cost.models.reduce((n, m) => n + m.calls, 0)}</td><td>{formatTokens(cost.input)}</td><td>{formatTokens(cost.output)}</td></tr>
          </tfoot>
        </table>
        <p class="muted">
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
            <p class="muted">{execution.status} · {fmt(execution.startedAt)} → {fmt(execution.completedAt)}</p>
            {#if execution.error}<p>{execution.error}</p>{/if}
          </div>
        {/each}
        {#each data.calls as call (call.id)}
          <div class="ruled">
            <button class="link" onclick={() => showAudit(call.id)}>{call.callKey} · {call.status}</button>
            <p class="muted">{call.promptVersion} · {call.provider ?? 'provider not reported'} · {call.model ?? 'model not resolved'} · {fmt(call.startedAt)}</p>
            {#if call.error}<p class="warning">{call.error}</p>{/if}
          </div>
        {/each}
        {#if audit}<details open><summary>Model call audit</summary><pre>{JSON.stringify(audit, null, 2)}</pre></details>{/if}
      {/if}
    </details>
  </section>
{/snippet}

<AssessmentBody
  {artefacts}
  status={data.analysis.status}
  {inspect}
  personas={data.personas ?? []}
  cross={{ inbound: data.inbound ?? [], unavailable: crossUnavailable }}
  {runLog}
/>

{#if selected}
  <aside id="policy-inspector" tabindex="-1" class="inspector" aria-label="Evidence inspector">
    <div class="toolbar">
      <strong>{selected.label}</strong>
      <button class="nm-save-btn" onclick={closeInspector}>Close</button>
    </div>
    <p class="kicker-sm">{selected.kind.replaceAll('_', ' ')} · {selected.origin.replaceAll('_', ' ')}</p>
    <p>{selected.statement}</p>
    {#if provenance}<p class="muted">Produced in stage {provenance.stage + 1} · updated {fmt(provenance.updatedAt)}</p>{/if}
    <p class="muted">Confidence {pct(selected.confidence)} — a model or extraction judgement, not a calibrated probability · {selected.id}</p>
    {#if selected.page || selected.section}
      <p class="muted">{selected.page ? `Page ${selected.page} · ` : ''}{selected.section ?? ''}{selected.startOffset !== null ? ` · characters ${selected.startOffset}–${selected.endOffset}` : ''}</p>
    {/if}
    {#if selected.sourceQuote}<blockquote>{selected.sourceQuote}</blockquote>{/if}
    {#if selected.url}<a href={selected.url} target="_blank" rel="noopener noreferrer">Open external source</a>{/if}
    {#if selected.refs.length}
      <p class="sr-label">Rests on</p>
      <div class="refs">
        {#each selected.refs as ref (ref)}
          <button class="link" onclick={() => inspect(ref)}>↗ {artefacts.find((a) => a.id === ref)?.label ?? ref}</button>
        {/each}
      </div>
    {/if}
    <details><summary>All structured fields</summary><ArtefactValue value={selected.data} all={artefacts} {inspect} /></details>
  </aside>
{/if}

<style>
  .standfirst { font-size: var(--fs-body-lg); color: var(--text-secondary); max-width: 60ch; }
  .share { border-bottom: 2px solid var(--text-primary); padding: 1rem 0 1.25rem; }
  .share .muted { max-width: 72ch; }
  .share input, .share select { max-width: 22rem; }
  .minted { border-left: 3px solid var(--accent); padding: .6rem 0 .6rem 1rem; margin: .75rem 0; }
  .url { font-family: var(--font-mono); font-size: var(--fs-label); overflow-wrap: anywhere; margin: 0; }
  .shares { border-collapse: collapse; margin-top: 1rem; font-size: var(--fs-label); width: 100%; }
  .shares th, .shares td { text-align: left; padding: .35rem .9rem .35rem 0; border-bottom: 1px solid var(--line); }
  .shares th { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: var(--tracking-label); text-transform: uppercase; color: var(--text-muted); }
  .shares tr.dead { color: var(--text-muted); }
  .progress { border-top: 2px solid var(--text-primary); border-bottom: 2px solid var(--text-primary); padding: .75rem 0 1.25rem; margin-top: 1.5rem; }
  .spend { display: flex; flex-wrap: wrap; align-items: baseline; gap: .5rem; margin: .35rem 0 0; }
  .spend strong { font-family: var(--font-mono); }
  .spend-table { border-collapse: collapse; margin: .5rem 0; font-size: var(--fs-body-sm); }
  .spend-table th, .spend-table td { text-align: left; padding: .3rem .9rem .3rem 0; border-bottom: 1px solid var(--line); }
  .spend-table td:not(:first-child), .spend-table th:not(:first-child) { font-family: var(--font-mono); text-align: right; }
  .spend-table tfoot td { border-bottom: none; border-top: 1px solid var(--line-strong); font-weight: 600; }
  progress { width: 100%; height: .65rem; accent-color: var(--accent); }
  progress::-webkit-progress-bar { background: var(--surface-sunken); }
  progress::-webkit-progress-value { background: var(--accent); }
  progress::-moz-progress-bar { background: var(--accent); }
  summary { cursor: pointer; padding: .7rem 0; font-weight: 600; }
  .stages { padding-left: 1.5rem; margin: 0; }
  .stages li { border-bottom: 1px solid var(--line); padding: .55rem 0; }
  .stages li.done { color: var(--text-secondary); }
  .stages li.failed strong { color: var(--accent); }
  .stages span { display: block; margin-top: .25rem; font-size: var(--fs-label); }
  .gaps { padding-left: 1.25rem; margin: 0; }
  .gaps li { padding: .35rem 0; }

  .rail { display: flex; flex-wrap: wrap; gap: 1px; background: var(--line-strong); border: 1px solid var(--line-strong); margin: 1.5rem 0 0; position: sticky; top: var(--site-nav-height, 0); z-index: 4; }
  .wtab { flex: 1 1 auto; display: flex; align-items: baseline; gap: .5rem; background: var(--bg); border: 0; padding: .7rem .9rem; font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: var(--tracking-label); text-transform: uppercase; color: var(--text-secondary); cursor: pointer; white-space: nowrap; text-align: left; }
  .wtab:hover { background: var(--surface-sunken); color: var(--text-primary); }
  .wtab.on { background: var(--accent); color: var(--bg); }
  .wtab.on .letter { color: var(--bg); }
  .wtab:focus-visible { outline: 2px solid var(--accent-ink); outline-offset: -3px; }
  .rail-strap { margin: .5rem 0 0; }
  .workspace { min-width: 0; }
  .letter { color: var(--accent); }
  .anchor { scroll-margin-top: 4rem; }

  .section { border-top: 2px solid var(--text-primary); margin-top: 3rem; padding-top: 1.5rem; scroll-margin-top: 4rem; }
  .kicker { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: var(--tracking-label); text-transform: uppercase; color: var(--accent); margin: 0 0 .5rem; }
  .kicker-sm { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: var(--tracking-label); text-transform: uppercase; color: var(--text-muted); margin: 0 0 .3rem; }
  .strap { color: var(--text-secondary); max-width: 62ch; }
  .sr-label { font-family: var(--font-mono); font-size: var(--fs-label-xs); letter-spacing: var(--tracking-label); text-transform: uppercase; color: var(--text-muted); margin: 0 0 .5rem; }

  .filter { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; margin: 1.5rem 0 1rem; }
  .filter button { font: inherit; font-family: var(--font-mono); font-size: var(--fs-label); background: var(--surface-sunken); border: 1px solid var(--line-strong); padding: .35rem .7rem; cursor: pointer; text-transform: capitalize; }
  .filter button.on { background: var(--text-primary); color: var(--bg); }
  .plays { display: grid; gap: 1rem; }

  .fragile { margin-top: 1.5rem; border-left: 3px solid var(--accent); padding-left: 1rem; }
  .fragile ol { margin: 0; padding-left: 1.1rem; }
  .fragile li { padding: .5rem 0; }
  .models { margin-top: 1.5rem; }
  .models ul { list-style: none; padding: 0; margin: 0; }
  .models li { border-bottom: 1px solid var(--line); padding: .5rem 0; display: flex; flex-wrap: wrap; gap: .6rem; align-items: baseline; text-transform: capitalize; }

  .recommendations { margin-bottom: 2rem; }
  .rec { border: 1px solid var(--line-strong); border-left: 3px solid var(--accent-ink); padding: 1rem 1.15rem; margin-bottom: 1rem; }
  .rec h3, .chapter h3 { font-size: var(--fs-body-lg); font-weight: 700; margin: 0 0 .4rem; }
  .chapter { border-top: 1px solid var(--line-strong); padding: 1rem 0; }
  .finding { padding: .5rem 0; }

  .empty { border-left: 2px solid var(--line-strong); padding-left: 1rem; color: var(--text-secondary); }
  .link { font: inherit; font-family: var(--font-mono); font-size: var(--fs-label); background: none; border: 0; padding: 0; color: var(--accent-ink); text-decoration: underline; cursor: pointer; text-align: left; overflow-wrap: anywhere; }

  /* Printing is how this leaves the building. The chrome, the controls and the
     run log go; the argument, every play and every chapter stay, and links show
     their target so a printed copy is still traceable. */
  @media print {
    :global(.policy-page) { max-width: none; padding: 0; }
    .rail, .rail-strap, .progress, .filter, .danger, .inspector { display: none !important; }
    /* Every workspace is already in the DOM; a printed pack wants all four. */
    .workspace[hidden] { display: block !important; }
    #provenance { display: none; }
    .section { break-inside: auto; page-break-inside: auto; border-top: 1px solid #000; }
    :global(.policy-page details) { display: block; }
    :global(.policy-page details > summary) { display: none; }
    :global(.policy-page a[href^="http"]::after) { content: " (" attr(href) ")"; font-size: 10pt; word-break: break-all; }
    :global(.policy-page button) { display: none; }
  }

  .inspector { position: sticky; bottom: 0; margin-top: 2rem; padding: 1.2rem; border: 2px solid var(--accent-ink); background: var(--surface-elevated, var(--bg)); overflow-wrap: anywhere; max-height: 70vh; overflow-y: auto; }
  .refs { display: flex; flex-wrap: wrap; gap: .75rem; }
  .danger { border: 1px solid var(--line-strong); border-left: 3px solid var(--error); padding: 1rem 1.15rem; margin: 1.5rem 0; }
  blockquote { border-left: 2px solid var(--accent); padding-left: 1rem; white-space: pre-wrap; margin: .75rem 0; }
  pre { max-height: 32rem; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-family: var(--font-code); font-size: var(--fs-label); }
</style>
