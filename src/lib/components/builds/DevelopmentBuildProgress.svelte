<script lang="ts">
  // Where the feature actually is, in the /health editorial register.
  //
  // Three shapes, all borrowed rather than invented: the five-step ladder is
  // the ranked row (numeral, what the thing IS, then the content, hairlines
  // drawn as the container's ground through a 1px gap); the result/resources
  // pair and the work/checks pair are the same ledger; and every panel opens
  // with a mono eyebrow instead of a heading, because the section head above
  // has already said what this is.
  import { onMount } from 'svelte';
  import { outputBudget, evidencedCriteria, developmentPosition, assessmentExcerpt, type DevelopmentProgress } from '$lib/builds/development-progress';
  import type { DeliveryState } from '$lib/jkai/development';
  let { progress, build, delivery, connected, buildId, busy = false, navigate, inspect, prepare }: {
    progress: DevelopmentProgress; connected: boolean; delivery: DeliveryState; buildId: string; busy?: boolean;
    navigate: (tab: string) => void; inspect: () => void; prepare: () => void;
    build: { status: string; outcome?: string | null; modelProvider?: string; modelId: string; costUsd: string | null;
      budgetConfig: { maxTokensPerIteration?: number; maxIterations?: number; maxCostUsd?: number } } } = $props();
  let now = $state(Date.now());
  onMount(() => { const timer = setInterval(() => now = Date.now(), 1000); return () => clearInterval(timer); });
  const current = $derived(progress.iterations.find(i => i.status === 'running'));
  const lastAssessment = $derived(progress.iterations.find(i => i.evaluation));
  const position = $derived(developmentPosition(progress, delivery, build));
  const budget = $derived(outputBudget(current?.outputTokens ?? 0, build.budgetConfig.maxTokensPerIteration));
  const passed = $derived(evidencedCriteria(delivery.criteria, delivery.candidate));
  const codex = $derived(build.modelProvider === 'codex' || build.modelId.startsWith('codex/'));
  const number = (value: number) => value.toLocaleString('en-GB');
  const elapsed = (start: string | Date) => Math.max(0, Math.floor((now - new Date(start).getTime()) / 60000));
  const steps = $derived([
    { label: 'Brief', detail: delivery.brief.acceptedAt ? 'Accepted' : 'Draft', tab: 'Brief' },
    { label: 'Build', detail: current && position.busy ? `Iteration ${current.number}` : `${progress.iterations.length} recorded attempts`, tab: 'Build' },
    { label: 'Checks', detail: position.checksLabel, tab: 'Build' },
    { label: 'Preview', detail: position.ready ? position.inspection ? 'Inspection only' : 'Ready' : delivery.preview.status === 'starting' ? 'Preparing' : 'Not ready', tab: 'Preview' },
    { label: 'Accept', detail: delivery.acceptedAt ? 'In batch' : `${passed}/${delivery.criteria.length} evidenced`, tab: 'Delivery' },
  ]);
</script>

<section class="pg" aria-label="Build progress and token usage">
  <ol class="pg-ladder" aria-label="Feature delivery process">
    {#each steps as step, i (step.label)}
      <li><button onclick={() => navigate(step.tab)}>
        <span class="pg-index">{String(i + 1).padStart(2, '0')}</span>
        <span class="pg-step"><span class="pg-step-name">{step.label}</span><span class="pg-step-detail">{step.detail}</span></span>
      </button></li>
    {/each}
  </ol>

  <div class="pg-pair">
    <div class="pg-panel pg-result" class:blocked={position.failed || position.stopped}>
      <p class="pg-eyebrow">Result / next action</p>
      <!-- A heading, not a styled paragraph: `development-inspection-preview`
           waits on `getByRole('heading', …)` for this exact sentence, and it
           is the panel's title either way. -->
      <h3 class="pg-headline">{position.label}</h3>
      <p class="pg-body">{position.ready ? position.working ? 'Try the working page and send feedback while the next increment is built.' : position.inspection ? 'Look at the saved implementation. Repository checks and acceptance evidence are still required.' : 'Try the candidate against the accepted brief, then record what passed.' : position.previewReason}</p>
      <div class="pg-actions">
        {#if position.ready}<button class="pg-run" onclick={() => navigate('Preview')}>Review {position.inspection ? 'inspection ' : ''}preview</button>
        {:else if position.verified}<button class="pg-run" disabled={busy || position.busy || delivery.preview.status === 'starting'} onclick={prepare}>Prepare preview</button>
        {:else if position.work}<button class="pg-run" disabled={busy || !position.canInspect} onclick={inspect}>{delivery.preview.status === 'starting' ? 'Preparing inspection…' : 'Prepare inspection preview'}</button>{/if}
        <a class="pg-link" href={`/jkai/builds/${buildId}`}>Inspect saved source ↗</a>
      </div>
      {#if position.work && position.busy && !position.ready}<p class="pg-stamp">The first working preview appears automatically. You can pause to inspect saved work.</p>{/if}
      {#if !position.verified}<p class="pg-stamp">Full repository checks and acceptance evidence are required before this becomes a release candidate.</p>{/if}
      {#if delivery.cycle}
        <p class="pg-stamp">Checkpoint targets: working preview in 10m · release candidate in 20m.</p>
        <p class="pg-stamp">Model work {Math.round(delivery.cycle.modelMs / 1000)}s · preview checks {Math.round(delivery.cycle.previewMs / 1000)}s · release checks {Math.round(delivery.cycle.verificationMs / 1000)}s</p>
        {#if delivery.cycle.phaseMs}<details class="pg-fold"><summary>Executor time by phase</summary><dl class="pg-dl">{#each Object.entries(delivery.cycle.phaseMs) as [phase, ms]}<div><dt>{phase}</dt><dd>{Math.round(ms / 1000)}s</dd></div>{/each}</dl></details>{/if}
        {#if delivery.cycle.firstPreviewAt}<p class="pg-stamp">First working preview: {Math.round((Date.parse(delivery.cycle.firstPreviewAt) - Date.parse(delivery.cycle.startedAt)) / 1000)}s from start.</p>{/if}
        {#if delivery.cycle.failure}<p role="status" class="pg-fold">{delivery.cycle.failureKind}: {delivery.cycle.failure}</p>{/if}
      {/if}
      {#if delivery.preview.lastError}<details class="pg-fold"><summary>Latest preview or verification failure</summary><pre>{delivery.preview.lastError}</pre></details>{/if}
      {#if position.failed && progress.testFailure}<details class="pg-fold"><summary>Last repository failure · {new Date(progress.testFailure.createdAt).toLocaleTimeString()}</summary><pre>{progress.testFailure.content}</pre></details>{/if}
    </div>

    <aside class="pg-panel" aria-label="Build resource usage">
      <p class="pg-eyebrow">Resources / recorded usage</p>
      <dl class="pg-dl">
        <div><dt>Generated output tokens</dt><dd>{number(progress.outputTokens)}</dd></div>
        <div><dt>Total reported tokens</dt><dd>{number(progress.totalTokens)}</dd></div>
        <div><dt>Criteria verified for this candidate</dt><dd>{passed} / {delivery.criteria.length}</dd></div>
      </dl>
      {#if current && budget}<label class="pg-budget">Iteration output-token budget: {number(budget.used)} / {number(budget.limit)}<progress aria-label="Iteration output-token budget consumed" max="100" value={budget.percent}></progress></label>{/if}
      <p class="pg-stamp">{connected ? 'Saved usage refreshes every 3s, after model responses complete.' : 'Disconnected — showing last saved usage.'}</p>
      <details class="pg-fold"><summary>How to read usage</summary><p class="pg-body">Total tokens include repeated and cached context. Output tokens count generated work. Neither shows how much of the feature is finished.</p><p class="pg-body">{codex ? 'Codex usage is tracked in tokens. Subscription allowance and monetary charges are not reported here.' : `Recorded model cost: $${Number(build.costUsd ?? 0).toFixed(2)}.`}</p></details>
    </aside>
  </div>

  <div class="pg-pair">
    <section class="pg-panel" aria-label="Current work">
      <p class="pg-eyebrow">Work / latest report</p>
      {#if current && position.busy}
        <h4 class="pg-headline">Iteration {current.number} in progress <span class="pg-stamp">· {elapsed(current.createdAt)}m elapsed</span></h4>
        <p class="pg-assessment">{assessmentExcerpt(current.goals) || 'No goal recorded yet. Watch the activity below.'}</p>
      {:else if lastAssessment}
        <h4 class="pg-headline">Iteration {lastAssessment.number} · worker assessment</h4>
        <p class="pg-assessment">{assessmentExcerpt(lastAssessment.evaluation, 400)}</p>
      {:else}<p class="pg-body">No implementation report saved yet.</p>{/if}
      <p class="pg-stamp">Worker reports are claims; the checks and your preview review supply the evidence.</p>
    </section>

    <section class="pg-panel" aria-label="Repository checks">
      <p class="pg-eyebrow">Evidence / repository checks</p>
      {#each ['feedback_gate', 'release_candidate'] as phase (phase)}
        {@const check = progress.verification?.[phase as 'feedback_gate' | 'release_candidate']}
        <div class="pg-check"><span>{phase === 'feedback_gate' ? 'Types & tests' : 'Production build'}</span><strong class:failed={check?.status.includes('failed')}>{check ? check.status.replace('reused_passed', 'Passed · reused').replace('reused_failed', 'Failed · reused') : 'Not recorded'}</strong></div>
        {#if check?.command}<code class="pg-cmd">{check.command}</code>{/if}
      {/each}
      <p class="pg-stamp">{position.verified ? 'Gate evidence matches the current candidate.' : 'No passing gate recorded for an acceptance candidate.'}</p>
    </section>
  </div>

  <details class="pg-fold pg-history"><summary>Iteration history · {progress.iterations.length} recent attempts</summary>
    {#each progress.iterations as iteration (iteration.id)}
      <div class="pg-iteration">
        <span class="pg-iteration-n">{String(iteration.number).padStart(2, '0')}</span>
        <details><summary>{iteration.status} · {number(iteration.outputTokens)} output tokens</summary>
          <p class="pg-assessment"><b>Report:</b> {assessmentExcerpt(iteration.evaluation || iteration.goals, 1800) || 'No assessment saved.'}</p>
          {#if iteration.nextSteps}<p class="pg-assessment"><b>Proposed next steps:</b> {assessmentExcerpt(iteration.nextSteps)}</p>{/if}
        </details>
      </div>
    {/each}
  </details>
</section>

<style>
  .pg { min-width: 0; margin: 0 0 26px; overflow-wrap: anywhere; }

  /* ——— the five-step ladder: the ranked row, one hairline drawn as ground ——— */
  .pg-ladder {
    list-style: none;
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 1px;
    background: var(--card-border);
    border: 1px solid var(--card-border);
    margin: 0 0 1px;
    padding: 0;
  }
  .pg-ladder button {
    display: flex;
    gap: 12px;
    align-items: baseline;
    width: 100%;
    height: 100%;
    padding: 16px 18px;
    text-align: left;
    background: var(--bg);
    border: 0;
    color: inherit;
    cursor: pointer;
    transition: background-color var(--t-fast) var(--ease-out);
  }
  .pg-ladder button:hover { background: var(--surface-card); }
  .pg-index {
    font-family: var(--font-display);
    font-size: var(--fs-body-lg);
    line-height: 1;
    letter-spacing: -0.02em;
    color: var(--accent);
  }
  .pg-step { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
  .pg-step-name {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }
  .pg-step-detail { font-size: var(--fs-label); color: var(--text-secondary); }

  /* ——— the ledger pairs ——— */
  .pg-pair {
    display: grid;
    grid-template-columns: minmax(0, 1.7fr) minmax(260px, 1fr);
    gap: 1px;
    background: var(--card-border);
    border: 1px solid var(--card-border);
    border-top: 0;
  }
  .pg-panel { background: var(--bg); padding: 18px 20px; min-width: 0; }
  .pg-result { border-left: 3px solid var(--accent-ink); }
  .pg-result.blocked { border-left-color: var(--accent); }

  .pg-eyebrow {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin: 0 0 12px;
  }
  .pg-headline {
    font-family: var(--font-display);
    font-size: var(--fs-display-xs);
    line-height: 1.1;
    letter-spacing: -0.01em;
    text-transform: uppercase;
    margin: 0 0 10px;
  }
  .pg-body {
    font-size: var(--fs-nav);
    line-height: 1.55;
    color: var(--text-secondary);
    max-width: 80ch;
    text-wrap: pretty;
    margin: 0 0 10px;
  }
  .pg-assessment {
    font-size: var(--fs-nav);
    line-height: 1.5;
    white-space: pre-wrap;
    margin: 0 0 10px;
  }
  .pg-stamp {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.06em;
    line-height: 1.5;
    color: var(--text-muted);
    margin: 8px 0 0;
  }

  .pg-actions { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin: 14px 0 0; }
  .pg-run {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    padding: 9px 16px;
    color: var(--bg);
    background: var(--accent);
    border: 1px solid var(--accent);
    border-radius: 0;
    cursor: pointer;
    transition: background-color var(--t-fast) var(--ease-out), border-color var(--t-fast) var(--ease-out);
  }
  .pg-run:hover:not(:disabled) { background: var(--accent-hover); border-color: var(--accent-hover); }
  .pg-run:disabled { opacity: 0.45; cursor: default; }
  .pg-link { font-size: var(--fs-label); color: var(--accent-ink); }

  /* ——— figures ——— */
  .pg-dl { margin: 0; }
  .pg-dl div,
  .pg-check {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 14px;
    padding: 8px 0;
    border-bottom: 1px solid var(--line-hair);
  }
  dt,
  .pg-check span { font-size: var(--fs-label); color: var(--text-secondary); }
  dd,
  .pg-check strong {
    font-family: var(--font-code);
    font-size: var(--fs-label);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    margin: 0;
  }
  .pg-check strong.failed { color: var(--error); }
  .pg-cmd {
    display: block;
    font-family: var(--font-code);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    margin: 6px 0 10px;
  }
  .pg-budget { display: block; font-size: var(--fs-label); color: var(--text-secondary); margin-top: 12px; }
  progress { display: block; width: 100%; height: 5px; margin: 6px 0; accent-color: var(--accent-ink); }
  progress::-webkit-progress-value { background: var(--accent-ink); }
  progress::-webkit-progress-bar { background: var(--line); }

  /* ——— folds ——— */
  .pg-fold { margin: 12px 0 0; }
  summary {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-muted);
    cursor: pointer;
  }
  summary:hover { color: var(--accent); }
  pre {
    max-height: 210px;
    overflow: auto;
    white-space: pre-wrap;
    font-family: var(--font-code);
    font-size: var(--fs-label);
    background: var(--surface-sunken);
    padding: 12px;
    margin: 10px 0 0;
  }
  .pg-history {
    border: 1px solid var(--card-border);
    border-top: 0;
    padding: 14px 20px;
    margin: 0;
  }
  .pg-iteration { display: flex; gap: 14px; border-top: 1px solid var(--line-hair); margin-top: 10px; padding-top: 10px; }
  .pg-iteration details { margin: 0; min-width: 0; }
  .pg-iteration-n {
    font-family: var(--font-display);
    font-size: var(--fs-label);
    color: var(--text-muted);
    min-width: 2ch;
  }

  button:focus-visible,
  a:focus-visible,
  summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  @media (max-width: 900px) {
    .pg-ladder { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .pg-pair { grid-template-columns: 1fr; }
  }
  @media (max-width: 520px) {
    .pg-ladder { grid-template-columns: 1fr; }
    .pg-panel { padding: 15px 16px; }
  }
</style>
