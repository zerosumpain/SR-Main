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
  import { REPORT_SECTIONS } from '$lib/policy-analysis/contracts';
  import * as view from '$lib/policy-analysis/view';
  import type { Band } from '$lib/policy-analysis/view';
  import ArtefactValue from '$lib/components/policy-analysis/ArtefactValue.svelte';
  import PolicyGraph from '$lib/components/policy-analysis/PolicyGraph.svelte';
  import Verdict from '$lib/components/policy-analysis/Verdict.svelte';
  import ExposurePlot from '$lib/components/policy-analysis/ExposurePlot.svelte';
  import PlayCard from '$lib/components/policy-analysis/PlayCard.svelte';
  import CheckGrid from '$lib/components/policy-analysis/CheckGrid.svelte';
  import ActorBoard from '$lib/components/policy-analysis/ActorBoard.svelte';
  import EvidenceMix from '$lib/components/policy-analysis/EvidenceMix.svelte';
  import CrossPolicy from '$lib/components/policy-analysis/CrossPolicy.svelte';
  import ReportActs from '$lib/components/policy-analysis/ReportActs.svelte';
  import StressTest from '$lib/components/policy-analysis/StressTest.svelte';
  import InterplayMap from '$lib/components/policy-analysis/InterplayMap.svelte';
  import ScenarioWalk from '$lib/components/policy-analysis/ScenarioWalk.svelte';
  import { formatGbp, formatTokens } from '$lib/canvas/stats/costFormat';

  let { data }: { data: PageData } = $props();

  let selectedId = $state<string | null>(null);
  let bandFilter = $state<Band | null>(null);
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

  /**
   * Four workspaces, not nine stacked sections.
   *
   * Nine chapters end to end is an inventory of what the pipeline produced. A
   * reader arrives with one of four questions — what does it say, who can beat
   * it, what is it standing on, and show me the working — and each is a place to
   * sit and do a piece of work rather than a heading to scroll past. Every
   * section keeps its own id, heading and deep link inside its workspace; the
   * grouping is navigation, not editing, exactly as the report's acts are.
   *
   * Every panel stays in the DOM. Find-in-page reaches a workspace nobody
   * selected, and printing unhides all four.
   */
  const WORKSPACES = [
    { id: 'verdict', name: 'The verdict', strap: 'What this assessment concludes.', sections: ['verdict'] },
    { id: 'threat', name: 'The threat', strap: 'Who can beat this policy, how, and what they are aiming at.', sections: ['playbook', 'interplay', 'actors'] },
    { id: 'ground', name: 'What it rests on', strap: 'The assumptions holding it up — and what happens if they give.', sections: ['stress', 'checks', 'scenarios', 'evidence'] },
    { id: 'record', name: 'The assessment', strap: 'The written report, what spans other policies, and every step behind it.', sections: ['cross', 'report', 'provenance'] },
  ];
  let workspace = $state(0);
  const wtabId = (id: string) => `workspace-tab-${id}`;
  const wpanelId = (id: string) => `workspace-panel-${id}`;

  /** A deep link into a section inside an unselected workspace must still land. */
  function reveal(hash: string) {
    const index = WORKSPACES.findIndex((w) => w.sections.includes(hash));
    if (index >= 0) workspace = index;
    return index >= 0;
  }

  function onWorkspaceKey(event: KeyboardEvent, index: number) {
    const moves: Record<string, number> = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: WORKSPACES.length - 1 };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    workspace = (next + WORKSPACES.length) % WORKSPACES.length;
    document.getElementById(wtabId(WORKSPACES[workspace].id))?.focus();
  }

  const active = $derived(['queued', 'running'].includes(data.analysis.status));
  const completed = $derived(data.stages.filter((s) => s.status === 'completed').length);
  const artefacts = $derived(data.artefacts);
  const plays = $derived(view.plays(artefacts));
  const shownPlays = $derived(bandFilter ? plays.filter((p) => p.band === bandFilter) : plays);
  const bands = $derived(view.bandCounts(plays));
  const actors = $derived(view.actorBoard(artefacts, plays));
  const checks = $derived(view.checks(artefacts));
  const tiles = $derived(view.tiles(artefacts, plays));
  const headline = $derived(view.headline(artefacts));
  const sections = $derived(view.findingsBySection(artefacts));
  const acts = $derived(view.reportActs(artefacts));
  const unplaced = $derived(view.unplacedSections(artefacts));
  const recommendations = $derived(view.of(artefacts, 'recommendation'));
  const fragile = $derived(view.fragileAssumptions(artefacts));
  const scenarios = $derived(view.of(artefacts, 'scenario'));
  const models = $derived(view.of(artefacts, 'model'));
  const crossFound = $derived(view.of(artefacts, 'cross_policy'));
  const interplay = $derived(view.interplay(artefacts, plays));
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
    if (hash && !reveal(hash)) selectedId = hash;
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
    return () => { stopped = true; clearInterval(ticker); clearTimeout(polling); };
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
    <button class="nm-save-btn" onclick={() => window.print()}>Print or save as PDF</button>
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

<div class="rail" role="tablist" aria-label="Workspaces">
  {#each WORKSPACES as w, index (w.id)}
    <button
      role="tab" id={wtabId(w.id)} class="wtab" class:on={index === workspace}
      aria-selected={index === workspace} aria-controls={wpanelId(w.id)}
      tabindex={index === workspace ? 0 : -1}
      onclick={() => (workspace = index)}
      onkeydown={(e) => onWorkspaceKey(e, index)}
    >
      <span class="letter">{index + 1}</span>
      <span class="wtab-name">{w.name}</span>
    </button>
  {/each}
</div>
<p class="muted rail-strap">{WORKSPACES[workspace].strap}</p>

<div role="tabpanel" id={wpanelId('verdict')} class="workspace" aria-labelledby={wtabId('verdict')} hidden={workspace !== 0}>
<div id="verdict" class="anchor"></div>
<Verdict {headline} {tiles} {bands} status={data.analysis.status} {inspect} onband={(b) => { bandFilter = bandFilter === b ? null : b; workspace = 1; }} />
</div>

<div role="tabpanel" id={wpanelId('threat')} class="workspace" aria-labelledby={wtabId('threat')} hidden={workspace !== 1}>

<section id="playbook" class="section">
  <p class="kicker">How it can be beaten</p>
  <h2>The exploitation playbook</h2>
  <p class="strap">
    Each play is something an actor named in the policy could do to serve itself at the policy's expense.
    They are ranked by a single figure — the even blend of how much the actor gains, how easily it can be
    done, how much of the objective it destroys, and how poorly the policy would notice.
  </p>

  {#if plays.length}
    <ExposurePlot {plays} {inspect} />
    <div class="filter">
      <span class="sr-label">Showing</span>
      <button class:on={bandFilter === null} onclick={() => (bandFilter = null)}>All {plays.length}</button>
      {#each bands.filter((b) => b.count) as b (b.band)}
        <button class:on={bandFilter === b.band} onclick={() => (bandFilter = bandFilter === b.band ? null : b.band)}>{b.count} {b.band}</button>
      {/each}
    </div>
    <div class="plays">
      {#each shownPlays as play, i (play.artefact.id)}<PlayCard {play} rank={plays.indexOf(play) + 1} {inspect} />{/each}
    </div>
  {:else}
    <p class="empty">No exploitation play has been produced yet. This is the tenth of thirteen stages, so it arrives late in a run.</p>
  {/if}
</section>

<section id="interplay" class="section">
  <p class="kicker">Who is coming for what</p>
  <h2>The interplay map</h2>
  <p class="strap">
    Every play, drawn from the actor that would run it to the part of the policy it defeats. A measure with
    several arcs into it is a single point the policy has not defended twice over — the reading a ranked
    list cannot give you.
  </p>
  <InterplayMap map={interplay} {inspect} />
</section>

<section id="actors" class="section">
  <p class="kicker">Who is in the room</p>
  <h2>Actors, and what actually moves them</h2>
  <p class="strap">
    What each body says it wants, what its position rewards, who it answers to, and — the question an
    assurance review never asks — who is better off if this policy fails.
  </p>
  <ActorBoard {actors} personas={data.personas ?? []} {inspect} />
</section>
</div>

<div role="tabpanel" id={wpanelId('ground')} class="workspace" aria-labelledby={wtabId('ground')} hidden={workspace !== 2}>
<section id="stress" class="section">
  <p class="kicker">What if we are wrong?</p>
  <h2>The stress test</h2>
  <p class="strap">
    Switch an assumption off and the assessment recomputes in front of you: which conclusions lose their
    footing, which redesign options lose the findings behind them, and which plays stop being available at
    all. It walks the citations the assessment already made — no model runs, and the same switches always
    give the same answer.
  </p>
  {#if fragile.length}
    <div class="fragile">
      <p class="sr-label">The assumptions most likely to change the conclusion</p>
      <ol>
        {#each fragile.slice(0, 5) as a (a.id)}
          <li>
            <button class="link" onclick={() => inspect(a.id)}>{a.label}</button>
            <span class="muted">importance {pct(Number(a.data.importance))} · uncertainty {pct(Number(a.data.uncertainty))} · consequence {pct(Number(a.data.consequence))}</span>
            <p>{a.statement}</p>
          </li>
        {/each}
      </ol>
    </div>
  {/if}

  <StressTest {artefacts} {inspect} />
</section>

<section id="checks" class="section">
  <p class="kicker">Where it is thin</p>
  <h2>Twelve structural checks</h2>
  <p class="strap">
    These are the only figures on this page no model produced. Each walks the relationships the policy
    states and asks whether the counterpart it depends on is there — responsibility with authority,
    accountability with resources, a measure with someone who owns its data. A check with nothing to look
    at is <em>not</em> a pass.
  </p>
  <CheckGrid {checks} {inspect} />
</section>

<section id="scenarios" class="section">
  <p class="kicker">What breaks it</p>
  <h2>Conditions, models and sensitivity</h2>
  <p class="strap">
    Eight standing conditions the policy has to survive, stepped through one beat at a time: what changes,
    who moves first, what follows, and whether anyone would notice. These are semi-formal hypotheses about
    behaviour rather than a numerical simulation, and each one says so in its own sensitivity notes.
  </p>

  <ScenarioWalk {scenarios} {artefacts} {inspect} />

  {#if models.length}
    <details class="models">
      <summary>{models.length} interaction models assessed</summary>
      <ul>
        {#each models as m (m.id)}
          <li>
            <button class="link" onclick={() => inspect(m.id)}>{String(m.data.pattern).replaceAll('_', ' ')}</button>
            <span class="muted">{String(m.data.applicability ?? '')}</span>
          </li>
        {/each}
      </ul>
    </details>
  {/if}
</section>

<section id="evidence" class="section">
  <p class="kicker">Evidence and enquiry</p>
  <h2>What is actually supported</h2>
  <p class="strap">
    Every claim in the paper linked to something outside it, or explicitly not. A search excerpt is weak
    evidence and is labelled as one; a retrieval date is not a publication date.
  </p>
  <EvidenceMix
    mix={view.evidenceMix(artefacts)}
    questions={view.of(artefacts, 'research_question')}
    sources={view.of(artefacts, 'research_source')}
    {inspect}
  />
</section>
</div>

<div role="tabpanel" id={wpanelId('record')} class="workspace" aria-labelledby={wtabId('record')} hidden={workspace !== 3}>
<section id="cross" class="section">
  <p class="kicker">Across policies</p>
  <h2>Weaknesses that span more than one policy</h2>
  <p class="strap">
    Some failures do not exist in any single document: one body told two incompatible things, a burden that
    is bearable once and not three times, an assumption several policies all rest on.
  </p>
  <CrossPolicy found={crossFound} inbound={data.inbound ?? []} unavailable={crossUnavailable} {inspect} />
</section>

<section id="report" class="section">
  <p class="kicker">The written assessment</p>
  <h2>Chapter and verse</h2>
  {#if acts.length}
    <p class="strap">
      Five movements, in the order the argument runs: what the assessment concludes, what the policy is
      trying to do, what that rests on, where it breaks, and what to do about it. Every chapter keeps its
      own heading; the acts are there so it can be read a movement at a time.
    </p>
    <ReportActs {acts} {recommendations} {inspect} />
    {#if unplaced.length}
      <p class="muted">{unplaced.length} chapter{unplaced.length === 1 ? '' : 's'} sit outside these acts and are listed under the run log: {unplaced.join(', ').replaceAll('_', ' ')}.</p>
    {/if}
    {#if sections.length < REPORT_SECTIONS.length}
      <p class="muted">{REPORT_SECTIONS.length - sections.length} of the {REPORT_SECTIONS.length} chapters are missing from this assessment.</p>
    {/if}
  {:else}
    <p class="empty">The written assessment is produced by the final stage and is not available yet.</p>
  {/if}
</section>

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
</div>

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
