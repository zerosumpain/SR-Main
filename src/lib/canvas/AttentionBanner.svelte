<script lang="ts">
  // Needs attention: the latest run failed or finished with errors. Names the
  // step that failed and its error, jumps to it, and hands a fix instruction to
  // the prompt bar — which PROPOSES; nothing is applied from here.
  // Mirrors `CanvasAttention` in ./attention.server (kept structural: this is
  // browser code and that module is server-only).
  type Attention = {
    runId: string;
    status: 'failed' | 'completed_with_errors';
    startedAt: string | null;
    nodeId: string | null;
    nodeLabel: string | null;
    error: string | null;
  };

  type Props = {
    attention: Attention;
    onFocusNode: (nodeId: string) => void;
    onAskFix: (instruction: string) => void;
  };
  let { attention, onFocusNode, onAskFix }: Props = $props();

  let dismissedRunId = $state<string | null>(null);

  function clip(text: string, max: number): string {
    const t = text.replace(/\s+/g, ' ').trim();
    return t.length > max ? `${t.slice(0, max - 1)}…` : t;
  }

  const headline = $derived(attention.status === 'failed' ? 'Last run failed' : 'Last run finished with errors');
  const when = $derived(
    attention.startedAt
      ? new Date(attention.startedAt).toLocaleString('en-GB', {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        })
      : null,
  );

  function fixInstruction(): string {
    const step = attention.nodeLabel ? `the step “${attention.nodeLabel}”` : 'a step';
    const err = attention.error ? ` with this error: ${clip(attention.error, 600)}` : '';
    const what = attention.status === 'failed' ? 'failed' : 'hit an error';
    return `The last run ${what} at ${step}${err}. Change the workflow so this step succeeds next time.`;
  }
</script>

{#if dismissedRunId !== attention.runId}
  <section class="attn" role="alert" aria-label="Needs attention">
    <div class="attn-text">
      <span class="attn-hd">
        {headline}{when ? ` · ${when}` : ''}
        {#if attention.nodeId && attention.nodeLabel}
          · at
          <button type="button" class="attn-node" onclick={() => onFocusNode(attention.nodeId!)}>{attention.nodeLabel}</button>
        {/if}
      </span>
      {#if attention.error}
        <span class="attn-err" title={attention.error}>{clip(attention.error, 240)}</span>
      {/if}
    </div>
    <div class="attn-actions">
      <button type="button" class="attn-btn attn-fix" onclick={() => onAskFix(fixInstruction())}>Ask jkai to fix</button>
      <button type="button" class="attn-btn" onclick={() => (dismissedRunId = attention.runId)}>Hide</button>
    </div>
  </section>
{/if}

<style>
  .attn {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    padding: 8px 14px;
    border-bottom: 1px solid var(--line-hair);
    border-left: 3px solid var(--error);
    background: var(--error-bg);
    flex-shrink: 0;
  }
  .attn-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1 1 320px;
  }
  .attn-hd {
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--error);
  }
  .attn-node {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: var(--text-primary);
    text-decoration: underline;
    cursor: pointer;
  }
  .attn-err {
    font-family: var(--font-code);
    font-size: var(--fs-label);
    color: var(--text-primary);
    overflow-wrap: anywhere;
  }
  .attn-actions {
    display: flex;
    gap: 6px;
  }
  .attn-btn {
    padding: 4px 10px;
    font-family: var(--font-mono);
    font-size: var(--fs-label-xs);
    text-transform: uppercase;
    letter-spacing: 0.07em;
    background: var(--bg);
    color: var(--text-primary);
    border: 1px solid var(--card-border);
    border-radius: 2px;
    cursor: pointer;
  }
  .attn-fix {
    border-color: var(--accent);
    color: var(--accent-ink);
  }
</style>
