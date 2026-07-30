<script lang="ts">
  import MilestoneList from './MilestoneList.svelte';
  import SandboxControls from './SandboxControls.svelte';

  type Build = {
    id: string;
    modelProvider: string;
    modelId: string;
    thinkingLevel: string | null;
    enforceDesignSystem: boolean;
    requireIterationApproval: boolean;
    budgetConfig: Record<string, unknown> | null;
    tokensUsed: number;
    iterationsCompleted: number;
    activeMinutesUsed: number;
    milestones: Array<{ id: string; title: string; done: boolean; iter?: number }> | null;
    status: string;
  };

  let { build, onAfter }: { build: Build; onAfter: () => void | Promise<void> } = $props();

  const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];

  let saving = $state(false);
  async function patch(updates: Record<string, unknown>) {
    saving = true;
    try {
      await fetch(`/api/jkai/builds/${build.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(updates),
      });
      await onAfter();
    } finally {
      saving = false;
    }
  }
</script>

<aside class="sidebar">
  <section class="nm-sec">
    <header class="nm-sec-hd">
      <span class="sr-label-tight">Budget</span>
    </header>
    <dl>
      <dt>Iters</dt>
      <dd>{build.iterationsCompleted ?? 0}</dd>
      <dt>Tokens</dt>
      <dd>{(build.tokensUsed ?? 0).toLocaleString()}</dd>
      <dt>Active min</dt>
      <dd>{(build.activeMinutesUsed ?? 0).toFixed(1)}</dd>
    </dl>
  </section>

  <section class="nm-sec">
    <header class="nm-sec-hd">
      <span class="sr-label-tight">Strategy</span>
    </header>
    <label class="field">
      <span>Thinking</span>
      <select
        class="nm-text-input"
        value={build.thinkingLevel ?? 'medium'}
        disabled={saving}
        onchange={(e) => patch({ thinkingLevel: (e.currentTarget as HTMLSelectElement).value })}
      >
        {#each THINKING_LEVELS as lv}
          <option value={lv}>{lv}</option>
        {/each}
      </select>
    </label>

    <label class="check">
      <input
        type="checkbox"
        checked={build.enforceDesignSystem}
        disabled={saving}
        onchange={(e) => patch({ enforceDesignSystem: (e.currentTarget as HTMLInputElement).checked })}
      />
      <span>Enforce site design system</span>
    </label>

    <label class="check">
      <input
        type="checkbox"
        checked={build.requireIterationApproval}
        disabled={saving}
        onchange={(e) => patch({ requireIterationApproval: (e.currentTarget as HTMLInputElement).checked })}
      />
      <span>Approve each iteration (Phase 2)</span>
    </label>
  </section>

  <section class="nm-sec">
    <header class="nm-sec-hd">
      <span class="sr-label-tight">Model</span>
    </header>
    <dl>
      <dt>Provider</dt>
      <dd>{build.modelProvider}</dd>
      <dt>Model</dt>
      <dd class="break">{build.modelId}</dd>
    </dl>
  </section>

  <MilestoneList milestones={build.milestones ?? []} />

  <SandboxControls buildId={build.id} status={build.status} />
</aside>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    min-width: 260px;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 12px;
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
  }
  dt {
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    font-size: var(--fs-label-xs);
  }
  dd {
    margin: 0;
    color: var(--text-primary);
  }
  dd.break {
    word-break: break-all;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin-bottom: 0.5rem;
  }
  .check {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-mono);
    font-size: var(--fs-label);
    color: var(--text-primary);
    margin-bottom: 0.4rem;
  }
  .check input {
    margin: 0;
  }
</style>
