<script lang="ts">
  import { onMount } from 'svelte';
  import { outputBudget, evidencedCriteria, developmentPosition, assessmentExcerpt, type DevelopmentProgress } from './development-progress';
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
<section class="progress-summary" aria-label="Build progress and token usage">
  <ol class="process" aria-label="Feature delivery process">{#each steps as step, i}<li><button onclick={() => navigate(step.tab)}><span class="step-index">0{i + 1}</span><span><strong>{step.label}</strong><small>{step.detail}</small></span></button></li>{/each}</ol>
  <div class="control-grid">
    <div class="result-panel" class:blocked={position.failed || position.stopped}>
      <p class="eyebrow">Result / next action</p><h2>{position.label}</h2>
      <p class="reason">{position.ready ? position.inspection ? 'Look at the saved implementation. Repository checks and acceptance evidence are still required.' : 'Try the candidate against the accepted brief, then record what passed.' : position.previewReason}</p>
      <div class="actions">
        {#if position.ready}<button class="nm-save-btn" onclick={() => navigate('Preview')}>Review {position.inspection ? 'inspection ' : ''}preview</button>
        {:else if position.verified}<button class="nm-save-btn" disabled={busy || position.busy || delivery.preview.status === 'starting'} onclick={prepare}>Prepare preview</button>
        {:else if position.work}<button class="nm-save-btn" disabled={busy || !position.canInspect} onclick={inspect}>{delivery.preview.status === 'starting' ? 'Preparing inspection…' : 'Prepare inspection preview'}</button>{/if}
        <a class="source-link" href={`/jkai/builds/${buildId}`}>Inspect saved source ↗</a>
      </div>
      {#if position.work && position.busy && !position.ready}<small>Pause the build above to create an inspection snapshot.</small>{/if}
      {#if !position.verified}<small>Inspection does not pass the checks or permit acceptance into the batch.</small>{/if}
      {#if position.failed && progress.testFailure}<details class="failure"><summary>Last repository failure · {new Date(progress.testFailure.createdAt).toLocaleTimeString()}</summary><pre>{progress.testFailure.content}</pre></details>{/if}
    </div>
    <aside class="usage-panel" aria-label="Build resource usage"><p class="eyebrow">Resources / recorded usage</p>
      <dl><div><dt>Generated output tokens</dt><dd>{number(progress.outputTokens)}</dd></div><div><dt>Total reported tokens</dt><dd>{number(progress.totalTokens)}</dd></div><div><dt>Criteria verified for this candidate</dt><dd>{passed} / {delivery.criteria.length}</dd></div></dl>
      {#if current && budget}<label class="budget">Iteration output-token budget: {number(budget.used)} / {number(budget.limit)}<progress aria-label="Iteration output-token budget consumed" max="100" value={budget.percent}></progress></label>{/if}
      <p class="muted">{connected ? 'Saved usage refreshes every 3s, after model responses complete.' : 'Disconnected — showing last saved usage.'}</p>
      <details><summary>How to read usage</summary><p>Total tokens include repeated and cached context. Output tokens count generated work. Neither shows how much of the feature is finished.</p><p>{codex ? 'Codex usage is tracked in tokens. Subscription allowance and monetary charges are not reported here.' : `Recorded model cost: $${Number(build.costUsd ?? 0).toFixed(2)}.`}</p></details>
    </aside>
  </div>
  <div class="work-grid">
    <section class="current-work" aria-label="Current work"><p class="eyebrow">Work / latest report</p>
      {#if current && position.busy}<h3>Iteration {current.number} in progress <small>· {elapsed(current.createdAt)}m elapsed</small></h3><p class="assessment">{assessmentExcerpt(current.goals) || 'No goal recorded yet. Watch the activity below.'}</p>
      {:else if lastAssessment}<h3>Iteration {lastAssessment.number} · worker assessment</h3><p class="assessment">{assessmentExcerpt(lastAssessment.evaluation, 400)}</p>
      {:else}<p>No implementation report saved yet.</p>{/if}
      <small>Worker reports are claims; the checks and your preview review supply the evidence.</small>
    </section>
    <section class="checks" aria-label="Repository checks"><p class="eyebrow">Evidence / repository checks</p>
      {#each ['feedback_gate', 'release_candidate'] as phase}{@const check = progress.verification?.[phase as 'feedback_gate' | 'release_candidate']}<div class="check-row"><span>{phase === 'feedback_gate' ? 'Types & tests' : 'Production build'}</span><strong class:failed={check?.status.includes('failed')}>{check ? check.status.replace('reused_passed', 'Passed · reused').replace('reused_failed', 'Failed · reused') : 'Not recorded'}</strong></div>{#if check?.command}<code>{check.command}</code>{/if}{/each}
      <p class="muted">{position.verified ? 'Gate evidence matches the current candidate.' : 'No passing gate recorded for an acceptance candidate.'}</p>
    </section>
  </div>
  <details class="history"><summary>Iteration history · {progress.iterations.length} recent attempts</summary>
    {#each progress.iterations as iteration}<div class="iteration"><span class="iteration-number">{iteration.number}</span><details><summary>{iteration.status} · {number(iteration.outputTokens)} output tokens</summary><p class="assessment"><b>Report:</b> {assessmentExcerpt(iteration.evaluation || iteration.goals, 1800) || 'No assessment saved.'}</p>{#if iteration.nextSteps}<p class="assessment"><b>Proposed next steps:</b> {assessmentExcerpt(iteration.nextSteps)}</p>{/if}</details></div>{/each}
  </details>
</section>
<style>
  .progress-summary { min-width: 0; margin: 10px 0; font-size: var(--fs-nav); overflow-wrap: anywhere; }
  .process { list-style: none; display: grid; grid-template-columns: repeat(5, minmax(0,1fr)); margin: 0 0 10px; padding: 0; border: 1px solid var(--line-strong); background: var(--surface-rail); }
  .process li + li { border-left: 1px solid var(--line-strong); } .process button { display: flex; gap: 10px; align-items: baseline; padding: 9px 12px; text-align: left; width: 100%; height: 100%; background: transparent; color: var(--text-primary); border: 0; cursor: pointer; }
  .step-index { font-family: var(--font-code); color: var(--accent); font-size: var(--fs-label); } .process strong, .process small { display: block; } small, .muted { color: var(--text-secondary); font-size: var(--fs-label); }
  .control-grid, .work-grid { display: grid; grid-template-columns: minmax(0, 1.7fr) minmax(250px, 1fr); border: 1px solid var(--line-strong); }
  .result-panel, .usage-panel, .current-work, .checks { min-width: 0; padding: 12px 14px; } .result-panel { background: var(--surface-sunken); border-left: 3px solid var(--accent-ink); } .result-panel.blocked { border-left-color: var(--accent); }
  .usage-panel, .checks { border-left: 1px solid var(--line-strong); } .eyebrow { margin: 0 0 6px; text-transform: uppercase; letter-spacing: .08em; font-size: var(--fs-label-xs); color: var(--text-secondary); }
  h2 { font: 1.15rem var(--font-display); margin: 0; } h3 { font-size: var(--fs-nav); margin: 0; } p { margin: 6px 0; } .reason { max-width: 75ch; } .actions { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin: 10px 0 5px; }
  .source-link { font-size: var(--fs-label); color: var(--accent-ink); } .result-panel > small { display: block; margin-top: 4px; }
  dl { margin: 0; } dl div, .check-row { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 4px 0; border-bottom: 1px solid var(--line); } dt { font-size: var(--fs-label); } dd { font-family: var(--font-code); margin: 0; white-space: nowrap; }
  .budget { display: block; font-size: var(--fs-label); margin-top: 8px; } progress { display: block; width: 100%; height: 5px; margin: 5px 0; accent-color: var(--accent-ink); } progress::-webkit-progress-value { background: var(--accent-ink); } progress::-webkit-progress-bar { background: var(--line); }
  .work-grid { border-top: 0; } .assessment { white-space: pre-wrap; line-height: 1.45; } .checks code { display: block; font-family: var(--font-code); font-size: var(--fs-label-xs); margin: 4px 0 7px; } .failed { color: var(--error); }
  details { font-size: var(--fs-label); margin-top: 8px; } summary { cursor: pointer; } pre { max-height: 210px; overflow: auto; white-space: pre-wrap; font-family: var(--font-code); font-size: var(--fs-label); }
  .history { border: 1px solid var(--line-strong); padding: 9px 12px; } .iteration { display: flex; gap: 12px; border-top: 1px solid var(--line); margin-top: 8px; padding-top: 8px; } .iteration details { margin: 0; min-width: 0; } .iteration-number { font-family: var(--font-code); color: var(--text-secondary); min-width: 2ch; }
  button:focus-visible, a:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  @media(max-width: 760px) { .control-grid, .work-grid { grid-template-columns: 1fr; } .usage-panel, .checks { border-left: 0; border-top: 1px solid var(--line); } .process button { padding: 8px 5px; gap: 3px; flex-direction: column; } .process small { font-size: var(--fs-label-xs); } .result-panel, .usage-panel, .current-work, .checks { padding: 10px; } }
</style>
