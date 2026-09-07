<script lang="ts">
  import { onMount } from 'svelte';
  import { outputBudget, evidencedCriteria, type DevelopmentProgress } from './development-progress';
  import type { DeliveryState } from '$lib/jkai/development';
  let { progress, build, delivery, connected }: { progress: DevelopmentProgress; connected: boolean; delivery: DeliveryState;
    build: { status: string; modelProvider?: string; modelId: string; costUsd: string | null;
      budgetConfig: { maxTokensPerIteration?: number; maxIterations?: number; maxCostUsd?: number } } } = $props();
  let now = $state(Date.now());
  onMount(() => { const timer = setInterval(() => now = Date.now(), 1000); return () => clearInterval(timer); });
  const current = $derived(progress.iterations.find(i => i.status === 'running'));
  const lastAssessment = $derived(progress.iterations.find(i => i.evaluation));
  const budget = $derived(outputBudget(current?.outputTokens ?? 0, build.budgetConfig.maxTokensPerIteration));
  const passed = $derived(evidencedCriteria(delivery.criteria, delivery.candidate));
  const codex = $derived(build.modelProvider === 'codex' || build.modelId.startsWith('codex/'));
  const number = (value: number) => value.toLocaleString('en-GB');
  const elapsed = (start: string | Date) => Math.max(0, Math.floor((now - new Date(start).getTime()) / 60000));
</script>
<section class="progress-summary" aria-label="Build progress and token usage">
  <div class="heading"><h2>{current && build.status === 'running' ? `Iteration ${current.number} in progress` : 'Build progress'}</h2><span>{build.modelId}</span></div>
  {#if current && build.status === 'running'}<p>{elapsed(current.createdAt)} minutes in this iteration{build.budgetConfig.maxIterations ? ` · ${build.budgetConfig.maxIterations} iteration limit` : ''}</p><p class="goal"><strong>Current goal:</strong> {current.goals || 'The worker has not recorded a goal yet. Follow live output below.'}</p>{/if}
  <dl><div><dt>Generated output tokens</dt><dd>{number(progress.outputTokens)}</dd></div><div><dt>Total reported tokens</dt><dd>{number(progress.totalTokens)}</dd></div><div><dt>Criteria verified for this candidate</dt><dd>{passed} / {delivery.criteria.length}</dd></div></dl>
  <p class="muted">{connected ? 'Usage refreshes every 3 seconds after each model response completes.' : 'Connection lost — showing last saved usage.'} Total tokens include repeated and cached context; they are not a measure of feature completion.</p>
  {#if codex}<p class="muted">Codex usage is tracked in tokens. Subscription allowance and a monetary charge are not reported here.</p>{:else}<p class="muted">Recorded model cost: ${Number(build.costUsd ?? 0).toFixed(2)}{build.budgetConfig.maxCostUsd ? ` · $${build.budgetConfig.maxCostUsd} limit` : ''}.</p>{/if}
  {#if current && budget}<label class="budget">Iteration output-token budget: {number(budget.used)} / {number(budget.limit)}<progress aria-label="Iteration output-token budget consumed" max="100" value={budget.percent}></progress></label><p class="muted">This bar shows budget consumed, not how much of the feature is finished.</p>{/if}
  {#if !progress.totalTokens}<p>No token usage recorded yet. Counts appear when the worker saves a completed model response.</p>{/if}
  {#if lastAssessment}<p class="goal"><strong>Last worker assessment (iteration {lastAssessment.number}):</strong> {lastAssessment.evaluation?.slice(0, 700)}</p>{/if}
  <details><summary>Recent iterations ({progress.iterations.length})</summary>
    {#each progress.iterations as iteration}<article><strong>Iteration {iteration.number} · {iteration.status}</strong><span>{number(iteration.outputTokens)} output tokens · {number(iteration.tokensUsed)} total</span>
      {#if iteration.goals}<p><b>Goal:</b> {iteration.goals}</p>{/if}
      {#if iteration.evaluation}<p><b>Worker assessment:</b> {iteration.evaluation}</p>{/if}
      {#if iteration.nextSteps}<p><b>Next steps:</b> {iteration.nextSteps}</p>{/if}
      {#if !iteration.evaluation}<p class="muted">No iteration assessment saved yet.</p>{/if}
    </article>{/each}
  </details>
</section>
<style>
  .progress-summary { margin: 16px 0; padding: 16px 0; border-block: 1px solid var(--line-strong); min-width: 0; overflow-wrap: anywhere; }
  .heading { display: flex; flex-wrap: wrap; align-items: baseline; gap: 12px; justify-content: space-between; }
  h2 { font-size: var(--fs-body-lg); margin: 0; } p { margin: 8px 0; } .goal, article p { white-space: pre-wrap; }
  dl { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin: 16px 0; }
  dt, .muted, .heading span, article span { font-size: var(--fs-label); color: var(--text-secondary); }
  dd { font-family: var(--font-code); font-size: var(--fs-body-lg); margin: 6px 0; }
  .budget { display: block; margin-top: 12px; } progress { display: block; width: 100%; height: 8px; accent-color: var(--accent-ink); margin-top: 8px; }
  summary { cursor: pointer; margin-top: 14px; } article { padding: 12px 0; border-bottom: 1px solid var(--line); } article span { display: block; margin-top: 4px; }
  @media(max-width: 700px) { dl { grid-template-columns: 1fr; gap: 10px; } dl div { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; } dd { white-space: nowrap; } }
</style>
