<script lang="ts">
  import type { PlanPayload } from '$lib/workflows/chat/job-store';

  let { planId, plan, jobId, onresolve }: {
    planId: string;
    plan: PlanPayload;
    jobId: string;
    onresolve: (decision: 'approved' | 'rejected' | 'adjusted', adjustment?: string) => void;
  } = $props();

  let adjustment = $state('');
  let adjustMode = $state(false);
  let submitting = $state(false);
  let error = $state<string | null>(null);

  async function send(decision: 'approved' | 'rejected' | 'adjusted') {
    if (submitting) return;
    submitting = true;
    error = null;
    try {
      const body =
        decision === 'adjusted'
          ? { type: 'plan_ack' as const, planId, decision, adjustment }
          : { type: 'plan_ack' as const, planId, decision };
      const res = await fetch(`/api/workflows/orchestrator/chat?jobId=${encodeURIComponent(jobId)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      onresolve(decision, decision === 'adjusted' ? adjustment : undefined);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to send decision';
      submitting = false;
    }
  }

  const canAdjust = $derived(adjustment.trim().length > 0);
</script>

<section class="plan-card" aria-label="Proposed plan">
  <header class="plan-hdr">
    <span class="sr-label-tight">proposed plan</span>
    {#if plan.summary}
      <span class="plan-summary">{plan.summary}</span>
    {/if}
  </header>

  <ol class="plan-steps">
    {#each plan.steps as step (step.id)}
      <li class="plan-step">
        <span class="plan-step-kind" data-kind={step.kind ?? 'step'}>
          {step.kind ?? 'step'}
        </span>
        <div class="plan-step-body">
          <div class="plan-step-title">{step.title}</div>
          {#if step.detail}
            <div class="plan-step-detail">{step.detail}</div>
          {/if}
        </div>
      </li>
    {/each}
  </ol>

  {#if plan.filesToTouch.length > 0}
    <details class="plan-files">
      <summary class="sr-label-tight">files to touch ({plan.filesToTouch.length})</summary>
      <ul>
        {#each plan.filesToTouch as f}
          <li><code data-action={f.action}>{f.action}</code> <span class="plan-file-path">{f.path}</span></li>
        {/each}
      </ul>
    </details>
  {/if}

  {#if error}
    <div class="plan-error">{error}</div>
  {/if}

  <footer class="plan-actions">
    {#if !adjustMode}
      <button class="nm-save-btn" disabled={submitting} onclick={() => send('approved')}>go</button>
      <button class="nm-btn-ghost" disabled={submitting} onclick={() => { adjustMode = true; }}>adjust</button>
      <button class="nm-btn-ghost" data-variant="danger" disabled={submitting} onclick={() => send('rejected')}>cancel</button>
    {:else}
      <textarea
        class="nm-text-input plan-adjust-input"
        bind:value={adjustment}
        placeholder="What should change?"
        rows="2"
        disabled={submitting}
      ></textarea>
      <div class="plan-actions-row">
        <button class="nm-save-btn" disabled={submitting || !canAdjust} onclick={() => send('adjusted')}>send adjustment</button>
        <button class="nm-btn-ghost" disabled={submitting} onclick={() => { adjustMode = false; adjustment = ''; }}>back</button>
      </div>
    {/if}
  </footer>
</section>

<style>
  .plan-card {
    background: var(--bg-section);
    border: 1px solid var(--accent);
    padding: 10px 12px;
    margin: 6px 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .plan-hdr {
    display: flex;
    align-items: baseline;
    gap: 10px;
    border-bottom: 1px dashed var(--card-border);
    padding-bottom: 6px;
  }
  .plan-summary {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-primary);
    flex: 1;
  }
  .plan-steps {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .plan-step {
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }
  .plan-step-kind {
    font-family: var(--font-mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    padding: 2px 6px;
    border: 1px solid var(--card-border);
    color: var(--text-muted);
    min-width: 52px;
    text-align: center;
    align-self: flex-start;
  }
  .plan-step-kind[data-kind="write"] { border-color: var(--accent); color: var(--accent); }
  .plan-step-kind[data-kind="run"]   { border-color: var(--status-success); color: var(--status-success); }
  .plan-step-body { font-family: var(--font-mono); font-size: 11px; flex: 1; min-width: 0; }
  .plan-step-title { color: var(--text-primary); font-weight: 500; }
  .plan-step-detail { color: var(--text-muted); margin-top: 1px; }

  .plan-files summary {
    cursor: pointer;
    padding: 2px 0;
  }
  .plan-files ul {
    list-style: none;
    padding-left: 0;
    margin: 6px 0 0;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-secondary);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .plan-files code {
    display: inline-block;
    min-width: 46px;
    text-align: center;
    padding: 1px 4px;
    font-size: 10px;
    color: var(--text-muted);
    border: 1px solid var(--card-border);
    margin-right: 6px;
  }
  .plan-files code[data-action="create"] { color: var(--status-success); border-color: var(--status-success); }
  .plan-files code[data-action="modify"] { color: var(--accent); border-color: var(--accent); }
  .plan-files code[data-action="delete"] { color: var(--status-error); border-color: var(--status-error); }
  .plan-file-path { word-break: break-all; }

  .plan-error {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--status-error);
    background: var(--error-bg);
    border-left: 2px solid var(--status-error);
    padding: 4px 8px;
  }

  .plan-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }
  .plan-actions-row {
    display: flex;
    gap: 8px;
  }
  .nm-btn-ghost[data-variant="danger"] {
    color: var(--status-error);
    border-color: var(--status-error);
  }
  .nm-btn-ghost[data-variant="danger"]:hover {
    color: #fff;
    background: var(--status-error);
  }
  .plan-adjust-input {
    resize: vertical;
    min-height: 48px;
    max-height: 140px;
    font-family: var(--font-mono);
  }
</style>
